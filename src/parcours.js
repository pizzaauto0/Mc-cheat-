// Parcours-Modus: 2D-Physik-Hindernisstrecke in Seitenansicht.
// Eigene Szene, eigene Kamera, eigenes Fahrzeug -- das 3D-Spiel bleibt unberuehrt.
// Steuerung ist absichtlich minimal: Gas und Rueckwaerts, sonst nichts.
import * as THREE from "three";
import { createPhysics, createBox } from "./phys2d.js";
import { LEVELS } from "./levels.js";
import { clamp, damp, lerp, formatTime, mod } from "./util.js";
import { skyTexture, checkerTexture, blobTexture } from "./textures.js";

const STORAGE_KEY = "asphalt-drift.parcours.v1";
const SUB_STEP = 1 / 120;

/* ------------------------------------------------------------ Fahrzeugdaten */

// Auslegung: Der Radaufstandspunkt liegt 1,12 m unter dem Schwerpunkt, die
// Raeder stehen 1,15 m davor bzw. dahinter. Damit kippt der Truck erst ab
// ca. 26 m/s^2 nach hinten -- die Antriebskraft ist per Moment und Reibung
// darunter gedeckelt, sonst macht er beim Anfahren einen Rueckwaertsueberschlag.
const TRUCK = {
  chassis: { w: 2.8, h: 0.85, mass: 520, friction: 0.5, restitution: 0.02 },
  wheels: [
    { ax: 1.15, ay: -0.15, drive: true },
    { ax: -1.15, ay: -0.15, drive: true },
  ],
  wheelRadius: 0.62,
  wheelWidth: 0.44,
  restLen: 0.35,
  travel: 0.32,
  stiffness: 62000,
  damping: 4600,
  maxTorque: 2600,
  wheelInertia: 9,
  slipStiffness: 9000,
  mu: 0.8,
  airTorque: 0.3,
  airDrag: 0.8,
  trackWidth: 1.5,
  // Kraftgrenzen: ohne die katapultiert eine harte Landung den Truck in den
  // Himmel (statische Radlast ist ~6,8 kN).
  maxSpringForce: 24000,
  maxDamperForce: 12000,
  maxSpin: 45,
};

const COLORS = {
  grass: 0x6dcb5c, soil: 0x9a6a42, wood: 0xb5714b, woodDark: 0x8c5334,
  concrete: 0xc6c9d2, crate: 0xc98a4b, crateBand: 0x7d5330, boulder: 0x8a8f98,
  body: 0xffc93c, cab: 0xe9eff8, tire: 0x1c1f26, rim: 0x5a616d, pivot: 0x3a4150,
};

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? { unlocked: 1, best: {} }; }
  catch { return { unlocked: 1, best: {} }; }
}
function saveStore(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* egal */ }
}

/* ------------------------------------------------------------------ Modul */

export function createParcours({ renderer, audio }) {
  const scene = new THREE.Scene();
  scene.background = skyTexture("#3aa0e8", "#bfe6ff", "#e8f4ff");
  scene.fog = new THREE.Fog(0xcfe8ff, 120, 520);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 900);
  camera.position.set(0, 4, 26);

  const hemi = new THREE.HemisphereLight(0xdcf0ff, 0x6a7a55, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff6e2, 2.0);
  sun.position.set(-30, 60, 40);
  scene.add(sun, sun.target);

  /* ---------------- Hintergrund: Huegel + Wolken ---------------- */
  const bg = new THREE.Group();
  scene.add(bg);
  const hillLayers = [
    { z: -90, color: 0x6fae86, scale: 1, count: 16 },
    { z: -190, color: 0x86c3c8, scale: 1.8, count: 12 },
    { z: -320, color: 0xa4d6ea, scale: 2.8, count: 10 },
  ];
  hillLayers.forEach((layer, li) => {
    const mat = new THREE.MeshBasicMaterial({ color: layer.color });
    for (let i = 0; i < layer.count; i++) {
      const w = (26 + ((i * 7 + li * 11) % 20)) * layer.scale;
      const h = (12 + ((i * 5 + li * 3) % 16)) * layer.scale;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), mat);
      box.position.set(-160 + i * (34 * layer.scale) + li * 13, h / 2 - 16 - li * 4, layer.z);
      box.rotation.z = ((i % 3) - 1) * 0.06;
      bg.add(box);
    }
  });
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const parts = 2 + (i % 3);
    for (let p = 0; p < parts; p++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(9 + (p % 2) * 7, 2.4, 3), cloudMat);
      m.position.set(p * 6 - parts * 2, (p % 2) * 1.6, -p * 1.2);
      g.add(m);
    }
    g.position.set(-120 + i * 26, 26 + (i % 4) * 7, -55 - (i % 3) * 18);
    bg.add(g);
    clouds.push(g);
  }

  /* ---------------- Level-Inhalt ---------------- */
  const levelGroup = new THREE.Group();
  scene.add(levelGroup);
  const physics = createPhysics({ gravity: -26 });
  const dynamicMeshes = [];        // {body, mesh}
  let finishMesh = null;

  const checker = checkerTexture(4);

  function boxMesh(w, h, depth, color, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.02, flatShading: true,
    });
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), mat);
  }

  function clearLevel() {
    while (levelGroup.children.length) {
      const child = levelGroup.children.pop();
      child.traverse?.((o) => {
        if (o.isMesh) { o.geometry.dispose?.(); }
      });
      levelGroup.remove(child);
    }
    dynamicMeshes.length = 0;
    physics.clear();
    finishMesh = null;
  }

  /* ---------------- Fahrzeug ---------------- */
  const truck = {
    body: null, group: null, wheelMeshes: [], wheels: [],
    crashed: false, crashTimer: 0, airTime: 0, grounded: false,
    distance: 0,
  };

  function buildTruckMesh() {
    const group = new THREE.Group();
    const c = TRUCK.chassis;
    const depth = TRUCK.trackWidth + 0.5;
    const body = boxMesh(c.w, c.h, depth, COLORS.body, { roughness: 0.55, metalness: 0.15 });
    group.add(body);
    const cab = boxMesh(c.w * 0.44, 0.72, depth * 0.92, COLORS.cab, { roughness: 0.5 });
    cab.position.set(c.w * 0.1, c.h / 2 + 0.36, 0);
    group.add(cab);
    const glass = boxMesh(c.w * 0.45, 0.34, depth * 0.95, 0x2b3440, { roughness: 0.25, metalness: 0.2 });
    glass.position.set(c.w * 0.12, c.h / 2 + 0.46, 0);
    group.add(glass);
    // Ueberrollbuegel + offene Ladefläche hinten
    const bar = boxMesh(0.14, 0.52, depth * 0.86, COLORS.rim, { metalness: 0.4, roughness: 0.4 });
    bar.position.set(-c.w * 0.1, c.h / 2 + 0.26, 0);
    group.add(bar);
    for (const side of [1, -1]) {
      const rail = boxMesh(c.w * 0.44, 0.3, 0.12, COLORS.body, { roughness: 0.6 });
      rail.position.set(-c.w * 0.26, c.h / 2 + 0.15, side * depth * 0.45);
      group.add(rail);
    }
    const tail = boxMesh(0.12, 0.3, depth * 0.9, COLORS.body, { roughness: 0.6 });
    tail.position.set(-c.w / 2 + 0.06, c.h / 2 + 0.15, 0);
    group.add(tail);
    // Stossstangen
    for (const s of [1, -1]) {
      const bump = boxMesh(0.22, 0.3, depth * 0.96, COLORS.rim, { metalness: 0.35 });
      bump.position.set(s * (c.w / 2 + 0.08), -0.1, 0);
      group.add(bump);
    }
    // Scheinwerfer
    const head = boxMesh(0.1, 0.22, 0.26, 0xfff3cf, { roughness: 0.3 });
    head.material.emissive = new THREE.Color(0xfff0c0);
    head.material.emissiveIntensity = 0.7;
    head.position.set(c.w / 2 + 0.05, 0.12, depth * 0.3);
    group.add(head);
    const head2 = head.clone();
    head2.position.z = -depth * 0.3;
    group.add(head2);

    // Raeder (zwei je Achse, damit es plastisch wirkt)
    const tireGeo = new THREE.CylinderGeometry(TRUCK.wheelRadius, TRUCK.wheelRadius, TRUCK.wheelWidth, 16);
    tireGeo.rotateX(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(TRUCK.wheelRadius * 0.45, TRUCK.wheelRadius * 0.45, TRUCK.wheelWidth + 0.04, 8);
    rimGeo.rotateX(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: COLORS.tire, roughness: 0.9, flatShading: true });
    const rimMat = new THREE.MeshStandardMaterial({ color: COLORS.rim, roughness: 0.4, metalness: 0.6, flatShading: true });
    const wheelMeshes = [];
    for (const w of TRUCK.wheels) {
      const hub = new THREE.Group();
      for (const side of [1, -1]) {
        const spin = new THREE.Group();
        spin.position.z = side * TRUCK.trackWidth / 2;
        const tire = new THREE.Mesh(tireGeo, tireMat);
        spin.add(tire);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        spin.add(rim);
        // Stollen
        for (let i = 0; i < 6; i++) {
          const lug = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, TRUCK.wheelWidth + 0.06), tireMat);
          const a = (i / 6) * Math.PI * 2;
          lug.position.set(Math.cos(a) * TRUCK.wheelRadius * 0.92, Math.sin(a) * TRUCK.wheelRadius * 0.92, 0);
          lug.rotation.z = a;
          spin.add(lug);
        }
        hub.add(spin);
      }
      group.add(hub);
      wheelMeshes.push(hub);
    }
    return { group, wheelMeshes };
  }

  function spawnTruck(level) {
    const c = TRUCK.chassis;
    // Ruhehoehe ausmessen: Boden suchen und den Truck genau so hoch setzen,
    // dass die Federn ihre statische Vorspannung haben (kein Sturz beim Start).
    const probe = physics.raycast(level.start.x, level.start.y + 12, 0, -1, 40);
    const restComp = (c.mass * 26) / 2 / TRUCK.stiffness;
    const spawnY = probe
      ? probe.y + TRUCK.restLen + TRUCK.wheelRadius - TRUCK.wheels[0].ay - restComp
      : level.start.y;
    truck.body = physics.add(createBox({
      x: level.start.x, y: spawnY, w: c.w, h: c.h,
      mass: c.mass, friction: c.friction, restitution: c.restitution, tag: "truck",
    }));
    truck.wheels = TRUCK.wheels.map((w) => ({ ...w, spin: 0, comp: 0, contact: false, load: 0 }));
    truck.crashed = false;
    truck.crashTimer = 0;
    truck.airTime = 0;
    truck.upsideTimer = 0;
    truck.progressTimer = 0;
    truck.progressLog = [];
    truck.distance = 0;
    if (!truck.group) {
      const built = buildTruckMesh();
      truck.group = built.group;
      truck.wheelMeshes = built.wheelMeshes;
      scene.add(truck.group);
    }
    truck.group.visible = true;
    syncTruckMesh();
  }

  /* ---------------- Levelaufbau ---------------- */
  const state = {
    levelIndex: 0, level: null, dir: 1, time: 0, attempts: 1,
    phase: "idle",          // idle | driving | crashed | won
    store: loadStore(),
    started: false,
    message: "",
  };

  function addStatic(def) {
    const angle = ((def.a ?? 0) * Math.PI) / 180;
    const friction = def.t === "wood" || def.t === "plank" || def.t === "ramp" ? 0.9 : 0.95;
    const body = physics.add(createBox({
      x: def.x, y: def.y, w: def.w, h: def.h, angle, friction, tag: def.t,
    }));
    const depth = 5;
    if (def.t === "ground") {
      const soil = boxMesh(def.w, def.h, depth, COLORS.soil);
      soil.position.set(def.x, def.y - 0.12, 0);
      levelGroup.add(soil);
      const turf = boxMesh(def.w, 0.32, depth + 0.02, COLORS.grass);
      turf.position.set(def.x, def.y + def.h / 2 - 0.02, 0);
      levelGroup.add(turf);
    } else if (def.t === "wall") {
      const m = boxMesh(def.w, def.h, depth * 0.8, COLORS.concrete);
      m.position.set(def.x, def.y, 0);
      m.rotation.z = angle;
      levelGroup.add(m);
    } else {
      const m = boxMesh(def.w, def.h, depth * 0.8, COLORS.wood);
      m.position.set(def.x, def.y, 0);
      m.rotation.z = angle;
      levelGroup.add(m);
      // Querbalken als Holzoptik
      const planks = Math.max(2, Math.round(def.w / 2.2));
      for (let i = 0; i < planks; i++) {
        const strip = boxMesh(0.16, def.h * 1.02, depth * 0.82, COLORS.woodDark);
        const t = -def.w / 2 + (def.w / planks) * (i + 0.5);
        strip.position.set(def.x + Math.cos(angle) * t, def.y + Math.sin(angle) * t, 0.01);
        strip.rotation.z = angle;
        levelGroup.add(strip);
      }
      // Stuetzen unter Planken/Rampen
      const legY = def.y - def.h / 2;
      if (legY > -6) {
        for (const side of [-1, 1]) {
          const lx = def.x + Math.cos(angle) * (side * (def.w / 2 - 0.4));
          const ly = def.y + Math.sin(angle) * (side * (def.w / 2 - 0.4)) - def.h / 2;
          const legH = Math.max(ly + 9, 1);
          const leg = boxMesh(0.42, legH, 0.6, COLORS.woodDark);
          leg.position.set(lx, ly - legH / 2, 0);
          levelGroup.add(leg);
        }
      }
    }
    return body;
  }

  function addDynamic(def) {
    const isCrate = def.t === "crate";
    const isSeesaw = def.t === "seesaw";
    const tilt = Math.abs((def.a ?? 0) * Math.PI) / 180;
    const body = physics.add(createBox({
      x: def.x, y: def.y, w: def.w, h: def.h, mass: def.mass,
      angle: ((def.a ?? 0) * Math.PI) / 180,
      friction: 0.8, restitution: 0.05, tag: def.t,
      pivot: isSeesaw,
      // Die Wippe liegt in beiden Endlagen auf -- sonst dreht sie durch.
      angleLimit: isSeesaw ? Math.max(tilt, 0.08) : null,
      angularDamping: isSeesaw ? 2.2 : 0,
    }));
    const color = isCrate ? COLORS.crate : def.t === "seesaw" ? COLORS.wood : COLORS.boulder;
    const mesh = boxMesh(def.w, def.h, def.t === "seesaw" ? 4 : Math.min(def.w, 2.4), color);
    levelGroup.add(mesh);
    if (def.t === "crate") {
      // Latten quer und laengs -> sieht nach Holzkiste aus, nicht nach Truck
      const depth = Math.min(def.w, 2.4);
      for (const off of [-def.h * 0.3, def.h * 0.3]) {
        const band = boxMesh(def.w * 1.03, def.h * 0.14, depth * 1.03, COLORS.crateBand);
        band.position.y = off;
        mesh.add(band);
      }
      const post = boxMesh(def.w * 0.12, def.h * 1.03, depth * 1.03, COLORS.crateBand);
      mesh.add(post);
    }
    if (def.t === "seesaw") {
      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 4.4, 10).rotateX(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: COLORS.pivot, roughness: 0.5, metalness: 0.4, flatShading: true })
      );
      pin.position.set(def.x, def.y, 0);
      levelGroup.add(pin);
      const stand = boxMesh(1.2, Math.max(def.y + 9, 1), 1.2, COLORS.concrete);
      stand.position.set(def.x, def.y - Math.max(def.y + 9, 1) / 2 - 0.2, 0);
      levelGroup.add(stand);
    }
    dynamicMeshes.push({ body, mesh });
    return body;
  }

  function buildFinish(level) {
    const g = new THREE.Group();
    const pole = boxMesh(0.24, 6, 0.24, 0xf2f4f8);
    pole.position.y = 3;
    g.add(pole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 2),
      new THREE.MeshBasicMaterial({ map: checker, side: THREE.DoubleSide })
    );
    flag.position.set(1.7 * state.dir, 4.6, 0);
    g.add(flag);
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 5.4),
      new THREE.MeshBasicMaterial({ map: checker, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    band.position.set(0, 2.7, 0);
    g.add(band);
    g.position.set(level.finish.x, level.finish.y, 0);
    levelGroup.add(g);
    finishMesh = g;
  }

  function loadLevel(index, keepAttempts = false) {
    state.levelIndex = clamp(index, 0, LEVELS.length - 1);
    const level = LEVELS[state.levelIndex];
    state.level = level;
    state.dir = level.finish.x >= level.start.x ? 1 : -1;
    state.time = 0;
    state.phase = "driving";
    state.started = false;
    state.message = "";
    state.record = false;
    if (!keepAttempts) state.attempts = 1;
    clearLevel();
    for (const def of level.bodies) {
      if (def.t === "crate" || def.t === "seesaw" || def.t === "boulder") addDynamic(def);
      else addStatic(def);
    }
    buildFinish(level);
    spawnTruck(level);
    camFollow.set(level.start.x, level.start.y + 2, 0);
    camInit = false;
    confetti.length = 0;
    confettiGroup.clear();
    notify();
  }

  /* ---------------- Fahrzeugphysik ---------------- */

  const tmpVel = { x: 0, y: 0 };
  const localPoint = { x: 0, y: 0 };

  function driveTruck(dt, input) {
    const body = truck.body;
    if (!body) return;
    const gas = truck.crashed ? 0 : clamp(input.gas ?? 0, 0, 1);
    const rev = truck.crashed ? 0 : clamp(input.reverse ?? 0, 0, 1);
    const drive = gas - rev;
    const ca = Math.cos(body.angle), sa = Math.sin(body.angle);
    const downX = sa, downY = -ca;            // Fahrzeug-Unterseite
    let anyContact = false;
    let totalLoad = 0;

    for (const w of truck.wheels) {
      // Aufhaengungspunkt in Weltkoordinaten
      const ax = body.x + w.ax * ca - w.ay * sa;
      const ay = body.y + w.ax * sa + w.ay * ca;
      const maxLen = TRUCK.restLen + TRUCK.travel + TRUCK.wheelRadius;
      const hit = physics.raycast(ax, ay, downX, downY, maxLen, body);
      if (!hit) {
        w.contact = false;
        w.comp = lerp(w.comp, 0, 0.2);
        w.load = 0;
        // frei drehendes Rad: Antrieb wirkt als Reaktionsmoment auf die Karosserie
        w.spin = clamp(w.spin + (drive * TRUCK.maxTorque) / TRUCK.wheelInertia * dt, -TRUCK.maxSpin, TRUCK.maxSpin);
        w.spin *= 1 - 2.5 * dt;
        body.omega += (drive * TRUCK.maxTorque * TRUCK.airTorque) * body.invInertia * dt;
        continue;
      }
      const restDist = TRUCK.restLen + TRUCK.wheelRadius;
      const comp = clamp(restDist - hit.dist, -TRUCK.travel, TRUCK.travel);
      w.comp = comp;
      if (comp <= 0) {
        w.contact = false;
        w.load = 0;
        w.spin = clamp(w.spin + (drive * TRUCK.maxTorque) / TRUCK.wheelInertia * dt, -TRUCK.maxSpin, TRUCK.maxSpin);
        w.spin *= 1 - 2.5 * dt;
        body.omega += (drive * TRUCK.maxTorque * TRUCK.airTorque) * body.invInertia * dt;
        continue;
      }
      w.contact = true;
      anyContact = true;

      // Federung entlang der Fahrzeug-Hochachse
      physics.velocityAt(body, ax, ay, tmpVel);
      const velAlong = tmpVel.x * downX + tmpVel.y * downY;
      // velAlong > 0 = Feder wird zusammengedrueckt -> Daempfer stemmt sich dagegen
      const damper = clamp(TRUCK.damping * velAlong, -TRUCK.maxDamperForce, TRUCK.maxDamperForce);
      const springF = TRUCK.stiffness * comp + damper;
      const load = clamp(springF, 0, TRUCK.maxSpringForce);
      w.load = load;
      totalLoad += load;
      physics.applyForce(body, -downX * load, -downY * load, ax, ay, dt);
      // Gegenkraft auf den Untergrund: ohne die kippt keine Wippe und keine
      // Kiste gibt unter dem Truck nach (drittes Newtonsches Gesetz).
      if (!hit.body.isStatic) {
        physics.applyForce(hit.body, downX * load, downY * load, hit.x, hit.y, dt);
      }

      // Reifenkraft entlang der Kontakt-Tangente
      const nx = hit.nx, ny = hit.ny;
      let tx = -ny, ty = nx;
      // Tangente in Fahrtrichtung orientieren
      const fwdX = ca, fwdY = sa;
      if (tx * fwdX + ty * fwdY < 0) { tx = -tx; ty = -ty; }
      const contactX = hit.x, contactY = hit.y;
      physics.velocityAt(body, contactX, contactY, tmpVel);
      const groundVel = tmpVel.x * tx + tmpVel.y * ty;
      const wheelSurf = w.spin * TRUCK.wheelRadius;
      const slip = wheelSurf - groundVel;
      const maxGrip = TRUCK.mu * load;
      const Ft = clamp(slip * TRUCK.slipStiffness, -maxGrip, maxGrip);
      // Die Reifenkraft greift an der Radnabe an, nicht am Aufstandspunkt.
      // Physikalisch unsauber, aber sonst stellt der kurze Hebel den Truck
      // bei jedem Antritt auf die Hinterraeder und er kippt nach hinten.
      const axleDist = TRUCK.restLen - comp;
      const axleX = ax + downX * axleDist;
      const axleY = ay + downY * axleDist;
      physics.applyForce(body, tx * Ft, ty * Ft, axleX, axleY, dt);
      if (!hit.body.isStatic) {
        physics.applyForce(hit.body, -tx * Ft, -ty * Ft, contactX, contactY, dt);
      }

      // Raddrehung: Antriebsmoment minus Reaktion der Reifenkraft.
      // Das Moment haengt an der Radlast -- ein entlastetes Rad dreht sonst
      // nur nutzlos durch (wirkt wie eine Differenzialsperre).
      const staticLoad = (TRUCK.chassis.mass * 26) / 2;
      const loadShare = clamp(load / staticLoad, 0.2, 1.15);
      const torque = drive * TRUCK.maxTorque * loadShare * (w.drive ? 1 : 0);
      w.spin += ((torque - Ft * TRUCK.wheelRadius) / TRUCK.wheelInertia) * dt;
      // Bremswirkung, wenn kein Gas gegeben wird
      if (Math.abs(drive) < 0.05) w.spin *= 1 - 1.6 * dt;
      w.spin = clamp(w.spin, -TRUCK.maxSpin, TRUCK.maxSpin);
    }

    truck.grounded = anyContact;
    if (anyContact) {
      truck.airTime = 0;
    } else {
      truck.airTime += dt;
      // In der Luft die Rotation daempfen: ohne das dreht sich der Truck nach
      // jeder Schanze unkontrolliert weiter und man kann nichts mehr retten.
      body.omega *= 1 - 1.3 * dt;
    }
    // Luftwiderstand
    body.vx *= 1 - TRUCK.airDrag * dt;
    body.omega = clamp(body.omega, -5.5, 5.5);
  }

  const SOLID = new Set(["ground", "plank", "ramp", "wall", "seesaw"]);

  function checkCrash(dt) {
    const body = truck.body;
    if (!body || truck.crashed) return;
    const level = state.level;
    if (body.y < (level.killY ?? -30)) { crash("abgestürzt"); return; }

    // Dach/Seite auf festem Gelaende aufgesetzt -> aus. Kisten und Brocken
    // zaehlen nicht, die darf man umfahren und auch mal auf dem Dach haben.
    let solidContact = false;
    for (const c of physics.contacts) {
      const other = c.a === body ? c.b : c.b === body ? c.a : null;
      if (!other) continue;
      if (!SOLID.has(other.tag)) continue;
      solidContact = true;
      if (c.depth < 0.012) continue;
      physics.toLocal(body, c.px, c.py, localPoint);
      if (localPoint.y > body.hh * 0.45) { crash("Dach aufgesetzt"); return; }
    }

    // Ueberschlag: in der Luft darf man rotieren (und sich retten) --
    // erst mit Bodenkontakt oder dauerhaft auf dem Kopf ist Schluss.
    const norm = Math.abs(mod(body.angle + Math.PI, Math.PI * 2) - Math.PI);
    if (norm > 1.75 && (truck.grounded || solidContact)) { crash("überschlagen"); return; }
    truck.upsideTimer = norm > 2.4 ? (truck.upsideTimer ?? 0) + dt : 0;
    if (truck.upsideTimer > 1.1) { crash("auf dem Dach gelandet"); return; }

    // Steckengeblieben: seit vier Sekunden kein Fortschritt, obwohl gefahren
    // wird (verkeilt zwischen Bohlen, an einer Kante haengend, ...).
    if (state.started) {
      truck.progressTimer = (truck.progressTimer ?? 0) + dt;
      if (truck.progressTimer >= 0.25) {
        truck.progressTimer = 0;
        truck.progressLog = truck.progressLog ?? [];
        truck.progressLog.push(body.x);
        if (truck.progressLog.length > 16) truck.progressLog.shift();
        if (truck.progressLog.length === 16) {
          const min = Math.min(...truck.progressLog);
          const max = Math.max(...truck.progressLog);
          if (max - min < 0.8) { crash("hängengeblieben"); return; }
        }
      }
    }
  }

  function crash(reason) {
    truck.crashed = true;
    truck.crashTimer = 0;
    state.phase = "crashed";
    state.message = reason;
    audio?.impact?.(9);
    notify();
  }

  function win() {
    if (state.phase === "won") return;
    state.phase = "won";
    const key = String(state.levelIndex);
    const prev = state.store.best[key];
    state.record = !prev || state.time < prev;
    if (state.record) state.store.best[key] = state.time;
    state.store.unlocked = Math.max(state.store.unlocked, Math.min(state.levelIndex + 2, LEVELS.length));
    saveStore(state.store);
    audio?.success?.();
    spawnConfetti();
    notify();
  }

  /* ---------------- Konfetti ---------------- */
  const confettiGroup = new THREE.Group();
  scene.add(confettiGroup);
  const confetti = [];
  function spawnConfetti() {
    const colors = [0xff5f6d, 0x36e0c8, 0xffd166, 0x7ec8ff, 0xffffff];
    for (let i = 0; i < 46; i++) {
      const m = boxMesh(0.24, 0.24, 0.06, colors[i % colors.length], { roughness: 0.6 });
      m.position.set(truck.body.x + (Math.random() - 0.5) * 3, truck.body.y + 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3);
      confettiGroup.add(m);
      confetti.push({
        mesh: m,
        vx: (Math.random() - 0.5) * 7, vy: 6 + Math.random() * 7, vz: (Math.random() - 0.5) * 5,
        rx: Math.random() * 8, rz: Math.random() * 8, life: 3,
      });
    }
  }
  function updateConfetti(dt) {
    for (let i = confetti.length - 1; i >= 0; i--) {
      const p = confetti[i];
      p.life -= dt;
      if (p.life <= 0) { confettiGroup.remove(p.mesh); confetti.splice(i, 1); continue; }
      p.vy -= 16 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += p.rx * dt;
      p.mesh.rotation.z += p.rz * dt;
    }
  }

  /* ---------------- Darstellung ---------------- */

  function syncTruckMesh() {
    const body = truck.body;
    if (!body || !truck.group) return;
    truck.group.position.set(body.x, body.y, 0);
    truck.group.rotation.z = body.angle;
    truck.wheels.forEach((w, i) => {
      const hub = truck.wheelMeshes[i];
      if (!hub) return;
      const drop = TRUCK.restLen - clamp(w.comp, -TRUCK.travel, TRUCK.travel);
      hub.position.set(w.ax, w.ay - drop, 0);
      for (const spin of hub.children) spin.rotation.z -= w.spin * 0.016;
    });
  }

  const camFollow = new THREE.Vector3();
  let camInit = false;
  let camZoom = 24;

  function updateCamera(dt) {
    const body = truck.body;
    if (!body) return;
    const speed = Math.hypot(body.vx, body.vy);
    const targetX = body.x + clamp(body.vx * 0.35, -6, 6);
    const targetY = body.y + 1.6;
    if (!camInit) { camFollow.set(targetX, targetY, 0); camInit = true; }
    camFollow.x = damp(camFollow.x, targetX, 6, dt);
    camFollow.y = damp(camFollow.y, targetY, 4, dt);
    camZoom = damp(camZoom, 23 + clamp(speed * 0.35, 0, 9), 2.5, dt);
    camera.position.set(camFollow.x, camFollow.y + 2.6, camZoom);
    camera.lookAt(camFollow.x, camFollow.y, 0);
    sun.position.set(camFollow.x - 30, camFollow.y + 60, 40);
    sun.target.position.set(camFollow.x, camFollow.y, 0);
    sun.target.updateMatrixWorld();
    bg.position.x = camFollow.x * 0.55;
    for (const c of clouds) {
      c.position.x += dt * 0.6;
      if (c.position.x > camFollow.x + 200) c.position.x -= 400;
    }
  }

  /* ---------------- Update ---------------- */

  let listeners = [];
  function notify() {
    for (const fn of listeners) fn(status());
  }

  function status() {
    const level = state.level;
    return {
      levelIndex: state.levelIndex,
      levelCount: LEVELS.length,
      name: level?.name ?? "",
      hint: level?.hint ?? "",
      time: state.time,
      attempts: state.attempts,
      phase: state.phase,
      message: state.message,
      best: state.store.best[String(state.levelIndex)] ?? null,
      unlocked: state.store.unlocked,
      record: !!state.record,
      isLast: state.levelIndex >= LEVELS.length - 1,
    };
  }

  function update(dt, rawInput) {
    if (state.phase === "idle" || !truck.body) return;
    const input = {
      gas: rawInput.gas ?? 0,
      reverse: rawInput.reverse ?? 0,
    };
    if (state.phase === "won") {
      input.gas = 0; input.reverse = 0;
    }
    if (!state.started && (input.gas > 0 || input.reverse > 0)) state.started = true;
    if (state.started && state.phase === "driving") state.time += dt;

    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-5 && guard++ < 10) {
      const step = Math.min(SUB_STEP, remaining);
      driveTruck(step, input);
      physics.step(step);
      if (state.phase === "driving") checkCrash(step);
      remaining -= step;
    }

    const body = truck.body;
    if (state.phase === "driving") {
      const reached = state.dir > 0 ? body.x >= state.level.finish.x : body.x <= state.level.finish.x;
      if (reached) win();
    }
    if (state.phase === "crashed") {
      truck.crashTimer += dt;
      if (truck.crashTimer > 1.5) restart();
    }

    // Motorsound ueber das bestehende Audio-Modul
    if (audio?.update) {
      const wheelSpin = Math.abs(truck.wheels[0]?.spin ?? 0);
      audio.update(dt, {
        rpm: clamp(900 + wheelSpin * 210, 850, 7200),
        throttleSmooth: Math.max(input.gas, input.reverse),
        speed: Math.hypot(body.vx, body.vy),
        nitroActive: false,
        events: { screech: truck.grounded ? clamp(wheelSpin * 0.06 - 0.25, 0, 0.6) : 0 },
      });
    }

    for (const { body: b, mesh } of dynamicMeshes) {
      mesh.position.set(b.x, b.y, mesh.position.z);
      mesh.rotation.z = b.angle;
    }
    syncTruckMesh();
    updateConfetti(dt);
    updateCamera(dt);
    if (finishMesh) finishMesh.children[1].rotation.y = Math.sin(performance.now() * 0.002) * 0.4;
  }

  function render() {
    renderer.render(scene, camera);
  }

  function resize(width, height) {
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  function restart() {
    state.attempts++;
    loadLevel(state.levelIndex, true);
  }

  function start(index = 0) {
    loadLevel(index);
  }

  function nextLevel() {
    if (state.levelIndex < LEVELS.length - 1) loadLevel(state.levelIndex + 1);
    else loadLevel(state.levelIndex);
  }

  function stop() {
    state.phase = "idle";
  }

  return {
    scene, camera, state, physics, truck,
    start, restart, nextLevel, stop, update, render, resize, status,
    levels: LEVELS,
    onChange(fn) { listeners.push(fn); },
    setLevel(i) { loadLevel(i); },
  };
}
