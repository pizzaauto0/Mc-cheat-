// Alle Texturen werden zur Laufzeit auf Canvas gemalt -- keine externen Assets.
import * as THREE from "three";
import { rng, clamp } from "./util.js";

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { c, g: c.getContext("2d") };
}

function noiseOverlay(g, w, h, amount, seed = 1, scale = 1) {
  const rand = rng(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y += scale) {
    for (let x = 0; x < w; x += scale) {
      const n = (rand() - 0.5) * amount;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const i = ((y + sy) * w + (x + sx)) * 4;
          if (i >= d.length) continue;
          d[i] = clamp(d[i] + n, 0, 255);
          d[i + 1] = clamp(d[i + 1] + n, 0, 255);
          d[i + 2] = clamp(d[i + 2] + n, 0, 255);
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
}

/** Asphalt mit Mittelstreifen. lanes = Anzahl Fahrspuren. */
export function asphaltTexture(lanes = 2, { repeat = [1, 1], shoulder = true } = {}) {
  const W = 256, H = 256;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#2b2f36";
  g.fillRect(0, 0, W, H);
  noiseOverlay(g, W, H, 26, 5, 2);

  // Randmarkierung
  if (shoulder) {
    g.fillStyle = "rgba(226,232,240,.62)";
    g.fillRect(6, 0, 4, H);
    g.fillRect(W - 10, 0, 4, H);
  }
  // Fahrspur-Trenner (gestrichelt), mittig bzw. je Spur
  g.fillStyle = "rgba(240,244,250,.72)";
  for (let l = 1; l < lanes; l++) {
    const x = (W / lanes) * l - 2;
    for (let y = 0; y < H; y += 48) g.fillRect(x, y, 4, 26);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function dirtTexture() {
  const W = 128, H = 128;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#6b5334";
  g.fillRect(0, 0, W, H);
  noiseOverlay(g, W, H, 34, 11, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function concreteTexture(repeat = 8) {
  const W = 128, H = 128;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#7d848e";
  g.fillRect(0, 0, W, H);
  noiseOverlay(g, W, H, 16, 23, 2);
  g.strokeStyle = "rgba(52,58,68,.22)";
  g.lineWidth = 2;
  g.strokeRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Hausfassade: Fensterraster. Gibt Map + Emissive-Map zurueck, damit nachts
 * einzelne Fenster leuchten.
 */
export function facadeTexture(seed, cols = 6, rows = 10) {
  const cw = 32, ch = 28;
  const W = cols * cw, H = rows * ch;
  const base = canvas(W, H);
  const emis = canvas(W, H);
  const rand = rng(seed);
  const wallShades = ["#767f8d", "#68707e", "#828b99", "#6f7787", "#8b93a1"];
  const wall = wallShades[Math.floor(rand() * wallShades.length)];
  base.g.fillStyle = wall;
  base.g.fillRect(0, 0, W, H);
  noiseOverlay(base.g, W, H, 14, seed, 2);
  emis.g.fillStyle = "#000";
  emis.g.fillRect(0, 0, W, H);

  for (let r = 0; r < rows; r++) {
    for (let c2 = 0; c2 < cols; c2++) {
      const x = c2 * cw + 7, y = r * ch + 6;
      const w = cw - 14, h = ch - 13;
      const lit = rand() < 0.42;
      base.g.fillStyle = "#26303e";      // tagsueber immer dunkles Glas
      base.g.fillRect(x, y, w, h);
      base.g.fillStyle = "rgba(255,255,255,.08)";
      base.g.fillRect(x, y, w, 2);
      if (lit) {
        const warm = rand() < 0.75;
        emis.g.fillStyle = warm ? "#ffcf8a" : "#9fd8ff";
        emis.g.fillRect(x, y, w, h);
      }
    }
  }
  // Sockel
  base.g.fillStyle = "rgba(20,26,36,.85)";
  base.g.fillRect(0, H - 10, W, 10);

  const map = new THREE.CanvasTexture(base.c);
  const emissive = new THREE.CanvasTexture(emis.c);
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return { map, emissive };
}

/** Weicher runder Fleck -- fuer Staub, Funken, Wolken, Lichtkegel. */
export function blobTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)", size = 64) {
  const { c, g } = canvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function cloudTexture() {
  const S = 256;
  const { c, g } = canvas(S, S);
  const rand = rng(99);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const x = S * 0.5 + (rand() - 0.5) * S * 0.62;
    const y = S * 0.5 + (rand() - 0.5) * S * 0.34;
    const r = S * (0.08 + rand() * 0.16);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(255,255,255,.75)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Vertikaler Himmelsverlauf als Equirect-Hintergrund. */
export function skyTexture(top, horizon, bottom) {
  const W = 16, H = 256;
  const { c, g } = canvas(W, H);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, top);
  grd.addColorStop(0.46, horizon);
  grd.addColorStop(0.54, horizon);
  grd.addColorStop(1, bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Schachbrett -- fuer die Ziellinie im Parcours. */
export function checkerTexture(cells = 4, a = "#ffffff", b = "#1b1f27") {
  const S = 128;
  const { c, g } = canvas(S, S);
  const step = S / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? a : b;
      g.fillRect(x * step, y * step, step, step);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}
