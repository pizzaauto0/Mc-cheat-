// Weltgenerierung: Heightfield-Terrain, Strassennetz, Stadt, Stuntpark, Kollider.
// Die Physik fragt ueber sampleSurface()/resolveCircle() genau die Geometrie ab,
// die auch gerendert wird -- deshalb ist alles analytisch bzw. als Gitter hinterlegt.
import * as THREE from "three";
import {
  clamp, lerp, smoothstep, makeNoise2D, fbm, rng, resamplePath,
  distToSegment2, TAU,
} from "./util.js";
import { asphaltTexture, concreteTexture, dirtTexture, facadeTexture } from "./textures.js";

export const WORLD_HALF = 800;
const GRID = 257;                                  // Aufloesung des Heightfields
const CELL = (WORLD_HALF * 2) / (GRID - 1);        // 6.25 m pro Zelle

export const SURF = { GRASS: 0, ROAD: 1, DIRT: 2, CONCRETE: 3 };
const GRIP_BY_SURF = [0.60, 1.0, 0.74, 0.94];

const STREETS = [-300, -150, 0, 150, 300];
const CITY_EXTENT = 340;
const PARK = { x: 470, z: -430, hx: 140, hz: 120 };
const SKIDPAD = { x: -470, z: 420, r: 98 };

/* ------------------------------------------------------------------ Layout */

function buildRoadLayout() {
  const roads = [];
  // Innenstadt-Raster
  for (const x of STREETS) {
    roads.push({ kind: "street", width: 17, lanes: 2, closed: false,
      points: [{ x, z: -CITY_EXTENT }, { x, z: CITY_EXTENT }] });
  }
  for (const z of STREETS) {
    roads.push({ kind: "street", width: 17, lanes: 2, closed: false,
      points: [{ x: -CITY_EXTENT, z }, { x: CITY_EXTENT, z }] });
  }

  // Ringautobahn (Superellipse mit leichter Welle)
  const ringPts = [];
  const a = 620, b = 560, n = 3.2;
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * TAU;
    const ct = Math.cos(t), st = Math.sin(t);
    const wob = 1 + Math.sin(t * 3) * 0.045 + Math.cos(t * 5 + 1.2) * 0.025;
    ringPts.push({
      x: Math.sign(ct) * a * Math.pow(Math.abs(ct), 2 / n) * wob,
      z: Math.sign(st) * b * Math.pow(Math.abs(st), 2 / n) * wob,
    });
  }
  roads.push({ kind: "highway", width: 27, lanes: 4, closed: true,
    points: resamplePath(ringPts, 3, true) });

  // Vier kurvige Zubringer Innenstadt <-> Ring
  const connectors = [
    [{ x: 0, z: -CITY_EXTENT }, { x: 42, z: -400 }, { x: -34, z: -462 }, { x: 16, z: -520 }, { x: 0, z: -566 }],
    [{ x: 0, z: CITY_EXTENT }, { x: -38, z: 398 }, { x: 30, z: 458 }, { x: -14, z: 516 }, { x: 0, z: 566 }],
    [{ x: CITY_EXTENT, z: 0 }, { x: 402, z: 44 }, { x: 466, z: -36 }, { x: 540, z: 20 }, { x: 626, z: 0 }],
    [{ x: -CITY_EXTENT, z: 0 }, { x: -404, z: -42 }, { x: -470, z: 36 }, { x: -542, z: -18 }, { x: -626, z: 0 }],
  ];
  for (const pts of connectors) {
    roads.push({ kind: "street", width: 19, lanes: 2, closed: false,
      points: resamplePath(pts, 8, false) });
  }

  // Zufahrt Stuntpark (vom Ring) und Schotterweg zum Drift-Kreis
  roads.push({ kind: "street", width: 18, lanes: 2, closed: false,
    points: resamplePath([{ x: 470, z: -540 }, { x: 452, z: -500 }, { x: 470, z: -455 }], 6, false) });
  roads.push({ kind: "dirt", width: 14, lanes: 1, closed: false,
    points: resamplePath([{ x: -300, z: 320 }, { x: -356, z: 356 }, { x: -412, z: 392 }, { x: SKIDPAD.x, z: SKIDPAD.z }], 8, false) });
  // Bergstrasse quer durchs Hinterland
  roads.push({ kind: "dirt", width: 13, lanes: 1, closed: false,
    points: resamplePath([{ x: 340, z: 330 }, { x: 430, z: 430 }, { x: 330, z: 520 }, { x: 430, z: 610 }], 9, false) });

  return roads;
}

function buildPads() {
  // Flaechen: flach + Betonoberflaeche
  return [
    { type: "rect", x: 0, z: 0, hx: CITY_EXTENT + 18, hz: CITY_EXTENT + 18, surf: SURF.CONCRETE, margin: 34, flatOnly: false },
    { type: "rect", x: PARK.x, z: PARK.z, hx: PARK.hx, hz: PARK.hz, surf: SURF.CONCRETE, margin: 30 },
    { type: "circle", x: SKIDPAD.x, z: SKIDPAD.z, r: SKIDPAD.r, surf: SURF.CONCRETE, margin: 26 },
  ];
}

/** Rampen/Podeste im Stuntpark -- analytische Oberflaechen. */
function buildRamps() {
  const P = (dx, dz) => ({ x: PARK.x + dx, z: PARK.z + dz });
  const ramps = [];
  // Grosse Schanze (parabolisch) Richtung -z
  ramps.push({ type: "kicker", ...P(-78, 62), yaw: Math.PI, len: 26, wid: 17, height: 8.5 });
  // Doppelte Sprungschanze gegenueber
  ramps.push({ type: "kicker", ...P(66, -66), yaw: 0, len: 24, wid: 16, height: 7 });
  // Tabletop (rauf - Plateau - runter)
  ramps.push({ type: "tabletop", ...P(-10, -10), yaw: Math.PI / 2, lenIn: 20, lenFlat: 30, lenOut: 20, wid: 20, height: 4.6 });
  // Langer, flacher Anlieger als Startrampe
  ramps.push({ type: "wedge", ...P(96, 78), yaw: -Math.PI / 2, len: 34, wid: 18, height: 5 });
  // Podest mit Auffahrt
  ramps.push({ type: "tabletop", ...P(-96, -62), yaw: 0, lenIn: 16, lenFlat: 22, lenOut: 0, wid: 22, height: 3.4 });
  return ramps;
}

/* ------------------------------------------------- Rampen-Hoehenfunktionen */

function rampLocal(r, x, z) {
  const dx = x - r.x, dz = z - r.z;
  const s = Math.sin(r.yaw), c = Math.cos(r.yaw);
  return { lx: dx * s + dz * c, lz: dx * c - dz * s }; // lx = Fahrtrichtung, lz = seitlich
}

/** Hoehe (ueber Grund) + Blendfaktor an den Seitenkanten. */
function rampHeight(r, x, z) {
  const { lx, lz } = rampLocal(r, x, z);
  const halfW = r.wid / 2;
  const alz = Math.abs(lz);
  if (alz > halfW) return null;
  const fade = smoothstep(halfW, halfW - 1.6, alz);
  let h = null;
  if (r.type === "wedge") {
    if (lx < 0 || lx > r.len) return null;
    h = (lx / r.len) * r.height;
  } else if (r.type === "kicker") {
    if (lx < 0 || lx > r.len) return null;
    const t = lx / r.len;
    h = t * t * r.height;
  } else if (r.type === "tabletop") {
    const total = r.lenIn + r.lenFlat + r.lenOut;
    if (lx < 0 || lx > total) return null;
    if (lx < r.lenIn) h = (lx / r.lenIn) * r.height;
    else if (lx < r.lenIn + r.lenFlat) h = r.height;
    else h = r.lenOut > 0 ? (1 - (lx - r.lenIn - r.lenFlat) / r.lenOut) * r.height : r.height;
  }
  return h === null ? null : { h, fade };
}

/* ------------------------------------------------------------- Kollisionen */

class ColliderGrid {
  constructor(cell = 40) {
    this.cell = cell;
    this.map = new Map();
    this.all = [];
  }
  key(cx, cz) { return cx * 4093 + cz; }
  add(col) {
    this.all.push(col);
    const reach = (col.kind === "cyl" ? col.r : Math.hypot(col.hx, col.hz)) + 2;
    const x0 = Math.floor((col.x - reach) / this.cell), x1 = Math.floor((col.x + reach) / this.cell);
    const z0 = Math.floor((col.z - reach) / this.cell), z1 = Math.floor((col.z + reach) / this.cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let list = this.map.get(k);
        if (!list) this.map.set(k, (list = []));
        list.push(col);
      }
    }
  }
  query(x, z, out) {
    out.length = 0;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.map.get(this.key(cx + i, cz + j));
        if (!list) continue;
        for (const c of list) if (!out.includes(c)) out.push(c);
      }
    }
    return out;
  }
}

/* --------------------------------------------------------------- Weltbau */

export function createWorld(scene, opts = {}) {
  const seed = opts.seed ?? 20260917;
  const rand = rng(seed);
  const noise = makeNoise2D(seed);
  const group = new THREE.Group();
  group.name = "world";
  scene.add(group);

  const roads = buildRoadLayout();
  const pads = buildPads();
  const ramps = buildRamps();

  /* ---------- Felder: flach / Grip / Oberflaeche ---------- */
  const flatField = new Float32Array(GRID * GRID);
  const gripField = new Float32Array(GRID * GRID).fill(GRIP_BY_SURF[SURF.GRASS]);
  const surfField = new Uint8Array(GRID * GRID);
  const roadness = new Float32Array(GRID * GRID);

  const toIdx = (v) => clamp(Math.round((v + WORLD_HALF) / CELL), 0, GRID - 1);
  const toWorld = (i) => i * CELL - WORLD_HALF;

  function stampSegment(ax, az, bx, bz, halfW, kind) {
    const falloff = halfW + 26;
    const x0 = toIdx(Math.min(ax, bx) - falloff), x1 = toIdx(Math.max(ax, bx) + falloff);
    const z0 = toIdx(Math.min(az, bz) - falloff), z1 = toIdx(Math.max(az, bz) + falloff);
    const surf = kind === "dirt" ? SURF.DIRT : SURF.ROAD;
    for (let ix = x0; ix <= x1; ix++) {
      const wx = toWorld(ix);
      for (let iz = z0; iz <= z1; iz++) {
        const wz = toWorld(iz);
        const d = Math.sqrt(distToSegment2(wx, wz, ax, az, bx, bz).d2);
        const idx = iz * GRID + ix;
        const flat = smoothstep(halfW + 24, halfW + 1, d);
        if (flat > flatField[idx]) flatField[idx] = flat;
        const on = smoothstep(halfW + 1.5, halfW - 1.5, d);
        if (on > roadness[idx]) {
          roadness[idx] = on;
          if (on > 0.5) surfField[idx] = surf;
        }
        const g = lerp(gripField[idx], GRIP_BY_SURF[surf], on);
        if (g > gripField[idx]) gripField[idx] = g;
      }
    }
  }

  for (const road of roads) {
    const pts = road.points;
    const segs = road.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      stampSegment(a.x, a.z, b.x, b.z, road.width / 2, road.kind);
    }
  }

  function padDistance(pad, x, z) {
    if (pad.type === "circle") return Math.hypot(x - pad.x, z - pad.z) - pad.r;
    const dx = Math.abs(x - pad.x) - pad.hx;
    const dz = Math.abs(z - pad.z) - pad.hz;
    return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
  }

  for (const pad of pads) {
    const reach = (pad.type === "circle" ? pad.r : Math.max(pad.hx, pad.hz)) + pad.margin + 8;
    const x0 = toIdx(pad.x - reach), x1 = toIdx(pad.x + reach);
    const z0 = toIdx(pad.z - reach), z1 = toIdx(pad.z + reach);
    for (let ix = x0; ix <= x1; ix++) {
      const wx = toWorld(ix);
      for (let iz = z0; iz <= z1; iz++) {
        const wz = toWorld(iz);
        const d = padDistance(pad, wx, wz);
        const idx = iz * GRID + ix;
        const flat = smoothstep(pad.margin, 0, d);
        if (flat > flatField[idx]) flatField[idx] = flat;
        if (d < 0 && surfField[idx] === SURF.GRASS) {
          surfField[idx] = pad.surf;
          gripField[idx] = Math.max(gripField[idx], GRIP_BY_SURF[pad.surf]);
        }
      }
    }
  }

  /* ---------- Terrain-Hoehen ---------- */
  const heights = new Float32Array(GRID * GRID);
  function baseHeight(x, z) {
    const s = 1 / 300;
    let h = fbm(noise, x * s, z * s, 4) * 30;
    h += fbm(noise, x * s * 3.3 + 17, z * s * 3.3 - 9, 3) * 6;
    h += 6;
    const edge = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
    h += smoothstep(0.70, 1.0, edge) * 150;         // Randgebirge
    return h;
  }
  for (let iz = 0; iz < GRID; iz++) {
    const wz = toWorld(iz);
    for (let ix = 0; ix < GRID; ix++) {
      const idx = iz * GRID + ix;
      heights[idx] = baseHeight(toWorld(ix), wz) * (1 - flatField[idx]);
    }
  }
  // Leichtes Glaetten, damit keine harten Kanten entstehen
  const smoothed = Float32Array.from(heights);
  for (let iz = 1; iz < GRID - 1; iz++) {
    for (let ix = 1; ix < GRID - 1; ix++) {
      const i = iz * GRID + ix;
      smoothed[i] = (heights[i] * 4 + heights[i - 1] + heights[i + 1] + heights[i - GRID] + heights[i + GRID]) / 8;
    }
  }
  heights.set(smoothed);

  function bilinear(field, x, z) {
    const fx = clamp((x + WORLD_HALF) / CELL, 0, GRID - 1.001);
    const fz = clamp((z + WORLD_HALF) / CELL, 0, GRID - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const i = iz * GRID + ix;
    const a = field[i], b = field[i + 1], c = field[i + GRID], d = field[i + GRID + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  const terrainHeightAt = (x, z) => bilinear(heights, x, z);

  /** Kombinierte Hoehe: Terrain + Rampen. */
  function combinedHeight(x, z) {
    const base = terrainHeightAt(x, z);
    let best = base;
    for (const r of ramps) {
      const res = rampHeight(r, x, z);
      if (!res) continue;
      const y = base + res.h * res.fade;
      if (y > best) best = y;
    }
    return best;
  }

  function nearestSurfKind(x, z) {
    const ix = toIdx(x), iz = toIdx(z);
    return surfField[iz * GRID + ix];
  }

  const surfaceOut = { y: 0, nx: 0, ny: 1, nz: 0, grip: 1, kind: SURF.ROAD, onRamp: false };
  function sampleSurface(x, z, out = surfaceOut) {
    const eps = 1.1;
    const y = combinedHeight(x, z);
    const hx1 = combinedHeight(x + eps, z), hx0 = combinedHeight(x - eps, z);
    const hz1 = combinedHeight(x, z + eps), hz0 = combinedHeight(x, z - eps);
    let nx = -(hx1 - hx0) / (2 * eps);
    let nz = -(hz1 - hz0) / (2 * eps);
    const len = Math.hypot(nx, 1, nz);
    out.y = y;
    out.nx = nx / len; out.ny = 1 / len; out.nz = nz / len;
    const onRamp = y > terrainHeightAt(x, z) + 0.15;
    out.onRamp = onRamp;
    out.kind = onRamp ? SURF.CONCRETE : nearestSurfKind(x, z);
    out.grip = onRamp ? GRIP_BY_SURF[SURF.CONCRETE] : bilinear(gripField, x, z);
    return out;
  }

  /* ---------- Terrain-Mesh ---------- */
  const terrainGeo = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, GRID - 1, GRID - 1);
  terrainGeo.rotateX(-Math.PI / 2);
  {
    const pos = terrainGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x4f7a3a);
    const cGrass2 = new THREE.Color(0x5f8a42);
    const cDirt = new THREE.Color(0x7a6038);
    const cRock = new THREE.Color(0x76787c);
    const cConc = new THREE.Color(0x848b95);
    const cSnow = new THREE.Color(0xdfe6ef);
    const cAsphalt = new THREE.Color(0x35393f);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const idx = toIdx(z) * GRID + toIdx(x);
      const h = heights[idx];
      pos.setY(i, h);
      const ix = toIdx(x), iz = toIdx(z);
      const hL = heights[iz * GRID + Math.max(ix - 1, 0)];
      const hR = heights[iz * GRID + Math.min(ix + 1, GRID - 1)];
      const hU = heights[Math.max(iz - 1, 0) * GRID + ix];
      const hD = heights[Math.min(iz + 1, GRID - 1) * GRID + ix];
      const slope = Math.max(Math.abs(hR - hL), Math.abs(hD - hU)) / (2 * CELL);
      const kind = surfField[idx];
      const n = fbm(noise, x * 0.02, z * 0.02, 2);
      if (kind === SURF.ROAD) tmp.copy(cAsphalt);
      else if (kind === SURF.CONCRETE) tmp.copy(cConc);
      else if (kind === SURF.DIRT) tmp.copy(cDirt);
      else tmp.copy(cGrass).lerp(cGrass2, n * 0.5 + 0.5);
      // Bankette: direkt neben der Fahrbahn erdig
      if (kind === SURF.GRASS) tmp.lerp(cDirt, smoothstep(0.05, 0.5, roadness[idx]) * 0.7);
      tmp.lerp(cRock, smoothstep(0.34, 0.85, slope));
      tmp.lerp(cSnow, smoothstep(118, 165, h));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    terrainGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    terrainGeo.computeVertexNormals();
  }
  const terrain = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })
  );
  terrain.receiveShadow = true;
  terrain.name = "terrain";
  group.add(terrain);

  /* ---------- Strassen-Baender ---------- */
  const roadMats = {
    street: new THREE.MeshStandardMaterial({ map: asphaltTexture(2), roughness: 0.82, metalness: 0.02 }),
    highway: new THREE.MeshStandardMaterial({ map: asphaltTexture(4), roughness: 0.8, metalness: 0.02 }),
    dirt: new THREE.MeshStandardMaterial({ map: dirtTexture(), roughness: 0.98, metalness: 0 }),
  };
  for (const road of roads) {
    const pts = road.points;
    const closed = road.closed;
    const count = closed ? pts.length + 1 : pts.length;
    const verts = [], uvs = [], idxs = [];
    let dist = 0;
    for (let i = 0; i < count; i++) {
      const p = pts[i % pts.length];
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      let tx = next.x - prev.x, tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;              // Seitennormale
      const hw = road.width / 2;
      const y = terrainHeightAt(p.x, p.z) + 0.1;
      verts.push(p.x + nx * hw, y, p.z + nz * hw);
      verts.push(p.x - nx * hw, y, p.z - nz * hw);
      if (i > 0) dist += Math.hypot(p.x - pts[(i - 1 + pts.length) % pts.length].x, p.z - pts[(i - 1 + pts.length) % pts.length].z);
      const v = dist / (road.kind === "highway" ? 14 : 11);
      uvs.push(0, v, 1, v);
      if (i < count - 1) {
        const a = i * 2;
        // Wicklung gegen den Uhrzeigersinn von oben -> Normale zeigt nach +y
        idxs.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idxs);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, roadMats[road.kind]);
    mesh.receiveShadow = true;
    mesh.name = "road-" + road.kind;
    group.add(mesh);
  }

  /* ---------- Beton-Flaechen (Stuntpark, Driftkreis) ---------- */
  const concMat = new THREE.MeshStandardMaterial({ map: concreteTexture(30), color: 0xb9bec6, roughness: 0.92, metalness: 0.02 });
  {
    const parkGeo = new THREE.PlaneGeometry(PARK.hx * 2, PARK.hz * 2, 1, 1).rotateX(-Math.PI / 2);
    const park = new THREE.Mesh(parkGeo, concMat);
    park.position.set(PARK.x, terrainHeightAt(PARK.x, PARK.z) + 0.08, PARK.z);
    park.receiveShadow = true;
    group.add(park);

    const padGeo = new THREE.CircleGeometry(SKIDPAD.r, 48).rotateX(-Math.PI / 2);
    const pad = new THREE.Mesh(padGeo, concMat);
    pad.position.set(SKIDPAD.x, terrainHeightAt(SKIDPAD.x, SKIDPAD.z) + 0.08, SKIDPAD.z);
    pad.receiveShadow = true;
    group.add(pad);
    // Drift-Markierung
    const ringGeo = new THREE.RingGeometry(SKIDPAD.r * 0.55, SKIDPAD.r * 0.58, 64).rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.5 }));
    ring.position.copy(pad.position).y += 0.03;
    group.add(ring);
  }

  const colliders = new ColliderGrid(40);

  /* ---------- Rampen-Meshes ---------- */
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ac, roughness: 0.78, metalness: 0.05 });
  const rampEdgeMat = new THREE.MeshStandardMaterial({ color: 0xffb347, roughness: 0.6, metalness: 0.1 });
  for (const r of ramps) {
    const baseY = terrainHeightAt(r.x, r.z);
    const steps = 16;
    const total = r.type === "tabletop" ? r.lenIn + r.lenFlat + r.lenOut : r.len;
    const hw = r.wid / 2;
    const profile = [];
    for (let i = 0; i <= steps; i++) {
      const lx = (i / steps) * total;
      const probe = rampHeight(r, r.x + Math.sin(r.yaw) * lx, r.z + Math.cos(r.yaw) * lx);
      profile.push({ lx, h: probe ? probe.h : 0 });
    }
    const verts = [], idxs = [];
    const push = (x, y, z) => { verts.push(x, y, z); return verts.length / 3 - 1; };
    // Deckflaeche
    const topIdx = [];
    for (const pt of profile) topIdx.push([push(-hw, pt.h, pt.lx), push(hw, pt.h, pt.lx)]);
    for (let i = 0; i < steps; i++) {
      const [l0, r0] = topIdx[i], [l1, r1] = topIdx[i + 1];
      idxs.push(l0, l1, r0, r0, l1, r1);
    }
    // Seitenwaende
    for (const side of [-1, 1]) {
      const x = side * hw;
      const wall = profile.map((pt) => [push(x, 0, pt.lx), push(x, pt.h, pt.lx)]);
      for (let i = 0; i < steps; i++) {
        const [b0, t0] = wall[i], [b1, t1] = wall[i + 1];
        if (side < 0) idxs.push(b0, t0, b1, b1, t0, t1);
        else idxs.push(b0, b1, t0, t0, b1, t1);
      }
    }
    // Rueckwand (Absprungkante bzw. Ende des Podests)
    const lastH = profile[profile.length - 1].h;
    if (lastH > 0.05) {
      const bl = push(-hw, 0, total), br = push(hw, 0, total);
      const tl = push(-hw, lastH, total), tr = push(hw, lastH, total);
      idxs.push(bl, br, tl, tl, br, tr);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idxs);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, rampMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.set(r.x, baseY + 0.02, r.z);
    mesh.rotation.y = r.yaw;
    group.add(mesh);

    // Kantenmarkierung am Absprung
    const lipLx = r.type === "tabletop" ? r.lenIn : r.len;
    const lipProbe = rampHeight(r, r.x + Math.sin(r.yaw) * (lipLx - 0.2), r.z + Math.cos(r.yaw) * (lipLx - 0.2));
    const lip = new THREE.Mesh(new THREE.BoxGeometry(r.wid + 0.1, 0.16, 1.1), rampEdgeMat);
    lip.position.set(
      r.x + Math.sin(r.yaw) * lipLx,
      baseY + (lipProbe ? lipProbe.h : r.height) + 0.08,
      r.z + Math.cos(r.yaw) * lipLx
    );
    lip.rotation.y = r.yaw;
    group.add(lip);
  }

  /* ---------- Gebaeude ---------- */
  const buildingTypes = [
    { w: 34, d: 34, h: 52, cols: 8, rows: 14 },
    { w: 44, d: 30, h: 26, cols: 10, rows: 7 },
    { w: 26, d: 26, h: 16, cols: 6, rows: 4 },
    { w: 38, d: 38, h: 38, cols: 9, rows: 10 },
    { w: 30, d: 46, h: 22, cols: 7, rows: 6 },
    { w: 22, d: 30, h: 64, cols: 5, rows: 17 },
  ];
  const buildingSlots = buildingTypes.map(() => []);
  const roofSlots = [];

  function isFree(x, z, hx, hz) {
    // nicht auf Strassen und nicht in Rampenzonen
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const px = x + ox * hx, pz = z + oz * hz;
        const idx = toIdx(pz) * GRID + toIdx(px);
        if (roadness[idx] > 0.12) return false;
      }
    }
    return true;
  }

  for (let bi = 0; bi < STREETS.length - 1; bi++) {
    for (let bj = 0; bj < STREETS.length - 1; bj++) {
      const cx = (STREETS[bi] + STREETS[bi + 1]) / 2;
      const cz = (STREETS[bj] + STREETS[bj + 1]) / 2;
      const perBlock = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < perBlock; k++) {
        const t = Math.floor(rand() * buildingTypes.length);
        const type = buildingTypes[t];
        const yaw = Math.floor(rand() * 4) * (Math.PI / 2);
        const swap = Math.abs(Math.sin(yaw)) > 0.5;
        const hx = (swap ? type.d : type.w) / 2, hz = (swap ? type.w : type.d) / 2;
        const px = cx + (rand() - 0.5) * (120 - hx * 2);
        const pz = cz + (rand() - 0.5) * (120 - hz * 2);
        if (!isFree(px, pz, hx + 3, hz + 3)) continue;
        const y = terrainHeightAt(px, pz);
        buildingSlots[t].push({ x: px, z: pz, y, yaw, tint: 0.82 + rand() * 0.3 });
        roofSlots.push({ x: px, z: pz, y: y + type.h, yaw, hx: (swap ? type.d : type.w), hz: (swap ? type.w : type.d) });
        colliders.add({ kind: "box", x: px, z: pz, yaw, hx, hz, top: y + type.h, bounce: 0.22, hard: true });
      }
    }
  }
  // Lagerhallen am Stuntpark
  for (let i = 0; i < 5; i++) {
    const px = PARK.x - PARK.hx - 40 - rand() * 50;
    const pz = PARK.z - PARK.hz + rand() * PARK.hz * 2;
    const type = buildingTypes[1];
    const y = terrainHeightAt(px, pz);
    buildingSlots[1].push({ x: px, z: pz, y, yaw: 0, tint: 0.9 });
    roofSlots.push({ x: px, z: pz, y: y + type.h, yaw: 0, hx: type.w, hz: type.d });
    colliders.add({ kind: "box", x: px, z: pz, yaw: 0, hx: type.w / 2, hz: type.d / 2, top: y + type.h, bounce: 0.22, hard: true });
  }

  const buildingMeshes = [];
  buildingTypes.forEach((type, t) => {
    const slots = buildingSlots[t];
    if (!slots.length) return;
    const { map, emissive } = facadeTexture(seed + t * 977, type.cols, type.rows);
    const mat = new THREE.MeshStandardMaterial({
      map, emissiveMap: emissive, emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.15, roughness: 0.72, metalness: 0.06,
    });
    const geo = new THREE.BoxGeometry(type.w, type.h, type.d);
    const mesh = new THREE.InstancedMesh(geo, mat, slots.length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    slots.forEach((slot, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), slot.yaw);
      m.compose(new THREE.Vector3(slot.x, slot.y + type.h / 2, slot.z), q, s);
      mesh.setMatrixAt(i, m);
      col.setScalar(slot.tint);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = "buildings-" + t;
    group.add(mesh);
    buildingMeshes.push(mesh);
  });
  // Dachplatten
  if (roofSlots.length) {
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3b4149, roughness: 0.9 });
    const roofMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.6, 1), roofMat, roofSlots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    roofSlots.forEach((r, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw);
      m.compose(new THREE.Vector3(r.x, r.y + 0.3, r.z), q, new THREE.Vector3(r.hx + 1.4, 1, r.hz + 1.4));
      roofMesh.setMatrixAt(i, m);
    });
    roofMesh.instanceMatrix.needsUpdate = true;
    roofMesh.castShadow = true;
    group.add(roofMesh);
  }

  /* ---------- Baeume, Felsen ---------- */
  const trunkSlots = [];
  for (let i = 0; i < 1400; i++) {
    const x = (rand() * 2 - 1) * (WORLD_HALF - 30);
    const z = (rand() * 2 - 1) * (WORLD_HALF - 30);
    const idx = toIdx(z) * GRID + toIdx(x);
    if (surfField[idx] !== SURF.GRASS || flatField[idx] > 0.25) continue;
    const y = terrainHeightAt(x, z);
    if (y > 120 || y < 1) continue;
    const hL = terrainHeightAt(x - 4, z), hR = terrainHeightAt(x + 4, z);
    const hU = terrainHeightAt(x, z - 4), hD = terrainHeightAt(x, z + 4);
    if (Math.max(Math.abs(hR - hL), Math.abs(hD - hU)) / 8 > 0.5) continue;
    const scale = 0.75 + rand() * 0.8;
    trunkSlots.push({ x, y, z, scale, yaw: rand() * TAU });
    colliders.add({ kind: "cyl", x, z, r: 1.0 * scale, top: y + 9 * scale, bounce: 0.15, hard: true });
  }
  if (trunkSlots.length) {
    const trunkMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.55, 0.75, 4.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.95 }),
      trunkSlots.length
    );
    const crownMesh = new THREE.InstancedMesh(
      new THREE.ConeGeometry(3.4, 8.4, 7),
      new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.9, flatShading: true }),
      trunkSlots.length
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    trunkSlots.forEach((t, i) => {
      q.setFromAxisAngle(up, t.yaw);
      m.compose(new THREE.Vector3(t.x, t.y + 2.2 * t.scale, t.z), q, new THREE.Vector3(t.scale, t.scale, t.scale));
      trunkMesh.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(t.x, t.y + (4.4 + 4.2) * t.scale, t.z), q, new THREE.Vector3(t.scale, t.scale, t.scale));
      crownMesh.setMatrixAt(i, m);
      col.setHSL(0.28 + (i % 7) * 0.006, 0.42, 0.26 + (i % 5) * 0.02);
      crownMesh.setColorAt(i, col);
    });
    trunkMesh.instanceMatrix.needsUpdate = true;
    crownMesh.instanceMatrix.needsUpdate = true;
    if (crownMesh.instanceColor) crownMesh.instanceColor.needsUpdate = true;
    crownMesh.castShadow = true;
    group.add(trunkMesh, crownMesh);
  }

  const rockSlots = [];
  for (let i = 0; i < 260; i++) {
    const x = (rand() * 2 - 1) * (WORLD_HALF - 20);
    const z = (rand() * 2 - 1) * (WORLD_HALF - 20);
    const idx = toIdx(z) * GRID + toIdx(x);
    if (flatField[idx] > 0.3) continue;
    const y = terrainHeightAt(x, z);
    const scale = 1.4 + rand() * 3.4;
    rockSlots.push({ x, y, z, scale, yaw: rand() * TAU });
    colliders.add({ kind: "cyl", x, z, r: scale * 0.85, top: y + scale * 1.1, bounce: 0.3, hard: true });
  }
  if (rockSlots.length) {
    const rockMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x7e8288, roughness: 0.95, flatShading: true }),
      rockSlots.length
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    rockSlots.forEach((r, i) => {
      q.setFromAxisAngle(up, r.yaw);
      m.compose(new THREE.Vector3(r.x, r.y + r.scale * 0.45, r.z), q, new THREE.Vector3(r.scale, r.scale * 0.8, r.scale));
      rockMesh.setMatrixAt(i, m);
    });
    rockMesh.instanceMatrix.needsUpdate = true;
    rockMesh.castShadow = true;
    group.add(rockMesh);
  }

  /* ---------- Strassenlaternen ---------- */
  const lampSlots = [];
  for (const road of roads) {
    if (road.kind === "dirt") continue;
    const pts = road.points;
    const step = road.kind === "highway" ? 6 : 2;
    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      const next = pts[(i + 1) % pts.length];
      let tx = next.x - p.x, tz = next.z - p.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const side = (i % (step * 2) === 0) ? 1 : -1;
      const off = road.width / 2 + 2.4;
      const x = p.x - tz * off * side, z = p.z + tx * off * side;
      const y = terrainHeightAt(x, z);
      lampSlots.push({ x, y, z, yaw: Math.atan2(tx, tz) });
      colliders.add({ kind: "cyl", x, z, r: 0.45, top: y + 9, bounce: 0.1, hard: true });
    }
  }
  let lampHeadMesh = null;
  if (lampSlots.length) {
    const postMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.22, 8.4, 5),
      new THREE.MeshStandardMaterial({ color: 0x3d444d, roughness: 0.6, metalness: 0.5 }),
      lampSlots.length
    );
    lampHeadMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.5, 0.3, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x20262e, emissive: new THREE.Color(0xffe0a8), emissiveIntensity: 0, roughness: 0.4 }),
      lampSlots.length
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(1, 1, 1);
    lampSlots.forEach((l, i) => {
      q.setFromAxisAngle(up, l.yaw);
      m.compose(new THREE.Vector3(l.x, l.y + 4.2, l.z), q, s);
      postMesh.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(l.x, l.y + 8.5, l.z), q, s);
      lampHeadMesh.setMatrixAt(i, m);
    });
    postMesh.instanceMatrix.needsUpdate = true;
    lampHeadMesh.instanceMatrix.needsUpdate = true;
    group.add(postMesh, lampHeadMesh);
  }

  /* ---------- Dynamische Huetchen ---------- */
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6b2c, roughness: 0.7, flatShading: true });
  const conePositions = [];
  for (let i = 0; i < 44; i++) {              // Kreis auf dem Driftpad
    const t = (i / 44) * TAU;
    conePositions.push({ x: SKIDPAD.x + Math.cos(t) * SKIDPAD.r * 0.56, z: SKIDPAD.z + Math.sin(t) * SKIDPAD.r * 0.56 });
  }
  for (let i = 0; i < 26; i++) {              // Slalom im Stuntpark
    conePositions.push({ x: PARK.x - 120 + i * 9, z: PARK.z + 96 + Math.sin(i * 0.9) * 10 });
  }
  for (let i = 0; i < 30; i++) {              // Baustelle in der Stadt
    const road = roads[Math.floor(rand() * STREETS.length)];
    const p = road.points[Math.floor(rand() * road.points.length)];
    conePositions.push({ x: p.x + (rand() - 0.5) * 12, z: p.z + (rand() - 0.5) * 60 });
  }
  const cones = conePositions.map((p) => ({
    x: p.x, z: p.z, y: terrainHeightAt(p.x, p.z), baseY: terrainHeightAt(p.x, p.z),
    vx: 0, vy: 0, vz: 0, tilt: 0, tiltAxis: 0, spin: 0, active: false,
  }));
  const coneMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1.2, 8), coneMat, Math.max(cones.length, 1));
  coneMesh.castShadow = true;
  group.add(coneMesh);
  const coneMatrix = new THREE.Matrix4();
  const coneQuat = new THREE.Quaternion();
  const coneEuler = new THREE.Euler();
  const coneScale = new THREE.Vector3(1, 1, 1);
  function writeCone(i) {
    const c = cones[i];
    coneEuler.set(Math.cos(c.tiltAxis) * c.tilt, c.spin, Math.sin(c.tiltAxis) * c.tilt);
    coneQuat.setFromEuler(coneEuler);
    coneMatrix.compose(new THREE.Vector3(c.x, c.y + 0.6, c.z), coneQuat, coneScale);
    coneMesh.setMatrixAt(i, coneMatrix);
  }
  for (let i = 0; i < cones.length; i++) writeCone(i);
  coneMesh.instanceMatrix.needsUpdate = true;

  /* ---------- Welt-Begrenzung ---------- */
  const B = WORLD_HALF - 6;
  for (const c of [
    { x: 0, z: -B, hx: WORLD_HALF, hz: 4 },
    { x: 0, z: B, hx: WORLD_HALF, hz: 4 },
    { x: -B, z: 0, hx: 4, hz: WORLD_HALF },
    { x: B, z: 0, hx: 4, hz: WORLD_HALF },
  ]) colliders.add({ kind: "box", ...c, yaw: 0, top: 1e4, bounce: 0.4, hard: true });

  /* ---------- Kollisionsauflösung fuer einen Kreis ---------- */
  const queryBuf = [];
  const hitOut = { hit: false, nx: 0, nz: 0, depth: 0, bounce: 0.3 };
  function resolveCircle(x, z, r, y = 0) {
    hitOut.hit = false; hitOut.depth = 0; hitOut.nx = 0; hitOut.nz = 0;
    colliders.query(x, z, queryBuf);
    for (const c of queryBuf) {
      if (y > c.top - 0.35) continue;                // drueber hinweg (Sprung)
      let nx = 0, nz = 0, depth = 0;
      if (c.kind === "cyl") {
        const dx = x - c.x, dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const pen = c.r + r - d;
        if (pen <= 0) continue;
        depth = pen;
        nx = d > 1e-4 ? dx / d : 1; nz = d > 1e-4 ? dz / d : 0;
      } else {
        const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
        const dx = x - c.x, dz = z - c.z;
        const lx = dx * co - dz * s;                 // lokale Koordinaten
        const lz = dx * s + dz * co;
        const qx = Math.abs(lx) - c.hx, qz = Math.abs(lz) - c.hz;
        if (qx > r || qz > r) continue;
        let lnx = 0, lnz = 0;
        if (qx > 0 && qz > 0) {                      // Ecke
          const d = Math.hypot(qx, qz);
          const pen = r - d;
          if (pen <= 0) continue;
          depth = pen;
          lnx = Math.sign(lx) * (qx / d); lnz = Math.sign(lz) * (qz / d);
        } else if (qx > qz) {                        // Seite in x
          depth = r - qx;
          lnx = Math.sign(lx) || 1;
        } else {
          depth = r - qz;
          lnz = Math.sign(lz) || 1;
        }
        nx = lnx * co + lnz * s;
        nz = -lnx * s + lnz * co;
      }
      if (depth > hitOut.depth) {
        hitOut.hit = true; hitOut.depth = depth; hitOut.nx = nx; hitOut.nz = nz;
        hitOut.bounce = c.bounce ?? 0.3;
      }
    }
    return hitOut;
  }

  /** Huetchen wegkicken. Gibt die Anzahl getroffener Huetchen zurueck. */
  function hitProps(x, z, r, vx, vz) {
    let count = 0;
    for (let i = 0; i < cones.length; i++) {
      const c = cones[i];
      const dx = c.x - x, dz = c.z - z;
      if (Math.abs(dx) > r + 1 || Math.abs(dz) > r + 1) continue;
      if (dx * dx + dz * dz > (r + 0.6) * (r + 0.6)) continue;
      const speed = Math.hypot(vx, vz);
      if (speed < 0.6) continue;
      const d = Math.hypot(dx, dz) || 1;
      c.vx = (dx / d) * speed * 0.55 + vx * 0.25;
      c.vz = (dz / d) * speed * 0.55 + vz * 0.25;
      c.vy = Math.min(4 + speed * 0.12, 11);
      c.spin = (Math.random() - 0.5) * 8;
      c.tiltAxis = Math.atan2(c.vz, c.vx);
      c.active = true;
      count++;
    }
    return count;
  }

  /* ---------- Strassen-Snapping (Reset / Checkpoints) ---------- */
  const snapCandidates = [];
  for (const road of roads) {
    const pts = road.points;
    const segs = road.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      snapCandidates.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
  }
  function snapToRoad(x, z, preferYaw = 0) {
    let best = null, bestD2 = Infinity;
    for (const s of snapCandidates) {
      const { d2, t } = distToSegment2(x, z, s.ax, s.az, s.bx, s.bz);
      if (d2 < bestD2) { bestD2 = d2; best = { s, t }; }
    }
    if (!best) return { x, z, yaw: preferYaw };
    const { s, t } = best;
    const px = s.ax + (s.bx - s.ax) * t, pz = s.az + (s.bz - s.az) * t;
    let yaw = Math.atan2(s.bx - s.ax, s.bz - s.az);
    // in die Richtung drehen, die der aktuellen Blickrichtung naeher ist
    const flip = Math.cos(yaw - preferYaw) < 0 ? Math.PI : 0;
    return { x: px, z: pz, yaw: yaw + flip };
  }

  /* ---------- Checkpoint-Route ---------- */
  const rawRoute = [
    { x: 0, z: 120 }, { x: 0, z: -180 }, { x: 20, z: -420 }, { x: 0, z: -566 },
    { x: 360, z: -480 }, { x: 600, z: -200 }, { x: 626, z: 0 }, { x: 470, z: -30 },
    { x: 150, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 180 }, { x: 0, z: 300 },
  ];
  const timetrialRoute = rawRoute.map((p) => {
    const snapped = snapToRoad(p.x, p.z, 0);
    return { x: snapped.x, z: snapped.z, yaw: snapped.yaw, y: terrainHeightAt(snapped.x, snapped.z) };
  });

  const spawns = {
    freeroam: { x: 0, z: 260, yaw: Math.PI },
    drift: { x: SKIDPAD.x, z: SKIDPAD.z + SKIDPAD.r * 0.56, yaw: Math.PI * 0.5 },
    timetrial: { x: 0, z: 300, yaw: Math.PI },
    stunt: { x: PARK.x - 78, z: PARK.z + 110, yaw: Math.PI },
  };
  for (const key in spawns) spawns[key].y = terrainHeightAt(spawns[key].x, spawns[key].z);

  /* ---------- Update (Huetchen-Physik) ---------- */
  function update(dt) {
    let dirty = false;
    for (let i = 0; i < cones.length; i++) {
      const c = cones[i];
      if (!c.active) continue;
      c.vy -= 22 * dt;
      c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt;
      const ground = terrainHeightAt(c.x, c.z);
      if (c.y <= ground) {
        c.y = ground;
        c.vy *= -0.32;
        c.vx *= 0.7; c.vz *= 0.7;
        c.tilt = Math.min(c.tilt + 0.5, Math.PI / 2);
        if (Math.abs(c.vy) < 0.6 && Math.hypot(c.vx, c.vz) < 0.5) {
          c.active = false; c.vx = c.vy = c.vz = 0;
        }
      }
      c.spin *= 1 - 0.8 * dt;
      writeCone(i);
      dirty = true;
    }
    if (dirty) coneMesh.instanceMatrix.needsUpdate = true;
  }

  function setNight(on) {
    if (lampHeadMesh) lampHeadMesh.material.emissiveIntensity = on ? 2.6 : 0;
    for (const m of buildingMeshes) m.material.emissiveIntensity = on ? 1.5 : 0.12;
  }

  return {
    group, seed, half: WORLD_HALF,
    roads, pads, ramps, park: PARK, skidpad: SKIDPAD, streets: STREETS,
    terrainHeightAt, heightAt: combinedHeight, sampleSurface,
    resolveCircle, hitProps, snapToRoad, update, setNight,
    colliderCount: colliders.all.length,
    colliders: colliders.all,   // fuer Debug/Tests
    cones,
    routes: { timetrial: timetrialRoute },
    spawns,
    minimap: {
      half: WORLD_HALF,
      roads: roads.map((r) => ({ points: r.points, width: r.width, kind: r.kind, closed: r.closed })),
      city: { x: 0, z: 0, hx: CITY_EXTENT, hz: CITY_EXTENT },
      park: PARK, skidpad: SKIDPAD,
    },
  };
}
