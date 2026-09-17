/**
 * Headless-Smoketest: startet einen statischen Server, laedt das Spiel in
 * Chromium (Playwright), faehrt automatisch los und prueft Physik + Fehlerfreiheit.
 *
 *   node tools/smoke-test.mjs [--headed] [--shots]
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "screenshots");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function loadPlaywright() {
  const candidates = [
    "playwright",
    "/opt/node22/lib/node_modules/playwright/index.js",
    "/usr/lib/node_modules/playwright/index.js",
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* weiter */ }
  }
  throw new Error("Playwright nicht gefunden - bitte 'npm i -D playwright' oder global installieren.");
}

function serve(port) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end("nope"); return; }
      const data = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` -- ${detail}` : ""}`);
}

async function main() {
  const headed = process.argv.includes("--headed");
  const wantShots = process.argv.includes("--shots") || true;
  const { chromium } = loadPlaywright();
  const port = 8123 + Math.floor(Math.random() * 400);
  const server = await serve(port);
  await fs.mkdir(SHOTS, { recursive: true });

  const browser = await chromium.launch({
    headless: !headed,
    args: [
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--disable-gpu-sandbox", "--no-sandbox",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });

  // 1) Welt fertig gebaut?
  await page.waitForFunction("window.__game && window.__game.world && window.__game.car", null, { timeout: 90000 });
  const worldInfo = await page.evaluate(() => ({
    collider: window.__game.world.colliderCount,
    roads: window.__game.world.roads.length,
    gates: window.__game.world.routes.timetrial.length,
    heightCity: window.__game.world.heightAt(0, 100),
    heightHill: window.__game.world.heightAt(700, 700),
  }));
  check("Welt gebaut", worldInfo.collider > 100 && worldInfo.roads > 10, JSON.stringify(worldInfo));
  check("Strassen sind flach", Math.abs(worldInfo.heightCity) < 1.5, `y=${worldInfo.heightCity.toFixed(2)}`);
  check("Hinterland hat Relief", worldInfo.heightHill > 5, `y=${worldInfo.heightHill.toFixed(1)}`);
  check("Ladebildschirm verschwunden", await page.locator("#loading").isHidden());
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, "01-menu.png") });

  // 2) Spiel starten
  await page.click("#playBtn");
  await page.waitForFunction("window.__game.state === 'play'", null, { timeout: 10000 });
  check("Freies Fahren gestartet", true);

  // 3) Tastatureingabe erreicht die Physik
  await page.keyboard.down("w");
  await page.waitForTimeout(600);
  const plumbing = await page.evaluate(() => ({
    throttle: window.__game.input.read().throttle,
    smooth: window.__game.car.throttleSmooth,
    moving: window.__game.car.speed,
  }));
  await page.keyboard.up("w");
  check("Tastatur steuert das Auto", plumbing.throttle === 1 && plumbing.smooth > 0.2 && plumbing.moving > 0.5,
    `throttle=${plumbing.throttle} v=${plumbing.moving.toFixed(2)}`);
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, "02-drive.png") });

  // 4) Physik deterministisch durchrechnen (unabhaengig von der Bildrate,
  //    weil Software-WebGL im Container nur wenige fps schafft)
  const physics = await page.evaluate(() => {
    const g = window.__game, w = g.world, car = g.car;
    const h = 1 / 120;
    const run = (spawn, inputAt, seconds) => {
      car.reset(spawn);
      const log = { t100: null, maxSpeed: 0, maxAir: 0, maxSlip: 0, maxY: -99, dist: 0, nan: false, cones: 0 };
      const sx = spawn.x, sz = spawn.z;
      const steps = Math.round(seconds / h);
      for (let i = 0; i < steps; i++) {
        car.update(h, inputAt(i * h, car));
        if (!isFinite(car.pos.x) || !isFinite(car.pos.y) || !isFinite(car.speed)) { log.nan = true; break; }
        log.maxSpeed = Math.max(log.maxSpeed, car.speed);
        log.maxAir = Math.max(log.maxAir, car.airTime);
        log.maxSlip = Math.max(log.maxSlip, car.slipAngle);
        log.maxY = Math.max(log.maxY, car.pos.y);
        log.cones += car.events.cones;
        if (log.t100 === null && car.speed * 3.6 >= 100) log.t100 = i * h;
      }
      log.dist = Math.hypot(car.pos.x - sx, car.pos.z - sz);
      log.endSpeed = car.speed;
      log.gear = car.gear;
      return log;
    };
    const full = () => ({ throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false });
    const out = {};
    out.accel = run({ ...w.spawns.freeroam }, full, 20);
    out.brake = (() => {
      car.reset({ ...w.spawns.freeroam });
      for (let i = 0; i < 120 * 8; i++) car.update(h, full());
      const v0 = car.speed;
      let t = 0;
      while (car.speed > 0.5 && t < 12) { car.update(h, { throttle: 0, brake: 1, steer: 0, handbrake: false, nitro: false }); t += h; }
      return { v0, stopTime: t };
    })();
    out.drift = run({ ...w.spawns.drift }, (t) => ({
      throttle: 1, brake: 0, steer: t > 1.5 ? 1 : 0, handbrake: t > 1.5 && t < 2.8, nitro: false,
    }), 9);
    out.jump = run({ x: w.park.x - 78, z: w.park.z + 110, yaw: Math.PI }, full, 12);
    out.grass = run({ x: 420, z: 170, yaw: 0 }, full, 12);
    out.wall = (() => {                        // frontal gegen ein echtes Gebaeude
      const target = w.colliders.find((c) => c.kind === "box" && c.top < 1000 && c.hx > 10);
      if (!target) return { impact: 0, skipped: true };
      const startX = target.x - 60, startZ = target.z;
      car.reset({ x: startX, z: startZ, yaw: Math.PI / 2 });   // Blick auf +x
      let impact = 0, minDist = 1e9;
      for (let i = 0; i < 120 * 6; i++) {
        car.update(h, full());
        impact = Math.max(impact, car.events.impact);
        minDist = Math.min(minDist, Math.hypot(car.pos.x - target.x, car.pos.z - target.z));
      }
      const insideBox = Math.abs(car.pos.x - target.x) < target.hx - 0.5 && Math.abs(car.pos.z - target.z) < target.hz - 0.5;
      return { impact, insideBox, minDist, speed: car.speed };
    })();
    out.topSpec = car.spec.topSpeed;
    return out;
  });

  const kmh = (v) => (v * 3.6).toFixed(0);
  check("Keine NaN in der Physik", !Object.values(physics).some((v) => v && v.nan));
  check("0-100 km/h in sinnvoller Zeit", physics.accel.t100 > 2 && physics.accel.t100 < 12,
    `${physics.accel.t100?.toFixed(2)} s`);
  check("Endgeschwindigkeit passt zur Fahrzeugklasse",
    physics.accel.maxSpeed > physics.topSpec * 0.9 && physics.accel.maxSpeed <= physics.topSpec * 1.02,
    `${kmh(physics.accel.maxSpeed)} km/h (Soll ${kmh(physics.topSpec)})`);
  check("Getriebe schaltet hoch", physics.accel.gear >= 4, `Gang ${physics.accel.gear}`);
  check("Bremsen verzoegern kraeftig", physics.brake.stopTime > 1 && physics.brake.stopTime < 5,
    `von ${kmh(physics.brake.v0)} km/h in ${physics.brake.stopTime.toFixed(2)} s`);
  check("Handbremse erzeugt echten Drift", physics.drift.maxSlip > 0.2,
    `${(physics.drift.maxSlip * 57.3).toFixed(1)} Grad Schraeglauf`);
  check("Rampe hebt das Auto ab", physics.jump.maxAir > 0.4 && physics.jump.maxY > 4,
    `${physics.jump.maxAir.toFixed(2)} s Airtime, Scheitel ${physics.jump.maxY.toFixed(1)} m`);
  check("Wiese bremst deutlich", physics.grass.maxSpeed < physics.accel.maxSpeed * 0.75,
    `${kmh(physics.grass.maxSpeed)} km/h statt ${kmh(physics.accel.maxSpeed)} km/h`);
  check("Kollision stoppt statt durchzufallen", physics.wall.impact > 1 && !physics.wall.insideBox,
    `Aufprall ${physics.wall.impact.toFixed(1)} m/s, im Gebaeude: ${physics.wall.insideBox}`);
  check("Huetchen reagieren", physics.drift.cones > 0 || physics.jump.cones > 0,
    `${physics.drift.cones + physics.jump.cones} Treffer`);

  // 5) Kamera, Tageszeit, Reset
  await page.keyboard.press("c");
  await page.keyboard.press("t");
  await page.waitForTimeout(300);
  const night = await page.evaluate(() => ({
    hud: !document.getElementById("hud").classList.contains("hidden"),
    kmhText: document.getElementById("kmh").textContent,
  }));
  check("HUD sichtbar und aktualisiert", night.hud && night.kmhText !== "", `Tacho: ${night.kmhText}`);
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, "03-night.png") });
  await page.keyboard.press("t");
  await page.keyboard.press("t");
  await page.keyboard.press("r");
  await page.waitForTimeout(250);
  check("Reset stellt das Auto ab", await page.evaluate(() => window.__game.car.speed < 3));

  // 6) Zeitfahren: Tore werden gezaehlt
  await page.evaluate(() => window.__game.startRun("timetrial", "apex"));
  await page.waitForTimeout(200);
  const cp = await page.evaluate(() => {
    const g = window.__game;
    const before = g.modeCtl.state.nextCheckpoint;
    const gate = g.world.routes.timetrial[before];
    g.car.reset({ x: gate.x - Math.sin(gate.yaw) * 30, z: gate.z - Math.cos(gate.yaw) * 30, yaw: gate.yaw });
    const h = 1 / 120;
    for (let i = 0; i < 120 * 4; i++) {
      g.car.update(h, { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false });
      g.modeCtl.update(h, { landed: 0, cones: 0 });
    }
    return { before, after: g.modeCtl.state.nextCheckpoint, elapsed: g.modeCtl.state.elapsed };
  });
  check("Checkpoint wird erkannt", cp.after > cp.before, `${cp.before} -> ${cp.after}`);
  check("Zeitfahren-Uhr laeuft", cp.elapsed > 0, `${cp.elapsed.toFixed(2)} s`);
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, "04-timetrial.png") });

  // 7) Drift-Modus zaehlt Punkte
  const driftScore = await page.evaluate(() => {
    const g = window.__game;
    g.startRun("drift", "muscle");
    const h = 1 / 120;
    for (let i = 0; i < 120 * 10; i++) {
      const t = i * h;
      g.car.update(h, { throttle: 1, brake: 0, steer: t > 1.6 ? 1 : 0, handbrake: t > 1.6 && t < 3.2, nitro: false });
      g.modeCtl.update(h, { landed: g.car.events.landed, cones: g.car.events.cones });
    }
    const s = g.modeCtl.state;
    return { score: s.score + s.driftBank, mult: s.driftMult };
  });
  check("Drift-Punkte werden gezaehlt", driftScore.score > 100, `${driftScore.score.toFixed(0)} Punkte, x${driftScore.mult.toFixed(1)}`);
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, "05-drift-mode.png") });

  // 8) Stuntpark-Blick fuer den Screenshot
  await page.evaluate(() => {
    const g = window.__game;
    g.startRun("freeroam", "trail");
    g.car.reset({ x: g.world.park.x - 78, z: g.world.park.z + 96, yaw: Math.PI });
  });
  await page.keyboard.down("w");
  await page.waitForTimeout(2500);
  await page.keyboard.up("w");
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, "06-stuntpark.png") });

  // 9) Parcours-Modus (2D-Physik in Seitenansicht)
  await page.evaluate(() => window.__game.startRun("parcours"));
  await page.waitForFunction("window.__game.state === 'parcours' && window.__game.parcours", null, { timeout: 15000 });
  check("Parcours startet", true);
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, "07-parcours.png") });

  const pc = await page.evaluate(() => {
    const p = window.__game.parcours;
    const h = 1 / 60;
    const out = {};
    // Level 1 mit reinem Vollgas: muss durchfahrbar sein
    p.setLevel(0);
    const startX = p.truck.body.x;
    let maxAir = 0, maxY = -99, nan = false;
    for (let i = 0; i < 60 * 30; i++) {
      p.update(h, { gas: 1, reverse: 0 });
      const b = p.truck.body;
      if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.angle)) { nan = true; break; }
      maxAir = Math.max(maxAir, p.truck.airTime);
      maxY = Math.max(maxY, b.y);
      if (p.status().phase !== "driving") break;
    }
    out.level1 = {
      phase: p.status().phase, x: p.truck.body.x, startX, maxAir, maxY, nan,
      time: p.status().time, attempts: p.status().attempts,
    };

    // Ueberschlag muss als Absturz erkannt werden
    p.setLevel(0);
    p.truck.body.angle = Math.PI;          // auf dem Dach
    p.truck.body.y += 0.4;
    out.crash = "driving";
    for (let i = 0; i < 60 * 1.2; i++) {     // vor dem automatischen Neustart pruefen
      p.update(h, { gas: 0, reverse: 0 });
      if (p.status().phase === "crashed") { out.crash = "crashed"; break; }
    }

    // Wippe: Fahrzeug erreicht die Wippe und sie kippt.
    // Die Wippe wird bei jedem Levelaufbau neu erzeugt, deshalb jedes Mal
    // frisch aus der Physikwelt holen statt eine Referenz zu halten.
    p.setLevel(2);
    const seesawAngle = () => p.physics.bodies.find((b) => b.tag === "seesaw")?.angle ?? 0;
    const a0 = seesawAngle();
    let moved = 0;
    for (let i = 0; i < 60 * 14; i++) {
      p.update(h, { gas: 1, reverse: 0 });
      moved = Math.max(moved, Math.abs(seesawAngle() - a0));
      if (p.status().phase !== "driving") break;
    }
    out.seesaw = { moved, x: p.truck.body.x, phase: p.status().phase };

    // Rueckwaerts-Level: mit Rueckwaertsgang kommt das Auto nach links
    p.setLevel(8);
    const rx0 = p.truck.body.x;
    for (let i = 0; i < 60 * 8; i++) p.update(h, { gas: 0, reverse: 0.75 });
    out.reverse = { dx: p.truck.body.x - rx0, phase: p.status().phase };

    // Kisten lassen sich wegschieben
    p.setLevel(4);
    const crate = p.physics.bodies.find((b) => b.tag === "crate");
    const cx0 = crate.x;
    for (let i = 0; i < 60 * 12; i++) {
      p.update(h, { gas: 1, reverse: 0 });
      if (p.status().phase !== "driving") break;
    }
    out.crate = { dx: Math.abs(crate.x - cx0) };

    out.levels = p.levels.length;
    return out;
  });

  check("Parcours: Level 1 mit Vollgas schaffbar", pc.level1.phase === "won",
    `Phase ${pc.level1.phase}, x=${pc.level1.x.toFixed(1)}, Zeit ${pc.level1.time.toFixed(1)} s`);
  check("Parcours: Sprung über die Lücke", pc.level1.maxAir > 0.25, `${pc.level1.maxAir.toFixed(2)} s in der Luft`);
  check("Parcours: keine NaN", !pc.level1.nan);
  check("Parcours: Überschlag wird erkannt", pc.crash === "crashed", `Phase ${pc.crash}`);
  check("Parcours: Wippe reagiert", pc.seesaw.moved > 0.05, `${(pc.seesaw.moved * 57.3).toFixed(1)} Grad gekippt`);
  check("Parcours: Rückwärtsgang fährt nach links", pc.reverse.dx < -3, `${pc.reverse.dx.toFixed(1)} m`);
  check("Parcours: Kisten sind schiebbar", pc.crate.dx > 0.5, `${pc.crate.dx.toFixed(2)} m verschoben`);
  check("Parcours: 10 Level vorhanden", pc.levels === 10, `${pc.levels}`);
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, "08-parcours-level.png") });

  // 10) Performance grob
  const perf = await page.evaluate(async () => {
    const t0 = performance.now();
    let frames = 0;
    await new Promise((res) => {
      const tick = () => { frames++; if (performance.now() - t0 > 1500) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const info = window.__game.renderer.info;
    return { fps: frames / ((performance.now() - t0) / 1000), calls: info.render.calls, tris: info.render.triangles };
  });
  check("Renderloop laeuft", perf.fps > 4, `${perf.fps.toFixed(1)} fps (Software-GL), ${perf.calls} draw calls, ${(perf.tris / 1000).toFixed(0)}k Dreiecke`);

  check("Keine JS-Fehler", errors.length === 0, errors.slice(0, 4).join(" | "));

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} Checks ok`);
  if (wantShots) console.log(`Screenshots: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
