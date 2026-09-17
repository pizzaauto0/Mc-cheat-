/**
 * Prueft die Parcours-Level im echten Browser: laesst einen simplen Autopiloten
 * fahren und meldet pro Level, wie weit er kommt. Dient dem Balancing.
 *
 *   node tools/check-parcours.mjs [levelIndex]
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function loadPlaywright() {
  for (const c of ["playwright", "/opt/node22/lib/node_modules/playwright/index.js"]) {
    try { return require(c); } catch { /* weiter */ }
  }
  throw new Error("Playwright fehlt");
}

const server = http.createServer(async (req, res) => {
  try {
    const rel = (req.url === "/" ? "index.html" : req.url.slice(1)).split("?")[0];
    const data = await fs.readFile(path.join(ROOT, decodeURIComponent(rel)));
    res.writeHead(200, { "Content-Type": MIME[path.extname(rel)] ?? "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404).end("not found"); }
});
const port = 8300 + Math.floor(Math.random() * 300);
await new Promise((r) => server.listen(port, r));

const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction("window.__game && window.__game.car", null, { timeout: 90000 });
await page.evaluate(() => window.__game.startRun("parcours"));
await page.waitForFunction("window.__game.parcours", null, { timeout: 15000 });

const only = process.argv[2] ? Number(process.argv[2]) : null;
const rows = await page.evaluate((only) => {
  const p = window.__game.parcours;
  const h = 1 / 60;
  const out = [];
  const list = only === null ? p.levels.map((_, i) => i) : [only];

  // Vier Fahrstile -- schafft einer das Level, ist es fuer Menschen machbar.
  const styles = {
    "Vollgas": () => 1,
    "70 %": () => 0.7,
    "zaghaft": () => 0.42,
    "Stop-and-go": (t) => (t % 2.4 < 1.5 ? 1 : 0),
    // wie ein aufmerksamer Spieler: am Scheitel vom Gas
    "Scheitel-Lupfer": (t, car) => (car.grounded && car.body.angle > 0.1 ? 0 : 1),
  };

  for (const i of list) {
    const level = p.levels[i];
    const dir = level.finish.x >= level.start.x ? 1 : -1;
    const total = Math.abs(level.finish.x - level.start.x);
    let bestRun = null;

    for (const [styleName, pedal] of Object.entries(styles)) {
      p.setLevel(i);
      let best = 0, maxAir = 0, maxPitch = 0, time = 0, phase = "driving";
      for (let step = 0; step < 60 * 45; step++) {
        const b = p.truck.body;
        let amount = pedal(time, { grounded: p.truck.grounded, body: b });
        let gas = dir > 0 ? amount : 0;
        let rev = dir > 0 ? 0 : amount;
        if (!p.truck.grounded) {                 // in der Luft Lage korrigieren
          if (b.angle > 0.28 || b.omega > 1.2) { gas = 0; rev = 0.8; }
          else if (b.angle < -0.28 || b.omega < -1.2) { gas = 0.8; rev = 0; }
        }
        p.update(h, { gas, reverse: rev });
        time += h;
        best = Math.max(best, Math.abs(p.truck.body.x - level.start.x));
        maxAir = Math.max(maxAir, p.truck.airTime);
        maxPitch = Math.max(maxPitch, Math.abs(p.truck.body.angle));
        phase = p.status().phase;
        if (phase !== "driving") break;
      }
      const run = {
        style: styleName, phase,
        reached: +((best / total) * 100).toFixed(0),
        maxAir: +maxAir.toFixed(2), maxPitch: +(maxPitch * 57.3).toFixed(0),
        time: +time.toFixed(1), msg: p.status().message,
      };
      if (!bestRun || (run.phase === "won" && bestRun.phase !== "won") ||
          (run.phase === bestRun.phase && run.reached > bestRun.reached)) bestRun = run;
      if (run.phase === "won") break;
    }
    out.push({ i: i + 1, name: level.name, ...bestRun });
  }
  return out;
}, only);

for (const r of rows) {
  const tag = r.phase === "won" ? "OK  " : r.phase === "crashed" ? "CRASH" : "STUCK";
  console.log(`${tag} L${String(r.i).padStart(2)} ${r.name.padEnd(14)} ${String(r.reached).padStart(3)} % · ${r.time}s · ${r.style.padEnd(11)} · Luft ${r.maxAir}s · Neigung ${r.maxPitch}° ${r.msg ? "· " + r.msg : ""}`);
}
const won = rows.filter((r) => r.phase === "won").length;
console.log(`\nMit einem der vier Fahrstile schaffbar: ${won}/${rows.length} Level.`);
await browser.close();
server.close();
