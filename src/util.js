// Kleine Mathe-/Zufalls-Helfer. Alles deterministisch, damit die Welt reproduzierbar ist.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (e0, e1, x) => {
  const t = clamp(invLerp(e0, e1, x), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Rahmenraten-unabhaengiges Annaehern von a an b. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const mod = (a, n) => ((a % n) + n) % n;
/** Kleinste Differenz zweier Winkel im Bereich [-PI, PI]. */
export const angleDiff = (a, b) => mod(a - b + Math.PI, TAU) - Math.PI;
export const toKmh = (mps) => mps * 3.6;

/** Schneller, seedbarer PRNG (mulberry32). */
export function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seedbares Value-Noise mit bikubischem Fade -- reicht fuer Huegel. */
export function makeNoise2D(seed) {
  const size = 256;
  const mask = size - 1;
  const rand = rng(seed);
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = rand() * 2 - 1;
  const at = (x, y) => table[(y & mask) * size + (x & mask)];
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

/** Fraktales Rauschen aus mehreren Oktaven. */
export function fbm(noise, x, y, octaves = 4, lacunarity = 2.05, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Abstand Punkt -> Segment (quadriert, plus Projektionsparameter). */
export function distToSegment2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return { d2: cx * cx + cz * cz, t };
}

export function formatTime(ms) {
  if (!isFinite(ms) || ms < 0) return "—";
  const total = Math.floor(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString("de-DE");
}

/** Catmull-Rom-Interpolation einer geschlossenen oder offenen Punktliste. */
export function resamplePath(points, steps, closed = true) {
  const out = [];
  const n = points.length;
  const get = (i) => points[closed ? mod(i, n) : clamp(i, 0, n - 1)];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
      });
    }
  }
  if (!closed) out.push({ ...points[n - 1] });
  return out;
}

export function pathLength(points, closed = true) {
  let len = 0;
  for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return len;
}
