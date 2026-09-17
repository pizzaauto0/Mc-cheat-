/**
 * Winziger statischer Server -- nur Node, kein npm, keine Abhaengigkeiten.
 * Gedacht fuer den Fall, dass npm/npx nicht funktioniert.
 *
 *   node tools/serve.mjs            # http://localhost:8080
 *   node tools/serve.mjs 3000       # anderer Port
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2]) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mov": "video/quicktime",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const rel = url === "/" || url.endsWith("/") ? path.join(url, "index.html") : url;
    const file = path.resolve(ROOT, "." + path.posix.normalize(rel));
    if (!file.startsWith(ROOT)) {                 // kein Ausbrechen aus dem Projekt
      res.writeHead(403).end("Verboten");
      return;
    }
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch (err) {
    res.writeHead(err.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err.code === "ENOENT" ? "Nicht gefunden: " + req.url : String(err));
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} ist belegt. Versuch es mit: node tools/serve.mjs ${PORT + 1}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  if (!fs.existsSync(path.join(ROOT, "index.html"))) {
    console.error(`Warnung: in ${ROOT} liegt keine index.html -- laeuft das Skript im richtigen Projekt?`);
  }
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) addrs.push(net.address);
    }
  }
  console.log(`\n  Asphalt Drift laeuft:\n`);
  console.log(`    http://localhost:${PORT}`);
  for (const a of addrs) console.log(`    http://${a}:${PORT}   (Handy im gleichen WLAN)`);
  console.log(`\n  Beenden mit Strg+C\n`);
});
