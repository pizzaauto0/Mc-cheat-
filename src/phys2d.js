// Minimale 2D-Rigidbody-Physik fuer den Parcours-Modus.
// Nur Rechtecke (statisch, dynamisch oder um einen Punkt drehbar) plus
// Raycasts -- das reicht fuer Rampen, Wippen, Kisten und ein Fahrzeug mit
// Feder-Raedern. Bewusst ohne externe Engine und ohne three.js-Abhaengigkeit,
// damit die Physik pur testbar bleibt.

const ITER = 8;
const SLOP = 0.008;
const CORRECTION = 0.45;

let nextId = 1;

export function createBox({
  x, y, w, h, angle = 0, mass = 0, friction = 0.85, restitution = 0.02,
  pivot = false, tag = "static", surfaceSpeed = 0, data = null,
  angleLimit = null, angularDamping = 0,
}) {
  const hw = w / 2, hh = h / 2;
  const isStatic = mass <= 0;
  const inertia = isStatic ? 0 : (mass * (w * w + h * h)) / 12;
  return {
    id: nextId++, type: "box", tag, data,
    x, y, angle, hw, hh, w, h,
    vx: 0, vy: 0, omega: 0,
    mass: isStatic ? 0 : mass,
    invMass: isStatic || pivot ? 0 : 1 / mass,      // pivot = ortsfest, aber drehbar
    invInertia: isStatic ? 0 : 1 / inertia,
    friction, restitution, surfaceSpeed,
    isStatic, pivot,
    angleLimit,                                   // Endanschlag in rad (z. B. Wippe)
    angularDamping,
    awake: true,
    sleepTimer: 0,
    contacts: [],
  };
}

export function createPhysics({ gravity = -26 } = {}) {
  const bodies = [];
  const dynamics = [];
  const statics = [];
  let contactLog = [];

  function add(body) {
    bodies.push(body);
    if (body.isStatic) statics.push(body);
    else dynamics.push(body);
    return body;
  }

  function clear() {
    bodies.length = 0;
    dynamics.length = 0;
    statics.length = 0;
    contactLog.length = 0;
  }

  /* ----------------------------------------------------------- Hilfsmittel */

  function corners(b, out = []) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const xs = [b.hw, -b.hw, -b.hw, b.hw];
    const ys = [b.hh, b.hh, -b.hh, -b.hh];
    for (let i = 0; i < 4; i++) {
      out[i] = out[i] || { x: 0, y: 0 };
      out[i].x = b.x + xs[i] * c - ys[i] * s;
      out[i].y = b.y + xs[i] * s + ys[i] * c;
    }
    return out;
  }

  /** Weltpunkt -> lokale Koordinaten eines Koerpers. */
  function toLocal(b, px, py, out = { x: 0, y: 0 }) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const dx = px - b.x, dy = py - b.y;
    out.x = dx * c + dy * s;
    out.y = -dx * s + dy * c;
    return out;
  }

  function velocityAt(b, px, py, out = { x: 0, y: 0 }) {
    const rx = px - b.x, ry = py - b.y;
    out.x = b.vx - b.omega * ry;
    out.y = b.vy + b.omega * rx;
    return out;
  }

  function applyForce(b, fx, fy, px, py, dt) {
    if (b.invMass === 0 && b.invInertia === 0) return;
    b.vx += fx * b.invMass * dt;
    b.vy += fy * b.invMass * dt;
    const rx = px - b.x, ry = py - b.y;
    b.omega += (rx * fy - ry * fx) * b.invInertia * dt;
    b.awake = true;
    b.sleepTimer = 0;
  }

  function applyImpulse(b, ix, iy, px, py) {
    if (b.invMass === 0 && b.invInertia === 0) return;
    b.vx += ix * b.invMass;
    b.vy += iy * b.invMass;
    const rx = px - b.x, ry = py - b.y;
    b.omega += (rx * iy - ry * ix) * b.invInertia;
    b.awake = true;
    b.sleepTimer = 0;
  }

  /* --------------------------------------------------- Kollisionserkennung */

  const axesBuf = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  const cornersA = [], cornersB = [];

  function projectBox(cs, ax, ay) {
    let min = Infinity, max = -Infinity;
    for (const c of cs) {
      const p = c.x * ax + c.y * ay;
      if (p < min) min = p;
      if (p > max) max = p;
    }
    return { min, max };
  }

  /** SAT fuer zwei gedrehte Rechtecke. Normale zeigt von a nach b. */
  function sat(a, b) {
    const ca = Math.cos(a.angle), sa = Math.sin(a.angle);
    const cb = Math.cos(b.angle), sb = Math.sin(b.angle);
    axesBuf[0].x = ca; axesBuf[0].y = sa;
    axesBuf[1].x = -sa; axesBuf[1].y = ca;
    axesBuf[2].x = cb; axesBuf[2].y = sb;
    axesBuf[3].x = -sb; axesBuf[3].y = cb;
    corners(a, cornersA);
    corners(b, cornersB);
    let bestDepth = Infinity, bnx = 0, bny = 0;
    for (const ax of axesBuf) {
      const pa = projectBox(cornersA, ax.x, ax.y);
      const pb = projectBox(cornersB, ax.x, ax.y);
      const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
      if (overlap <= 0) return null;
      if (overlap < bestDepth) {
        bestDepth = overlap;
        // Normale so drehen, dass sie von a weg zeigt
        const dir = (b.x - a.x) * ax.x + (b.y - a.y) * ax.y;
        bnx = dir < 0 ? -ax.x : ax.x;
        bny = dir < 0 ? -ax.y : ax.y;
      }
    }
    return { depth: bestDepth, nx: bnx, ny: bny };
  }

  const pointBuf = { x: 0, y: 0 };
  function insideBox(b, px, py, margin = 0.002) {
    toLocal(b, px, py, pointBuf);
    return Math.abs(pointBuf.x) <= b.hw + margin && Math.abs(pointBuf.y) <= b.hh + margin;
  }

  /** Kontaktpunkte: Ecken, die im jeweils anderen Rechteck liegen. */
  function manifold(a, b, n) {
    const pts = [];
    corners(a, cornersA);
    corners(b, cornersB);
    for (const c of cornersB) if (insideBox(a, c.x, c.y)) pts.push({ x: c.x, y: c.y, from: "b" });
    for (const c of cornersA) if (insideBox(b, c.x, c.y)) pts.push({ x: c.x, y: c.y, from: "a" });
    if (!pts.length) {
      // Kante an Kante: tiefste Ecken beider Seiten mitteln
      let bestA = cornersA[0], bestB = cornersB[0];
      let dA = -Infinity, dB = Infinity;
      for (const c of cornersA) {
        const d = c.x * n.nx + c.y * n.ny;
        if (d > dA) { dA = d; bestA = c; }
      }
      for (const c of cornersB) {
        const d = c.x * n.nx + c.y * n.ny;
        if (d < dB) { dB = d; bestB = c; }
      }
      pts.push({ x: (bestA.x + bestB.x) / 2, y: (bestA.y + bestB.y) / 2, from: "edge" });
    }
    return pts.slice(0, 2);
  }

  function broadphaseHit(a, b) {
    const ra = Math.hypot(a.hw, a.hh), rb = Math.hypot(b.hw, b.hh);
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy <= (ra + rb) * (ra + rb);
  }

  /* -------------------------------------------------------------- Schritt */

  function step(dt) {
    contactLog.length = 0;

    // Integration der Geschwindigkeiten
    for (const b of dynamics) {
      if (b.invMass > 0) b.vy += gravity * dt;
      b.vx *= 1 - 0.02 * dt;
      b.vy *= 1 - 0.02 * dt;
      b.omega *= 1 - 0.6 * dt;
    }

    // Kontakte sammeln
    const contacts = [];
    for (let i = 0; i < dynamics.length; i++) {
      const a = dynamics[i];
      for (let j = i + 1; j < dynamics.length; j++) {
        const b = dynamics[j];
        if (a.invMass === 0 && b.invMass === 0) continue;
        if (!broadphaseHit(a, b)) continue;
        const n = sat(a, b);
        if (!n) continue;
        for (const p of manifold(a, b, n)) contacts.push({ a, b, ...n, px: p.x, py: p.y, from: p.from });
      }
      for (const s of statics) {
        if (!broadphaseHit(a, s)) continue;
        const n = sat(a, s);
        if (!n) continue;
        for (const p of manifold(a, s, n)) contacts.push({ a, b: s, ...n, px: p.x, py: p.y, from: p.from });
      }
    }

    // Impulse (sequentiell)
    for (let it = 0; it < ITER; it++) {
      for (const c of contacts) {
        const { a, b, nx, ny, px, py } = c;
        const va = velocityAt(a, px, py, { x: 0, y: 0 });
        const vb = velocityAt(b, px, py, { x: 0, y: 0 });
        const vn = (vb.x - va.x) * nx + (vb.y - va.y) * ny;
        if (vn > 0) continue;

        const rax = px - a.x, ray = py - a.y;
        const rbx = px - b.x, rby = py - b.y;
        const rnA = rax * ny - ray * nx;
        const rnB = rbx * ny - rby * nx;
        const effMass = a.invMass + b.invMass + rnA * rnA * a.invInertia + rnB * rnB * b.invInertia;
        if (effMass <= 0) continue;

        const e = Math.min(a.restitution, b.restitution) * (it === 0 ? 1 : 0);
        const jn = (-(1 + e) * vn) / effMass;
        applyImpulse(a, -jn * nx, -jn * ny, px, py);
        applyImpulse(b, jn * nx, jn * ny, px, py);

        // Reibung entlang der Tangente
        const tx = -ny, ty = nx;
        const va2 = velocityAt(a, px, py, { x: 0, y: 0 });
        const vb2 = velocityAt(b, px, py, { x: 0, y: 0 });
        let vt = (vb2.x - va2.x) * tx + (vb2.y - va2.y) * ty;
        if (b.surfaceSpeed) vt -= b.surfaceSpeed;
        const rtA = rax * ty - ray * tx;
        const rtB = rbx * ty - rby * tx;
        const effT = a.invMass + b.invMass + rtA * rtA * a.invInertia + rtB * rtB * b.invInertia;
        if (effT <= 0) continue;
        const mu = Math.sqrt(a.friction * b.friction);
        let jt = -vt / effT;
        const maxF = Math.abs(jn) * mu;
        jt = Math.max(-maxF, Math.min(maxF, jt));
        applyImpulse(a, -jt * tx, -jt * ty, px, py);
        applyImpulse(b, jt * tx, jt * ty, px, py);
      }
    }

    // Positionskorrektur
    for (const c of contacts) {
      const { a, b, nx, ny, depth } = c;
      const push = Math.max(depth - SLOP, 0) * CORRECTION;
      const total = a.invMass + b.invMass;
      if (total <= 0) continue;
      a.x -= nx * push * (a.invMass / total);
      a.y -= ny * push * (a.invMass / total);
      b.x += nx * push * (b.invMass / total);
      b.y += ny * push * (b.invMass / total);
      contactLog.push(c);
    }

    // Integration der Positionen
    for (const b of dynamics) {
      if (b.pivot) { b.vx = 0; b.vy = 0; }
      if (b.angularDamping) b.omega *= 1 - Math.min(b.angularDamping * dt, 0.9);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.angle += b.omega * dt;
      if (b.angleLimit !== null && b.angleLimit !== undefined) {
        if (b.angle > b.angleLimit) { b.angle = b.angleLimit; if (b.omega > 0) b.omega = 0; }
        else if (b.angle < -b.angleLimit) { b.angle = -b.angleLimit; if (b.omega < 0) b.omega = 0; }
      }
    }
  }

  /* ------------------------------------------------------------- Raycast */

  /** Strahl gegen alle Rechtecke (ausser `skip`). Gibt den naechsten Treffer. */
  function raycast(ox, oy, dx, dy, maxDist, skip = null) {
    let best = null;
    for (const b of bodies) {
      if (b === skip || b.tag === "ghost") continue;
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      // Strahl in Koerperkoordinaten
      const lx = (ox - b.x) * c + (oy - b.y) * s;
      const ly = -(ox - b.x) * s + (oy - b.y) * c;
      const ldx = dx * c + dy * s;
      const ldy = -dx * s + dy * c;
      let tmin = 0, tmax = maxDist;
      let hitAxis = -1, hitSign = 1;
      // Slab-Test
      for (let axis = 0; axis < 2; axis++) {
        const o = axis === 0 ? lx : ly;
        const d = axis === 0 ? ldx : ldy;
        const half = axis === 0 ? b.hw : b.hh;
        if (Math.abs(d) < 1e-9) {
          if (Math.abs(o) > half) { tmin = Infinity; break; }
          continue;
        }
        let t1 = (-half - o) / d;
        let t2 = (half - o) / d;
        let sign = -1;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
        if (t1 > tmin) { tmin = t1; hitAxis = axis; hitSign = sign; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { tmin = Infinity; break; }
      }
      if (!isFinite(tmin) || tmin < 0 || tmin > maxDist) continue;
      if (best && tmin >= best.dist) continue;
      let nx = 0, ny = 0;
      if (hitAxis === 0) { nx = hitSign * c; ny = hitSign * s; }
      else if (hitAxis === 1) { nx = -hitSign * s; ny = hitSign * c; }
      else { nx = 0; ny = 1; }
      best = { dist: tmin, nx, ny, body: b, x: ox + dx * tmin, y: oy + dy * tmin };
    }
    return best;
  }

  return {
    bodies, dynamics, statics,
    add, clear, step, raycast,
    applyForce, applyImpulse, velocityAt, toLocal, corners,
    get contacts() { return contactLog; },
    gravity,
  };
}
