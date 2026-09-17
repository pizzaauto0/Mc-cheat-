// Arcade-Fahrphysik: Fahrradmodell mit Schraeglaufwinkeln + Reibkreis,
// 4-Punkt-Bodenabtastung fuer Rampen/Huegel, Spruenge und Drift-Erkennung.
import * as THREE from "three";
import { clamp, damp, lerp, sign, smoothstep, TAU } from "./util.js";
import { blobTexture } from "./textures.js";
import { SURF } from "./world.js";

const G = 9.81;

export const VEHICLES = [
  {
    id: "sprint", name: "Sprint 1.6", klass: "Kompakt", color: 0x2fb9ff, accentColor: 0xffffff,
    accel: 5.6, topSpeed: 51, brake: 13.0, mass: 1080,
    wheelbase: 2.5, track: 1.62, muMax: 10.2, corneringF: 7.4, corneringR: 7.9,
    steerMax: 0.62, yawInertia: 1.55, yawDamp: 3.0, rollK: 0.028,
    handbrakeMu: 0.42, driveType: "fwd", offroadMul: 0.82,
    nitroPower: 1.32, nitroTank: 3.4, nitroRegen: 0.34,
    body: { w: 1.72, l: 3.94, h: 0.56, cabin: 0.5, ride: 0.34, wheelR: 0.32, wheelW: 0.24, spoiler: false },
    stats: { speed: 0.42, accel: 0.48, grip: 0.62, drift: 0.34 },
  },
  {
    id: "muscle", name: "Brute V8", klass: "Muscle", color: 0xff4d3d, accentColor: 0x1a1a1a,
    accel: 8.4, topSpeed: 66, brake: 13.6, mass: 1660,
    wheelbase: 2.86, track: 1.84, muMax: 10.0, corneringF: 7.2, corneringR: 6.2,
    steerMax: 0.58, yawInertia: 2.05, yawDamp: 2.2, rollK: 0.026,
    handbrakeMu: 0.3, driveType: "rwd", offroadMul: 0.7,
    nitroPower: 1.42, nitroTank: 4.2, nitroRegen: 0.3,
    body: { w: 1.94, l: 4.72, h: 0.6, cabin: 0.46, ride: 0.34, wheelR: 0.35, wheelW: 0.3, spoiler: true },
    stats: { speed: 0.68, accel: 0.72, grip: 0.5, drift: 0.9 },
  },
  {
    id: "trail", name: "Trail 4x4", klass: "Offroad", color: 0xf5b942, accentColor: 0x2b2f36,
    accel: 5.0, topSpeed: 46, brake: 12.0, mass: 2050,
    wheelbase: 3.02, track: 1.92, muMax: 9.4, corneringF: 6.6, corneringR: 6.9,
    steerMax: 0.6, yawInertia: 2.4, yawDamp: 2.6, rollK: 0.036,
    handbrakeMu: 0.38, driveType: "awd", offroadMul: 1.04,
    nitroPower: 1.3, nitroTank: 3.6, nitroRegen: 0.32,
    body: { w: 2.04, l: 4.86, h: 0.78, cabin: 0.62, ride: 0.62, wheelR: 0.48, wheelW: 0.36, spoiler: false, rollbar: true },
    stats: { speed: 0.34, accel: 0.55, grip: 0.7, drift: 0.5 },
  },
  {
    id: "apex", name: "Apex GT", klass: "Supersport", color: 0x36e0c8, accentColor: 0x0b1220,
    accel: 11.5, topSpeed: 80, brake: 16.0, mass: 1320,
    wheelbase: 2.68, track: 1.86, muMax: 12.4, corneringF: 9.4, corneringR: 9.2,
    steerMax: 0.54, yawInertia: 1.7, yawDamp: 2.8, rollK: 0.022,
    handbrakeMu: 0.34, driveType: "awd", offroadMul: 0.6,
    nitroPower: 1.5, nitroTank: 4.6, nitroRegen: 0.36,
    body: { w: 1.92, l: 4.42, h: 0.46, cabin: 0.4, ride: 0.28, wheelR: 0.34, wheelW: 0.32, spoiler: true },
    stats: { speed: 0.95, accel: 0.92, grip: 0.88, drift: 0.66 },
  },
];

const GEAR_RATIOS = [3.42, 2.24, 1.6, 1.22, 0.98, 0.82];
const FINAL_DRIVE = 3.7;

/* ----------------------------------------------------------- Karosserie */

export function buildCarMesh(spec, { simple = false } = {}) {
  const b = spec.body;
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: spec.color, metalness: 0.55, roughness: 0.34 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.3, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0d151f, metalness: 0.2, roughness: 0.12, transparent: true, opacity: 0.86 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xcfd6e0, metalness: 0.92, roughness: 0.28 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xfff0c8, emissiveIntensity: 1.6 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x33060a, emissive: 0xff2a2a, emissiveIntensity: 1.1 });

  const bodyY = b.ride + b.h / 2;
  const lower = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.l), paint);
  lower.position.y = bodyY;
  group.add(lower);

  // Motorhaube / Heckklappe als flache Keile
  const hood = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.94, b.h * 0.42, b.l * 0.3), paint);
  hood.position.set(0, bodyY + b.h * 0.4, b.l * 0.29);
  group.add(hood);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.94, b.h * 0.38, b.l * 0.22), paint);
  trunk.position.set(0, bodyY + b.h * 0.38, -b.l * 0.34);
  group.add(trunk);

  // Kabine + Fenster
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.84, b.cabin, b.l * 0.42), paint);
  cabin.position.set(0, bodyY + b.h / 2 + b.cabin / 2 - 0.04, -b.l * 0.03);
  group.add(cabin);
  const win = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.86, b.cabin * 0.66, b.l * 0.43), glass);
  win.position.copy(cabin.position);
  win.position.y += 0.03;
  group.add(win);

  // Licht
  const hlOffset = b.w * 0.3;
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), lightMat);
    hl.position.set(s * hlOffset, bodyY + 0.02, b.l / 2 + 0.02);
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.08), tailMat);
    tl.position.set(s * hlOffset, bodyY + 0.06, -b.l / 2 - 0.02);
    group.add(tl);
  }
  // Stossfaenger
  for (const z of [b.l / 2 + 0.06, -b.l / 2 - 0.06]) {
    const bump = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.98, 0.2, 0.14), dark);
    bump.position.set(0, b.ride + 0.16, z);
    group.add(bump);
  }
  if (b.spoiler) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.92, 0.07, 0.34), dark);
    wing.position.set(0, bodyY + b.h * 0.72, -b.l / 2 + 0.16);
    group.add(wing);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.1), dark);
      post.position.set(s * b.w * 0.34, bodyY + b.h * 0.6, -b.l / 2 + 0.16);
      group.add(post);
    }
  }
  if (b.rollbar) {
    const bar = new THREE.Mesh(new THREE.TorusGeometry(b.w * 0.42, 0.05, 6, 12, Math.PI), dark);
    bar.position.set(0, bodyY + b.h / 2 + b.cabin * 0.4, -b.l * 0.3);
    bar.rotation.y = Math.PI / 2;
    group.add(bar);
    const lightBar = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.6, 0.12, 0.14), lightMat);
    lightBar.position.set(0, bodyY + b.h / 2 + b.cabin + 0.06, -b.l * 0.26);
    group.add(lightBar);
  }

  group.traverse((o) => { if (o.isMesh) { o.castShadow = !simple; o.receiveShadow = false; } });

  // Raeder
  const tireGeo = new THREE.CylinderGeometry(b.wheelR, b.wheelR, b.wheelW, simple ? 8 : 16);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(b.wheelR * 0.56, b.wheelR * 0.56, b.wheelW + 0.02, simple ? 6 : 10);
  rimGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  const wx = spec.track / 2, wz = spec.wheelbase / 2;
  const layout = [
    { x: wx, z: wz, front: true }, { x: -wx, z: wz, front: true },
    { x: wx, z: -wz, front: false }, { x: -wx, z: -wz, front: false },
  ];
  for (const l of layout) {
    const hub = new THREE.Group();
    hub.position.set(l.x, b.wheelR, l.z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, dark);
    tire.castShadow = !simple;
    spin.add(tire);
    const r = new THREE.Mesh(rimGeo, rim);
    spin.add(r);
    hub.add(spin);
    group.add(hub);
    wheels.push({ hub, spin, front: l.front, restY: b.wheelR, offX: l.x, offZ: l.z });
  }

  return { group, wheels, paint };
}

/* ------------------------------------------------------------- Fahrzeug */

export function createVehicle(scene, world, specId = "sprint", opts = {}) {
  const spec = VEHICLES.find((v) => v.id === specId) ?? VEHICLES[0];
  const { group: mesh, wheels } = buildCarMesh(spec);
  mesh.name = "player-car";
  scene.add(mesh);

  // Die Leistungskurve laeuft bei vMaxInternal auf null aus. Roll- und
  // Luftwiderstand werden so aufgeteilt, dass die Endgeschwindigkeit auf
  // Asphalt exakt spec.topSpeed ist (45 % Rollen, 55 % Luft).
  const vMaxInternal = spec.topSpeed * 1.12;
  const restAtTop = spec.accel * (1 - 1 / (1.12 * 1.12));
  const rollK = (0.45 * restAtTop) / spec.topSpeed;
  const dragK = (0.55 * restAtTop) / (spec.topSpeed * spec.topSpeed);

  // Kontaktschatten (auch ohne Shadowmaps sichtbar)
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.body.l * 1.15, spec.body.w * 1.5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture("rgba(0,0,0,.5)", "rgba(0,0,0,0)", 128), transparent: true, depthWrite: false })
  );
  blob.renderOrder = 2;
  scene.add(blob);

  // Scheinwerfer (nur nachts aktiv)
  const headlights = [];
  for (const s of [-1, 1]) {
    const light = new THREE.SpotLight(0xfff0d0, 0, 70, 0.42, 0.5, 1.4);
    light.position.set(s * spec.body.w * 0.3, spec.body.ride + 0.3, spec.body.l / 2);
    const target = new THREE.Object3D();
    target.position.set(s * spec.body.w * 0.4, -1.4, 26);
    mesh.add(light, target);
    light.target = target;
    light.visible = false;
    headlights.push(light);
  }

  const forward = new THREE.Vector3();
  const rightVec = new THREE.Vector3();
  const surf = { y: 0, nx: 0, ny: 1, nz: 0, grip: 1, kind: SURF.ROAD, onRamp: false };
  const wheelSurf = { y: 0, nx: 0, ny: 1, nz: 0, grip: 1, kind: SURF.ROAD, onRamp: false };

  const car = {
    spec, mesh, wheels,
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(0, 0, 0),       // Welt-Geschwindigkeit (y = vertikal)
    yaw: 0, yawRate: 0,
    steer: 0, pitch: 0, roll: 0,
    speed: 0, vLong: 0, vLat: 0,
    gear: 1, rpm: 900, throttleSmooth: 0,
    grounded: true, airTime: 0, climbRate: 0, prevGroundY: 0,
    nitro: spec.nitroTank, nitroActive: false,
    slipAngle: 0, drifting: false, driftTime: 0, wheelSpin: 0,
    surface: SURF.ROAD, grip: 1, odometer: 0, topSpeedSeen: 0,
    events: { impact: 0, landed: 0, cones: 0, shifted: false, screech: 0, dust: 0, airLaunch: 0 },
    headlights,
  };

  const wheelWorld = wheels.map(() => ({ x: 0, z: 0, y: 0, groundY: 0, surfKind: SURF.ROAD, slip: 0 }));
  car.wheelWorld = wheelWorld;

  function reset(spawn) {
    car.pos.set(spawn.x, (spawn.y ?? world.heightAt(spawn.x, spawn.z)) + spec.body.ride + 0.2, spawn.z);
    car.vel.set(0, 0, 0);
    car.yaw = spawn.yaw ?? 0;
    car.yawRate = 0; car.steer = 0; car.pitch = 0; car.roll = 0;
    car.speed = 0; car.vLong = 0; car.vLat = 0; car.gear = 1; car.rpm = 900;
    car.grounded = true; car.airTime = 0; car.climbRate = 0;
    car.nitro = spec.nitroTank;
    car.drifting = false; car.driftTime = 0;
    car.prevGroundY = world.heightAt(spawn.x, spawn.z);
    syncMesh();
  }

  function contactHeights() {
    let sum = 0, front = 0, rear = 0, left = 0, right = 0;
    const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      const wx = car.pos.x + w.offX * c + w.offZ * s;
      const wz = car.pos.z - w.offX * s + w.offZ * c;
      const ww = wheelWorld[i];
      ww.x = wx; ww.z = wz;
      world.sampleSurface(wx, wz, wheelSurf);
      ww.groundY = wheelSurf.y;
      ww.surfKind = wheelSurf.kind;
      sum += wheelSurf.y;
      if (w.front) front += wheelSurf.y / 2; else rear += wheelSurf.y / 2;
      if (w.offX > 0) right += wheelSurf.y / 2; else left += wheelSurf.y / 2;
    }
    return { avg: sum / wheels.length, front, rear, left, right };
  }

  function update(dt, input) {
    const ev = car.events;
    ev.impact = 0; ev.landed = 0; ev.cones = 0; ev.shifted = false; ev.airLaunch = 0;

    const b = spec.body;
    const throttleIn = clamp(input.throttle ?? 0, 0, 1);
    const brakeIn = clamp(input.brake ?? 0, 0, 1);
    // input.steer folgt der ueblichen Achsenkonvention (-1 = links, +1 = rechts).
    // Die interne Fahrphysik (forward/rightVec, Gierrichtung) benutzt dagegen ein
    // Koordinatensystem, in dem positives car.steer optisch nach LINKS lenkt --
    // deshalb hier einmal umdrehen, statt an jeder Formel unten das Vorzeichen
    // nachzuziehen. Durch Playwright-Projektionstest verifiziert.
    const steerIn = -clamp(input.steer ?? 0, -1, 1);
    const handbrake = !!input.handbrake;

    car.throttleSmooth = damp(car.throttleSmooth, throttleIn, 9, dt);

    // --- Untergrund unter dem Schwerpunkt
    world.sampleSurface(car.pos.x, car.pos.z, surf);
    car.surface = surf.kind;
    const offroad = surf.kind === SURF.GRASS || surf.kind === SURF.DIRT;
    const gripScale = surf.grip * (offroad ? spec.offroadMul : 1);
    car.grip = gripScale;
    const mu = spec.muMax * gripScale;

    // --- Richtungsvektoren
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    forward.set(sy, 0, cy);
    rightVec.set(cy, 0, -sy);
    car.vLong = car.vel.x * sy + car.vel.z * cy;
    car.vLat = car.vel.x * cy - car.vel.z * sy;
    car.speed = Math.hypot(car.vel.x, car.vel.z);

    // --- Lenkung (bei hoher Geschwindigkeit weniger Einschlag)
    const speedFade = lerp(1, 0.42, smoothstep(6, spec.topSpeed * 0.85, car.speed));
    const steerTarget = steerIn * spec.steerMax * speedFade;
    car.steer = damp(car.steer, steerTarget, 11, dt);

    // --- Nitro
    car.nitroActive = !!input.nitro && car.nitro > 0.05 && car.grounded && throttleIn > 0.1;
    if (car.nitroActive) car.nitro = Math.max(0, car.nitro - dt);
    else car.nitro = Math.min(spec.nitroTank, car.nitro + dt * spec.nitroRegen);
    const nitroMul = car.nitroActive ? spec.nitroPower : 1;

    // --- Laengsdynamik
    let driveAccel = 0, brakeAccel = 0;
    const speedRatio = clamp(Math.abs(car.vLong) / vMaxInternal, 0, 1.4);
    const powerFade = clamp(1 - speedRatio * speedRatio, 0, 1);
    const reversing = car.vLong < 0.4 && brakeIn > 0.3 && throttleIn < 0.1;

    if (car.grounded) {
      if (throttleIn > 0.01 && !reversing) {
        driveAccel = spec.accel * powerFade * throttleIn * nitroMul * clamp(gripScale + 0.18, 0.3, 1);
      }
      if (reversing) {
        const revRatio = clamp(Math.abs(car.vLong) / 13, 0, 1);
        driveAccel = -spec.accel * 0.42 * (1 - revRatio) * brakeIn;
      } else if (brakeIn > 0.01) {
        brakeAccel = -sign(car.vLong) * spec.brake * brakeIn * gripScale;
        if (Math.abs(car.vLong) < 0.4) brakeAccel = 0;
      }
      if (handbrake) brakeAccel += -sign(car.vLong) * 5.2 * gripScale;
    }
    // weicher Untergrund rollt deutlich schwerer
    const rollExtra = surf.kind === SURF.GRASS ? 0.14 : surf.kind === SURF.DIRT ? 0.05 : 0;
    const dragAccel = -car.vLong * Math.abs(car.vLong) * dragK - car.vLong * (rollK + rollExtra);

    // --- Querdynamik (Schraeglaufwinkel vorne/hinten)
    const a = spec.wheelbase * 0.5, bb = spec.wheelbase * 0.5;
    const absLong = Math.max(Math.abs(car.vLong), 1.4);
    const dirSign = car.vLong >= 0 ? 1 : -1;
    const slipF = Math.atan2(car.vLat + car.yawRate * a, absLong) - car.steer * dirSign;
    const slipR = Math.atan2(car.vLat - car.yawRate * bb, absLong);

    // Reibkreis: harter Antrieb/Bremse frisst Seitenhaftung
    const longUse = clamp(Math.abs(driveAccel + brakeAccel) / Math.max(mu, 0.01), 0, 1);
    const latCap = mu * Math.sqrt(Math.max(0.12, 1 - longUse * longUse * 0.7));
    const driven = spec.driveType;
    const frontDrivePenalty = driven === "fwd" ? 0.86 : driven === "awd" ? 0.94 : 1;
    const rearDrivePenalty = driven === "rwd" ? 0.84 : driven === "awd" ? 0.94 : 1;

    let fF = -clamp(slipF * spec.corneringF, -latCap * frontDrivePenalty, latCap * frontDrivePenalty);
    let rearMu = latCap * rearDrivePenalty * (handbrake ? spec.handbrakeMu : 1);
    let fR = -clamp(slipR * spec.corneringR, -rearMu, rearMu);
    if (!car.grounded) { fF = 0; fR = 0; }

    // --- Beschleunigungen zusammensetzen
    const longAccel = driveAccel + brakeAccel + dragAccel - Math.sin(Math.abs(car.steer)) * Math.abs(fF) * 0.25;
    const latAccel = fF * Math.cos(car.steer) + fR;

    let ax = forward.x * longAccel + rightVec.x * latAccel;
    let az = forward.z * longAccel + rightVec.z * latAccel;
    if (car.grounded) {                       // Schwerkraft entlang der Flaeche
      ax += G * surf.ny * surf.nx;
      az += G * surf.ny * surf.nz;
    } else {                                  // Luftwiderstand in der Luft
      ax -= car.vel.x * 0.06;
      az -= car.vel.z * 0.06;
    }

    car.vel.x += ax * dt;
    car.vel.z += az * dt;

    // --- Gierdynamik
    if (car.grounded) {
      const yawAccel = (a * fF * Math.cos(car.steer) - bb * fR) / spec.yawInertia;
      car.yawRate += yawAccel * dt;
      const damping = spec.yawDamp * (1 + (handbrake ? 0.2 : 0)) * lerp(1.8, 1, smoothstep(0, 14, car.speed));
      car.yawRate -= car.yawRate * clamp(damping * dt, 0, 0.9);
    } else {
      car.yawRate -= car.yawRate * clamp(0.6 * dt, 0, 0.5);
      car.yawRate += steerIn * 0.9 * dt;      // leichte Luftkontrolle
    }
    car.yawRate = clamp(car.yawRate, -3.4, 3.4);
    car.yaw += car.yawRate * dt;

    // --- Position
    car.pos.x += car.vel.x * dt;
    car.pos.z += car.vel.z * dt;
    const limit = world.half - 10;
    car.pos.x = clamp(car.pos.x, -limit, limit);
    car.pos.z = clamp(car.pos.z, -limit, limit);
    car.odometer += car.speed * dt;
    car.topSpeedSeen = Math.max(car.topSpeedSeen, car.speed);

    // --- Boden / Luft
    const contact = contactHeights();
    const targetY = contact.avg + b.ride;
    const climb = (contact.avg - car.prevGroundY) / Math.max(dt, 1e-4);
    car.prevGroundY = contact.avg;

    if (car.grounded) {
      car.climbRate = lerp(car.climbRate, climb, 0.4);
      if (car.pos.y - targetY > 0.32 && car.speed > 4) {
        // Boden weggefallen -> Sprung, vertikale Geschwindigkeit aus der Rampe
        car.grounded = false;
        car.vel.y = clamp(car.climbRate, 0, 26);
        ev.airLaunch = car.speed;
      } else {
        car.pos.y = damp(car.pos.y, targetY, 16, dt);
        car.vel.y = 0;
        if (car.airTime > 0.25) ev.landed = car.airTime;
        car.airTime = 0;
      }
    }
    if (!car.grounded) {
      car.vel.y -= G * 1.25 * dt;
      car.pos.y += car.vel.y * dt;
      car.airTime += dt;
      if (car.pos.y <= targetY) {
        car.pos.y = targetY;
        const impact = -car.vel.y;
        car.grounded = true;
        car.vel.y = 0;
        car.climbRate = 0;
        if (car.airTime > 0.25) ev.landed = car.airTime;
        if (impact > 12) {                    // harte Landung bremst
          car.vel.x *= 0.88; car.vel.z *= 0.88;
          ev.impact = Math.max(ev.impact, impact * 0.25);
        }
        car.airTime = 0;
      }
    }

    // --- Kollisionen mit Statik
    const radius = Math.max(b.w, b.l * 0.55) * 0.5;
    const hit = world.resolveCircle(car.pos.x, car.pos.z, radius, car.pos.y - b.ride);
    if (hit.hit) {
      car.pos.x += hit.nx * hit.depth;
      car.pos.z += hit.nz * hit.depth;
      const vn = car.vel.x * hit.nx + car.vel.z * hit.nz;
      if (vn < 0) {
        car.vel.x -= hit.nx * vn * (1 + hit.bounce);
        car.vel.z -= hit.nz * vn * (1 + hit.bounce);
        // Schrammen: Tangentialanteil daempfen
        const tx = -hit.nz, tz = hit.nx;
        const vt = car.vel.x * tx + car.vel.z * tz;
        car.vel.x -= tx * vt * 0.12;
        car.vel.z -= tz * vt * 0.12;
        car.yawRate *= 0.55;
        ev.impact = Math.max(ev.impact, -vn);
      }
    }
    ev.cones = world.hitProps(car.pos.x, car.pos.z, radius + 0.3, car.vel.x, car.vel.z);

    // --- Drift / Reifen
    car.speed = Math.hypot(car.vel.x, car.vel.z);
    car.slipAngle = Math.abs(Math.atan2(car.vLat, Math.max(Math.abs(car.vLong), 1)));
    const wheelSlip = clamp(
      (Math.abs(slipR) * 0.6 + Math.abs(slipF) * 0.25) * clamp(car.speed / 8, 0, 1) +
      (handbrake && car.speed > 3 ? 0.35 : 0) +
      (throttleIn > 0.6 && car.speed < 8 && driven !== "fwd" ? 0.2 : 0),
      0, 1.4
    );
    car.wheelSpin = wheelSlip;
    car.drifting = car.grounded && car.speed > 7 && car.slipAngle > 0.18;
    car.driftTime = car.drifting ? car.driftTime + dt : 0;
    ev.screech = car.grounded && surf.kind !== SURF.GRASS ? clamp(wheelSlip * 1.2 - 0.15, 0, 1) : 0;
    ev.dust = car.grounded && offroad ? clamp(car.speed / 26 + wheelSlip * 0.4, 0, 1) : 0;

    // --- Gaenge/Drehzahl (fuer HUD + Motorsound)
    updateGearbox(dt, throttleIn, reversing, ev);

    syncMesh(contact, dt);
  }

  function updateGearbox(dt, throttleIn, reversing, ev) {
    const wheelCirc = TAU * spec.body.wheelR;
    const wheelRps = Math.abs(car.vLong) / wheelCirc;
    if (reversing) {
      car.gear = -1;
      car.rpm = lerp(car.rpm, 1200 + wheelRps * 60 * 3.6 * FINAL_DRIVE, 0.2);
      return;
    }
    if (car.gear < 1) car.gear = 1;
    const ratio = GEAR_RATIOS[car.gear - 1];
    let rpm = wheelRps * ratio * FINAL_DRIVE * 60;
    rpm = clamp(rpm, 850, 7600);
    if (rpm > 6800 && car.gear < GEAR_RATIOS.length) { car.gear++; ev.shifted = true; }
    else if (rpm < 2500 && car.gear > 1) { car.gear--; ev.shifted = true; }
    const target = clamp(wheelRps * GEAR_RATIOS[car.gear - 1] * FINAL_DRIVE * 60, 850, 7400);
    const idleBlip = car.speed < 1 ? 850 + throttleIn * 2600 : target;
    car.rpm = lerp(car.rpm, Math.max(target, idleBlip * 0.9), 1 - Math.exp(-9 * dt));
  }

  const tmpEuler = new THREE.Euler();
  function syncMesh(contact, dt = 0.016) {
    const b = spec.body;
    mesh.position.copy(car.pos);
    if (contact) {
      const targetPitch = Math.atan2(contact.rear - contact.front, spec.wheelbase);
      const targetRoll = Math.atan2(contact.right - contact.left, spec.track);
      const airPitch = car.grounded ? targetPitch : clamp(Math.atan2(-car.vel.y, Math.max(car.speed, 4)) * 0.7, -0.5, 0.5);
      const lambda = car.grounded ? 12 : 3.5;
      car.pitch = damp(car.pitch, airPitch, lambda, dt);
      car.roll = damp(car.roll, car.grounded ? targetRoll : 0, lambda, dt);
      // Karosserie-Neigung durch Querkraft/Beschleunigung
      const dynRoll = clamp(-car.vLat * car.yawRate * 0.004 - car.yawRate * car.speed * 0.0016, -0.09, 0.09);
      tmpEuler.set(car.pitch, car.yaw, car.roll + dynRoll, "YXZ");
      mesh.quaternion.setFromEuler(tmpEuler);
    } else {
      tmpEuler.set(0, car.yaw, 0, "YXZ");
      mesh.quaternion.setFromEuler(tmpEuler);
    }

    // Raeder: Federweg, Lenkung, Drehung
    const spinDelta = (car.vLong / b.wheelR) * dt;
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      const ww = car.wheelWorld[i];
      // Restfederweg: Abweichung des Bodens unter diesem Rad von der Kontaktebene
      const rel = clamp((ww.groundY - (car.pos.y - b.ride)) * 0.35, -0.2, 0.2);
      w.hub.position.y = lerp(w.hub.position.y, b.wheelR + (car.grounded ? rel : -0.06), 0.4);
      if (w.front) w.hub.rotation.y = car.steer;
      w.spin.rotation.x += spinDelta * (1 + car.wheelSpin * 0.8);
    }

    // Kontaktschatten
    const groundY = car.grounded ? car.pos.y - b.ride : world.heightAt(car.pos.x, car.pos.z);
    blob.position.set(car.pos.x, groundY + 0.05, car.pos.z);
    blob.rotation.y = -car.yaw;
    const airFade = clamp(1 - (car.pos.y - b.ride - groundY) / 6, 0.12, 1);
    blob.material.opacity = 0.3 * airFade;
    blob.scale.setScalar(lerp(1.25, 1, airFade));
  }

  function setNight(on) {
    for (const l of headlights) {
      l.visible = on;
      l.intensity = on ? 120 : 0;
    }
  }

  function dispose() {
    scene.remove(mesh, blob);
  }

  car.reset = reset;
  car.update = update;
  car.setNight = setNight;
  car.dispose = dispose;
  car.dragK = dragK;
  return car;
}
