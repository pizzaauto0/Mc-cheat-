// Asphalt Drift -- Spielsteuerung: Setup, Modi, Renderloop, Menues.
import * as THREE from "three";
import { createWorld, SURF } from "./world.js";
import { createVehicle, VEHICLES } from "./vehicle.js";
import { createInput } from "./input.js";
import { createCameraRig } from "./camera.js";
import { createEffects } from "./effects.js";
import { createSky } from "./sky.js";
import { createAudio } from "./audio.js";
import { createTraffic } from "./traffic.js";
import { createHud } from "./hud.js";
import { clamp, lerp, formatTime, formatNumber, toKmh } from "./util.js";

const STORAGE_KEY = "asphalt-drift.v1";
const DRIFT_DURATION = 120;

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/* ------------------------------------------------------------ Persistenz */

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch { return {}; }
}
function saveStore(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* egal */ }
}

/* ------------------------------------------------------------------ Boot */

const game = {
  state: "loading",          // loading | menu | play | pause | result
  mode: "freeroam",
  carId: "sprint",
  settings: { shadows: true, traffic: true, quality: 0.8 },
  store: loadStore(),
  stats: null,
};
window.__game = game;

const canvas = $("viewport");
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: "high-performance", stencil: false,
});
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 2600);
scene.add(camera);

const hud = createHud();
const audio = createAudio();
const input = createInput();

let world, car, traffic, effects, sky, camRig, gates = [];

function applyQuality() {
  const q = Number(game.settings.quality) || 0.8;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * q);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = !!game.settings.shadows;
  if (sky) sky.setShadows(!!game.settings.shadows);
}

/* --------------------------------------------------------- Checkpoint-Tore */

function buildGates(route) {
  const group = new THREE.Group();
  group.name = "gates";
  const pillarGeo = new THREE.BoxGeometry(0.7, 7, 0.7);
  const barGeo = new THREE.BoxGeometry(17, 0.8, 0.7);
  const list = route.map((cp, i) => {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0d2a2a, emissive: new THREE.Color(0x36e0c8), emissiveIntensity: 0.6,
      roughness: 0.4, metalness: 0.2,
    });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(pillarGeo, mat);
      p.position.set(s * 8.2, 3.5, 0);
      g.add(p);
    }
    const bar = new THREE.Mesh(barGeo, mat);
    bar.position.y = 7.2;
    g.add(bar);
    const veil = new THREE.Mesh(
      new THREE.PlaneGeometry(16.4, 7),
      new THREE.MeshBasicMaterial({ color: 0x36e0c8, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
    );
    veil.position.y = 3.5;
    g.add(veil);
    g.position.set(cp.x, cp.y ?? world.terrainHeightAt(cp.x, cp.z), cp.z);
    g.rotation.y = cp.yaw + Math.PI / 2;     // Tor quer zur Fahrtrichtung
    group.add(g);
    return { group: g, mat, veil, x: cp.x, z: cp.z, y: cp.y ?? 0, index: i };
  });
  scene.add(group);
  group.visible = false;
  list.container = group;
  return list;
}

function setGateHighlight(nextIdx) {
  gates.forEach((gate, i) => {
    const done = nextIdx > i;
    const active = nextIdx === i;
    gate.mat.emissive.setHex(active ? 0x36e0c8 : done ? 0x1b3f3a : 0xffd166);
    gate.mat.emissiveIntensity = active ? 1.8 : done ? 0.25 : 0.5;
    gate.veil.material.color.setHex(active ? 0x36e0c8 : 0xffd166);
    gate.veil.material.opacity = active ? 0.2 : 0.05;
  });
}

/* ------------------------------------------------------------------ Modi */

function bestKey(mode, carId) { return `best.${mode}.${carId}`; }

function makeModeController(mode) {
  const s = {
    mode, elapsed: 0, started: false, finished: false,
    score: 0, driftBank: 0, driftMult: 1, driftIdle: 0, lastDrift: 0,
    nextCheckpoint: 0, lapTime: 0, cones: 0, bigAir: 0, airBank: 0,
  };

  const bestRaw = game.store[bestKey(mode, game.carId)];

  function addDrift(dt) {
    if (car.drifting) {
      s.driftIdle = 0;
      s.driftMult = clamp(1 + car.driftTime * 0.55, 1, 5);
      const gain = car.speed * car.slipAngle * 5.5 * s.driftMult * dt;
      s.driftBank += gain;
      s.lastDrift = s.driftBank;
    } else {
      s.driftIdle += dt;
      if (s.driftBank > 0 && s.driftIdle > 0.9) {
        s.score += s.driftBank;
        s.driftBank = 0;
        s.driftMult = 1;
      }
    }
  }

  function addAir(landedTime) {
    if (landedTime > 0.35) {
      const pts = landedTime * 90 + car.speed * 5;
      s.score += pts;
      s.bigAir = Math.max(s.bigAir, landedTime);
      hud.toast(`${landedTime.toFixed(1)} s Airtime  +${formatNumber(pts)}`, 1.6);
    }
  }

  function update(dt, frameEvents) {
    if (!s.started) {
      if (car.speed > 1.2 || input.read().any) s.started = true;
    }
    if (s.started && !s.finished) s.elapsed += dt;

    if (mode === "drift" || mode === "freeroam") {
      addDrift(dt);
      if (frameEvents.landed) addAir(frameEvents.landed);
      if (frameEvents.cones) {
        s.cones += frameEvents.cones;
        s.score += frameEvents.cones * 25;
      }
    }

    if (mode === "drift" && s.started && !s.finished && s.elapsed >= DRIFT_DURATION) {
      s.score += s.driftBank;
      s.driftBank = 0;
      finish();
    }

    if (mode === "timetrial" && !s.finished) {
      const gate = gates[s.nextCheckpoint];
      if (gate) {
        const dx = car.pos.x - gate.x, dz = car.pos.z - gate.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 15 && Math.abs(car.pos.y - gate.y) < 14) {
          s.nextCheckpoint++;
          audio.checkpoint();
          setGateHighlight(s.nextCheckpoint);
          if (s.nextCheckpoint >= gates.length) finish();
          else hud.toast(`Checkpoint ${s.nextCheckpoint}/${gates.length}  ·  ${formatTime(s.elapsed * 1000)}`, 1.3);
        }
      }
    }
  }

  function finish() {
    if (s.finished) return;
    s.finished = true;
    const key = bestKey(mode, game.carId);
    let record = false;
    if (mode === "timetrial") {
      const prev = game.store[key];
      if (!prev || s.elapsed < prev) { game.store[key] = s.elapsed; record = true; saveStore(game.store); }
    } else if (mode === "drift") {
      const prev = game.store[key];
      if (!prev || s.score > prev) { game.store[key] = s.score; record = true; saveStore(game.store); }
    }
    audio.success();
    showResult(s, record);
  }

  function display() {
    const best = game.store[bestKey(mode, game.carId)];
    const drift = {
      active: s.driftBank > 12,
      points: s.driftBank,
      mult: s.driftMult,
      label: car.drifting ? "DRIFT" : "+",
    };
    if (mode === "timetrial") {
      return {
        title: "Zeitfahren",
        main: formatTime(s.elapsed * 1000),
        sub: `Checkpoint ${Math.min(s.nextCheckpoint + 1, gates.length)}/${gates.length}`,
        score: null,
        best: best ? formatTime(best * 1000) : "—",
        target: gates[s.nextCheckpoint] ?? null,
        checkpoints: gates,
        nextCheckpoint: s.nextCheckpoint,
        drift: null,
      };
    }
    if (mode === "drift") {
      const left = Math.max(0, DRIFT_DURATION - s.elapsed);
      return {
        title: "Drift-Challenge",
        main: formatTime(left * 1000),
        sub: s.started ? `Kette x${s.driftMult.toFixed(1)}` : "Gib Gas, die Zeit startet mit dir",
        score: s.score + s.driftBank,
        best: best ? formatNumber(best) : "—",
        drift,
      };
    }
    return {
      title: "Freies Fahren",
      main: `${Math.round(toKmh(car.speed))} km/h`,
      sub: `${(car.odometer / 1000).toFixed(2)} km gefahren · Top ${Math.round(toKmh(car.topSpeedSeen))} km/h`,
      score: s.score + s.driftBank,
      best: null,
      drift,
    };
  }

  return { state: s, update, display, finish, bestRaw };
}

let modeCtl = null;

/* -------------------------------------------------------------- Ergebnis */

function showResult(s, record) {
  game.state = "result";
  input.setEnabled(false);
  const title = $("resultTitle"), big = $("resultBig"), stats = $("resultStats");
  if (s.mode === "timetrial") {
    title.textContent = record ? "Neuer Rundenrekord!" : "Ziel erreicht";
    big.textContent = formatTime(s.elapsed * 1000);
    stats.innerHTML = `
      <div>Checkpoints: <b>${gates.length}/${gates.length}</b></div>
      <div>Höchstgeschwindigkeit: <b>${Math.round(toKmh(car.topSpeedSeen))} km/h</b></div>
      <div>Bestzeit: <b>${formatTime((game.store[bestKey("timetrial", game.carId)] ?? 0) * 1000)}</b></div>`;
  } else {
    title.textContent = record ? "Neuer Punkterekord!" : "Zeit abgelaufen";
    big.textContent = formatNumber(s.score);
    stats.innerHTML = `
      <div>Längster Drift: <b>${formatNumber(s.lastDrift)}</b> Punkte</div>
      <div>Beste Airtime: <b>${s.bigAir.toFixed(1)} s</b></div>
      <div>Hütchen erwischt: <b>${s.cones}</b></div>
      <div>Rekord: <b>${formatNumber(game.store[bestKey("drift", game.carId)] ?? s.score)}</b></div>`;
  }
  $("result").classList.remove("hidden");
}

/* ------------------------------------------------------------ Spielstart */

function startRun(mode, carId) {
  game.mode = mode;
  game.carId = carId ?? game.carId;

  if (!car || car.spec.id !== game.carId) {
    if (car) car.dispose();
    car = createVehicle(scene, world, game.carId);
    window.__game.car = car;
  }
  const spawn = world.spawns[mode] ?? world.spawns.freeroam;
  car.reset(spawn);
  car.setNight(sky.isNight);
  effects.clearMarks();
  camRig.reset();
  camRig.setMode(mode === "timetrial" ? "chase" : "chase");

  gates.container.visible = mode === "timetrial";
  if (mode === "timetrial") setGateHighlight(0);

  traffic.setVisible(!!game.settings.traffic && mode !== "drift");
  modeCtl = makeModeController(mode);
  window.__game.modeCtl = modeCtl;

  game.state = "play";
  input.setEnabled(true);
  $("menu").classList.add("hidden");
  $("pause").classList.add("hidden");
  $("result").classList.add("hidden");
  hud.show();
  audio.resume();

  const hints = {
    freeroam: "Stadt, Stuntpark im Osten, Driftkreis im Westen — viel Spaß.",
    drift: "Handbremse + Gas: Winkel halten, Kette nicht abreißen lassen.",
    timetrial: "Folge dem Pfeil durch alle Tore. Nitro spart Zehntel.",
  };
  hud.toast(hints[mode] ?? "", 3.4);
}

/* -------------------------------------------------------- Frame-Logik */

const frameEvents = { impact: 0, landed: 0, cones: 0, screech: 0, dust: 0, shifted: false, airLaunch: 0 };

function stepPhysics(dt) {
  const inp = input.read();
  frameEvents.impact = 0; frameEvents.landed = 0; frameEvents.cones = 0;
  frameEvents.screech = 0; frameEvents.dust = 0; frameEvents.shifted = false; frameEvents.airLaunch = 0;

  const h = 1 / 120;
  let remaining = dt;
  let guard = 0;
  while (remaining > 1e-5 && guard++ < 12) {
    const step = Math.min(h, remaining);
    car.update(step, inp);
    remaining -= step;
    const ev = car.events;
    frameEvents.impact = Math.max(frameEvents.impact, ev.impact);
    frameEvents.landed = Math.max(frameEvents.landed, ev.landed);
    frameEvents.cones += ev.cones;
    frameEvents.screech = Math.max(frameEvents.screech, ev.screech);
    frameEvents.dust = Math.max(frameEvents.dust, ev.dust);
    frameEvents.shifted = frameEvents.shifted || ev.shifted;
    frameEvents.airLaunch = Math.max(frameEvents.airLaunch, ev.airLaunch);
  }

  if (game.settings.traffic && traffic) {
    const impact = traffic.collide(car);
    if (impact > 0) frameEvents.impact = Math.max(frameEvents.impact, impact);
  }

  // --- Effekte
  const b = car.spec.body;
  for (let i = 0; i < car.wheelWorld.length; i++) {
    const ww = car.wheelWorld[i];
    const onDirt = ww.surfKind === SURF.GRASS || ww.surfKind === SURF.DIRT;
    const intensity = car.grounded ? clamp(car.wheelSpin * 1.1 - 0.12, 0, 1) : 0;
    effects.wheelTrail(i, ww.x, ww.groundY, ww.z, b.wheelW * 0.55, onDirt ? intensity * 0.5 : intensity, onDirt ? 0.28 : 0.05);
    if (onDirt && car.grounded && car.speed > 4) {
      effects.emitDust(ww.x, ww.groundY, ww.z, dt * (car.speed * 0.5 + car.wheelSpin * 14), 1);
    } else if (intensity > 0.35 && car.grounded) {
      effects.emitDust(ww.x, ww.groundY, ww.z, dt * intensity * 9, 0);
    }
  }
  if (car.nitroActive) {
    const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
    effects.emitNitro(car.pos.x - s * b.l * 0.55, car.pos.y + 0.25, car.pos.z - c * b.l * 0.55);
  }
  if (frameEvents.impact > 3) {
    effects.emitSparks(car.pos.x, car.pos.y + 0.3, car.pos.z, frameEvents.impact);
    camRig.addShake(clamp(frameEvents.impact / 16, 0.08, 1));
    audio.impact(frameEvents.impact);
  }
  if (frameEvents.landed > 0.3) {
    camRig.addShake(clamp(frameEvents.landed * 0.4, 0.1, 0.8));
    audio.land(frameEvents.landed);
  }
  if (frameEvents.cones > 0) audio.coneHit();
  if (frameEvents.shifted) audio.shift();

  modeCtl?.update(dt, frameEvents);
}

let last = performance.now();
let fpsAccum = 0, fpsFrames = 0, fps = 60;

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  last = now;
  const dt = clamp(rawDt, 0.0005, 0.05);

  fpsAccum += rawDt; fpsFrames++;
  if (fpsAccum > 0.5) { fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; }

  if (!world || !car) return;

  if (game.state === "play") {
    stepPhysics(dt);
    world.update(dt);
    if (traffic && game.settings.traffic) traffic.update(dt, car);
    effects.update(dt);
    audio.update(dt, car);
  }

  camRig.update(dt, car);
  sky.update(dt, car.pos);

  if (game.state === "play" || game.state === "pause") {
    hud.update(dt, { car, world, traffic: game.settings.traffic ? traffic : null, display: modeCtl?.display() });
  }

  // Tore sanft pulsieren
  if (gates.container?.visible) {
    const t = now * 0.004;
    const gate = gates[modeCtl?.state.nextCheckpoint ?? 0];
    if (gate) gate.mat.emissiveIntensity = 1.4 + Math.sin(t) * 0.5;
  }

  renderer.render(scene, camera);
}

/* --------------------------------------------------------------- Menues */

function buildCarCards() {
  const list = $("carList");
  list.innerHTML = "";
  VEHICLES.forEach((v) => {
    const btn = document.createElement("button");
    btn.className = "car" + (v.id === game.carId ? " active" : "");
    btn.dataset.car = v.id;
    const hex = "#" + v.color.toString(16).padStart(6, "0");
    btn.innerHTML = `
      <span class="swatch" style="background:${hex}"></span>
      <div class="cclass">${v.klass}</div>
      <div class="cname">${v.name}</div>
      <div class="bar"><span>Speed</span><i style="--v:${v.stats.speed}"></i></div>
      <div class="bar"><span>Beschl.</span><i style="--v:${v.stats.accel}"></i></div>
      <div class="bar"><span>Grip</span><i style="--v:${v.stats.grip}"></i></div>
      <div class="bar"><span>Drift</span><i style="--v:${v.stats.drift}"></i></div>
      <div class="bar"><span>V-max</span><i style="--v:${clamp(v.topSpeed / 90, 0, 1)}"></i></div>`;
    btn.addEventListener("click", () => {
      game.carId = v.id;
      audio.resume(); audio.click();
      buildCarCards();
    });
    list.appendChild(btn);
  });
}

function wireMenu() {
  $("modeChips").querySelectorAll("[data-mode]").forEach((chip) => {
    chip.addEventListener("click", () => {
      game.mode = chip.dataset.mode;
      $("modeChips").querySelectorAll("[data-mode]").forEach((c) => c.classList.toggle("active", c === chip));
      audio.resume(); audio.click();
    });
  });

  $("playBtn").addEventListener("click", () => {
    audio.resume(); audio.click();
    startRun(game.mode, game.carId);
  });

  $("optShadows").addEventListener("change", (e) => {
    game.settings.shadows = e.target.checked;
    applyQuality();
  });
  $("optTraffic").addEventListener("change", (e) => {
    game.settings.traffic = e.target.checked;
    traffic?.setVisible(e.target.checked && game.mode !== "drift");
  });
  $("optQuality").addEventListener("change", (e) => {
    game.settings.quality = Number(e.target.value);
    applyQuality();
  });

  $("resumeBtn").addEventListener("click", () => togglePause(false));
  $("restartBtn").addEventListener("click", () => { audio.click(); startRun(game.mode, game.carId); });
  $("garageBtn").addEventListener("click", () => openMenu());
  $("againBtn").addEventListener("click", () => { audio.click(); startRun(game.mode, game.carId); });
  $("resultMenuBtn").addEventListener("click", () => openMenu());
}

function openMenu() {
  game.state = "menu";
  input.setEnabled(false);
  hud.hide();
  $("pause").classList.add("hidden");
  $("result").classList.add("hidden");
  $("menu").classList.remove("hidden");
  buildCarCards();
  $("modeChips").querySelectorAll("[data-mode]").forEach((c) => c.classList.toggle("active", c.dataset.mode === game.mode));
}

function togglePause(force) {
  const want = force ?? (game.state === "play");
  if (want && game.state === "play") {
    game.state = "pause";
    input.setEnabled(false);
    const s = modeCtl?.state;
    $("pauseStats").innerHTML = `
      <div>Modus: <b>${modeCtl?.display().title ?? "—"}</b></div>
      <div>Fahrzeug: <b>${car.spec.name}</b></div>
      <div>Strecke: <b>${(car.odometer / 1000).toFixed(2)} km</b></div>
      <div>Punkte: <b>${formatNumber((s?.score ?? 0) + (s?.driftBank ?? 0))}</b></div>
      <div>Kamera: <b>${camRig.mode.label}</b> · Tageszeit: <b>${sky.label}</b></div>
      <div>FPS: <b>${fps.toFixed(0)}</b></div>`;
    $("pause").classList.remove("hidden");
  } else if (!want && game.state === "pause") {
    game.state = "play";
    input.setEnabled(true);
    $("pause").classList.add("hidden");
  }
}

function wireHotkeys() {
  input.on("camera", () => {
    if (game.state !== "play") return;
    const mode = camRig.next();
    hud.toast(`Kamera: ${mode.label}`, 1.2);
  });
  input.on("reset", () => {
    if (game.state !== "play") return;
    const snap = world.snapToRoad(car.pos.x, car.pos.z, car.yaw);
    car.reset({ ...snap, y: world.terrainHeightAt(snap.x, snap.z) });
    hud.toast("Zurück auf die Straße", 1.1);
  });
  input.on("daytime", () => {
    const p = sky.next();
    car.setNight(sky.isNight);
    world.setNight(sky.isNight);
    hud.toast(`Tageszeit: ${p.label}`, 1.2);
  });
  input.on("mute", () => {
    audio.resume();
    const m = audio.setMuted(!audio.muted);
    hud.toast(m ? "Ton aus" : "Ton an", 1.1);
  });
  input.on("fullscreen", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
  input.on("pause", () => {
    if (game.state === "play") togglePause(true);
    else if (game.state === "pause") togglePause(false);
    else if (game.state === "result") openMenu();
  });
  input.on("help", () => {
    if (game.state === "play") hud.toast("WASD · Space Handbremse · Shift Nitro · C Kamera · T Tageszeit · R Reset", 3.5);
  });
}

/* ----------------------------------------------------------------- Setup */

async function boot() {
  const setLoader = (text, pct) => {
    $("loaderText").textContent = text;
    $("loaderFill").style.width = `${pct}%`;
  };

  if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
    document.body.classList.add("touch");
    input.bindTouch($("touchControls"));
  }

  setLoader("Himmel und Licht…", 8);
  await nextFrame();
  sky = createSky(scene, renderer);
  sky.apply("day");

  setLoader("Gelände und Strassen…", 24);
  await nextFrame();
  world = createWorld(scene, { seed: 20260917 });
  window.__game.world = world;

  setLoader("Stadt, Stuntpark, Driftkreis…", 56);
  await nextFrame();
  effects = createEffects(scene, world);
  camRig = createCameraRig(camera, world);
  gates = buildGates(world.routes.timetrial);

  setLoader("Verkehr…", 74);
  await nextFrame();
  traffic = createTraffic(scene, world, { count: 14 });

  setLoader("Fahrzeug…", 88);
  await nextFrame();
  car = createVehicle(scene, world, game.carId);
  car.reset(world.spawns.freeroam);
  window.__game.car = car;
  window.__game.renderer = renderer;
  window.__game.startRun = startRun;
  window.__game.stepPhysics = stepPhysics;
  window.__game.input = input;

  applyQuality();
  wireMenu();
  wireHotkeys();
  buildCarCards();

  setLoader("Bereit!", 100);
  await nextFrame();
  // einmal rendern, damit die Szene beim Menue schon warm ist
  camRig.update(0.016, car);
  sky.update(0.016, car.pos);
  renderer.render(scene, camera);

  $("loading").classList.add("hidden");
  openMenu();
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  camera.updateProjectionMatrix();
  applyQuality();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.state === "play") togglePause(true);
});

window.addEventListener("error", (e) => {
  const box = $("fatal");
  if (!box) return;
  $("fatalMsg").textContent = `${e.message}\n${e.filename ?? ""}:${e.lineno ?? ""}`;
  box.classList.remove("hidden");
});

boot().catch((err) => {
  console.error(err);
  $("loading").classList.add("hidden");
  $("fatal").classList.remove("hidden");
  $("fatalMsg").textContent = String(err && err.stack ? err.stack : err);
});
