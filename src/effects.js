// Reifenspuren, Staub und Funken -- alles in festen Pools ohne Allokationen.
import * as THREE from "three";
import { clamp } from "./util.js";
import { blobTexture } from "./textures.js";

const MAX_MARKS = 2600;
const MAX_PARTICLES = 520;

const PARTICLE_VS = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (320.0 / max(-mv.z, 0.001));
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FS = `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  float a = tex.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export function createEffects(scene, world) {
  /* ---------------- Reifenspuren ---------------- */
  const markPositions = new Float32Array(MAX_MARKS * 6 * 3);
  const markColors = new Float32Array(MAX_MARKS * 6 * 4);
  const markGeo = new THREE.BufferGeometry();
  markGeo.setAttribute("position", new THREE.BufferAttribute(markPositions, 3));
  markGeo.setAttribute("color", new THREE.BufferAttribute(markColors, 4));
  markGeo.setDrawRange(0, 0);
  const markMesh = new THREE.Mesh(
    markGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  markMesh.frustumCulled = false;
  markMesh.renderOrder = 1;
  markMesh.name = "skidmarks";
  scene.add(markMesh);

  let markCursor = 0;
  let markCount = 0;
  const lastWheel = [];

  function pushMark(ax, ay, az, bx, by, bz, nx, nz, halfW, alpha, dark) {
    const base = markCursor * 18;
    const p = markPositions;
    const ox = nx * halfW, oz = nz * halfW;
    // Zwei Dreiecke von A nach B
    const verts = [
      ax + ox, ay, az + oz, ax - ox, ay, az - oz, bx + ox, by, bz + oz,
      ax - ox, ay, az - oz, bx - ox, by, bz - oz, bx + ox, by, bz + oz,
    ];
    for (let i = 0; i < 18; i++) p[base + i] = verts[i];
    const cbase = markCursor * 24;
    for (let i = 0; i < 6; i++) {
      markColors[cbase + i * 4] = dark;
      markColors[cbase + i * 4 + 1] = dark;
      markColors[cbase + i * 4 + 2] = dark;
      markColors[cbase + i * 4 + 3] = alpha;
    }
    markCursor = (markCursor + 1) % MAX_MARKS;
    markCount = Math.min(markCount + 1, MAX_MARKS);
    markGeo.attributes.position.needsUpdate = true;
    markGeo.attributes.color.needsUpdate = true;
    markGeo.setDrawRange(0, markCount * 6);
  }

  /**
   * Spur fuer ein Rad ziehen.
   * @param {number} idx Radindex
   * @param {number} intensity 0..1 (0 = keine Spur)
   */
  function wheelTrail(idx, x, y, z, halfW, intensity, colorDark = 0.06) {
    const last = lastWheel[idx];
    if (intensity <= 0.05) { lastWheel[idx] = null; return; }
    if (!last) { lastWheel[idx] = { x, y, z }; return; }
    const dx = x - last.x, dz = z - last.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) return;
    const nx = -dz / d, nz = dx / d;
    pushMark(last.x, last.y + 0.03, last.z, x, y + 0.03, z, nx, nz, halfW, clamp(intensity, 0, 1) * 0.72, colorDark);
    lastWheel[idx] = { x, y, z };
  }

  /* ---------------- Partikel ---------------- */
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pSize = new Float32Array(MAX_PARTICLES);
  const pAlpha = new Float32Array(MAX_PARTICLES);
  const pColor = new Float32Array(MAX_PARTICLES * 3);
  const pVel = new Float32Array(MAX_PARTICLES * 3);
  const pLife = new Float32Array(MAX_PARTICLES);
  const pMaxLife = new Float32Array(MAX_PARTICLES);
  for (let i = 0; i < MAX_PARTICLES; i++) pPos[i * 3 + 1] = -9999;

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("aSize", new THREE.BufferAttribute(pSize, 1));
  pGeo.setAttribute("aAlpha", new THREE.BufferAttribute(pAlpha, 1));
  pGeo.setAttribute("aColor", new THREE.BufferAttribute(pColor, 3));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: blobTexture("rgba(255,255,255,.95)", "rgba(255,255,255,0)", 64) } },
    vertexShader: PARTICLE_VS,
    fragmentShader: PARTICLE_FS,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  points.name = "particles";
  scene.add(points);

  let pCursor = 0;
  function spawn(x, y, z, vx, vy, vz, size, life, r, g, b) {
    const i = pCursor;
    pCursor = (pCursor + 1) % MAX_PARTICLES;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    pSize[i] = size;
    pLife[i] = life; pMaxLife[i] = life;
    pAlpha[i] = 1;
    pColor[i * 3] = r; pColor[i * 3 + 1] = g; pColor[i * 3 + 2] = b;
  }

  let dustBudget = 0;
  function emitDust(x, y, z, amount, tint = 0) {
    dustBudget += amount;
    while (dustBudget >= 1) {
      dustBudget -= 1;
      const ang = Math.random() * Math.PI * 2;
      const shade = 0.55 + Math.random() * 0.3;
      spawn(
        x + (Math.random() - 0.5) * 0.8, y + 0.15, z + (Math.random() - 0.5) * 0.8,
        Math.cos(ang) * 1.6, 1.1 + Math.random() * 1.6, Math.sin(ang) * 1.6,
        1.5 + Math.random() * 2.2, 0.55 + Math.random() * 0.5,
        shade, shade * (tint ? 0.82 : 0.9), shade * (tint ? 0.6 : 0.86)
      );
    }
  }

  function emitSparks(x, y, z, strength) {
    const n = clamp(Math.round(strength * 1.2), 1, 14);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * strength * 0.7;
      spawn(x, y, z, Math.cos(ang) * sp, 1.5 + Math.random() * 3, Math.sin(ang) * sp,
        0.7 + Math.random() * 0.8, 0.28 + Math.random() * 0.25, 1, 0.75, 0.25);
    }
  }

  function emitNitro(x, y, z) {
    spawn(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 1.2, 0.6 + Math.random(), (Math.random() - 0.5) * 1.2,
      1.4 + Math.random() * 1.2, 0.26, 0.4, 0.85, 1);
  }

  function update(dt) {
    let alive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (pLife[i] <= 0) continue;
      alive = true;
      pLife[i] -= dt;
      if (pLife[i] <= 0) { pPos[i * 3 + 1] = -9999; pAlpha[i] = 0; continue; }
      pVel[i * 3 + 1] -= 6 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      pVel[i * 3] *= 1 - 1.4 * dt;
      pVel[i * 3 + 2] *= 1 - 1.4 * dt;
      pAlpha[i] = clamp(pLife[i] / pMaxLife[i], 0, 1) * 0.8;
      pSize[i] += dt * 1.6;
    }
    if (alive) {
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.aAlpha.needsUpdate = true;
      pGeo.attributes.aSize.needsUpdate = true;
      pGeo.attributes.aColor.needsUpdate = true;
    }
  }

  function clearMarks() {
    markCount = 0; markCursor = 0;
    markGeo.setDrawRange(0, 0);
    for (let i = 0; i < lastWheel.length; i++) lastWheel[i] = null;
  }

  return { wheelTrail, emitDust, emitSparks, emitNitro, update, clearMarks, markMesh, points };
}
