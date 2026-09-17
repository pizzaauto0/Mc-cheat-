// Kamera-Rig mit mehreren Ansichten, Federung, Speed-FOV und Screenshake.
import * as THREE from "three";
import { clamp, damp, lerp, smoothstep } from "./util.js";

export const CAMERA_MODES = [
  { id: "chase", label: "Verfolger" },
  { id: "close", label: "Nah" },
  { id: "hood", label: "Cockpit" },
  { id: "orbit", label: "Kino" },
  { id: "top", label: "Vogel" },
];

export function createCameraRig(camera, world) {
  let modeIndex = 0;
  let shake = 0;
  let orbitAngle = 0;
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const target = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let initialized = false;
  let baseFov = 62;

  function currentMode() { return CAMERA_MODES[modeIndex]; }

  function update(dt, car) {
    const mode = currentMode().id;
    const speed = car.speed;
    const speedT = smoothstep(0, car.spec.topSpeed, speed);
    const s = Math.sin(car.yaw), c = Math.cos(car.yaw);
    const fwd = tmp.set(s, 0, c);

    if (mode === "hood") {
      const b = car.spec.body;
      desired.copy(car.pos)
        .add(new THREE.Vector3(0, b.ride + b.h + b.cabin * 0.55, b.l * 0.06));
      target.copy(car.pos).addScaledVector(fwd, 26).add(new THREE.Vector3(0, 1.4, 0));
      pos.copy(desired);
      look.lerp(target, 1 - Math.exp(-14 * dt));
      baseFov = lerp(70, 84, speedT);
    } else if (mode === "top") {
      desired.copy(car.pos).add(new THREE.Vector3(0, 46 + speedT * 22, 0)).addScaledVector(fwd, 6);
      target.copy(car.pos).addScaledVector(fwd, 14);
      pos.lerp(desired, 1 - Math.exp(-6 * dt));
      look.lerp(target, 1 - Math.exp(-6 * dt));
      baseFov = 58;
    } else if (mode === "orbit") {
      orbitAngle += dt * 0.32;
      const r = 13 + speedT * 8;
      desired.copy(car.pos).add(new THREE.Vector3(Math.sin(orbitAngle) * r, 4.6 + Math.sin(orbitAngle * 0.6) * 1.4, Math.cos(orbitAngle) * r));
      target.copy(car.pos).add(new THREE.Vector3(0, 1.1, 0));
      pos.lerp(desired, 1 - Math.exp(-5 * dt));
      look.lerp(target, 1 - Math.exp(-7 * dt));
      baseFov = 52;
    } else {
      const close = mode === "close";
      const dist = (close ? 6.0 : 8.4) + speedT * (close ? 1.6 : 3.4) + (car.nitroActive ? 1.2 : 0);
      const height = (close ? 2.2 : 3.3) + speedT * 0.8;
      // im Drift leicht nach aussen versetzen -> sieht nach Motorsport aus
      const driftOffset = clamp(car.vLat * 0.14, -3.2, 3.2) * (car.drifting ? 1 : 0.35);
      const right = new THREE.Vector3(c, 0, -s);
      desired.copy(car.pos)
        .addScaledVector(fwd, -dist)
        .addScaledVector(right, driftOffset)
        .add(new THREE.Vector3(0, height, 0));
      // nicht in den Boden schneiden
      const groundY = world.heightAt(desired.x, desired.z) + 1.6;
      if (desired.y < groundY) desired.y = groundY;
      const lag = car.grounded ? (close ? 7.5 : 5.2) : 3.4;
      pos.lerp(desired, 1 - Math.exp(-lag * dt));
      target.copy(car.pos)
        .addScaledVector(fwd, 7 + speedT * 12)
        .add(new THREE.Vector3(0, 1.5, 0));
      look.lerp(target, 1 - Math.exp(-8 * dt));
      baseFov = lerp(60, 78, speedT) + (car.nitroActive ? 5 : 0);
    }

    if (!initialized) { pos.copy(desired); look.copy(target); initialized = true; }

    // Kamera nicht in Waenden stecken lassen
    if (mode !== "hood") {
      const hit = world.resolveCircle(pos.x, pos.z, 1.7, pos.y - 1.2);
      if (hit.hit) {
        pos.x += hit.nx * (hit.depth + 0.2);
        pos.z += hit.nz * (hit.depth + 0.2);
      }
      const ground = world.heightAt(pos.x, pos.z) + 1.2;
      if (pos.y < ground) pos.y = ground;
    }

    // Screenshake
    shake = Math.max(0, shake - dt * 2.2);
    const sh = shake * shake;
    camera.position.copy(pos);
    if (sh > 0.0001) {
      camera.position.x += (Math.random() - 0.5) * sh * 1.6;
      camera.position.y += (Math.random() - 0.5) * sh * 1.2;
      camera.position.z += (Math.random() - 0.5) * sh * 1.6;
    }
    camera.lookAt(look);
    if (mode !== "top") camera.rotateZ(clamp(-car.yawRate * 0.035 + car.roll * 0.35, -0.12, 0.12));

    const targetFov = baseFov;
    camera.fov = damp(camera.fov, targetFov, 4, dt);
    camera.updateProjectionMatrix();
  }

  return {
    update,
    addShake(v) { shake = clamp(shake + v, 0, 1.6); },
    next() { modeIndex = (modeIndex + 1) % CAMERA_MODES.length; initialized = false; return currentMode(); },
    setMode(id) {
      const i = CAMERA_MODES.findIndex((m) => m.id === id);
      if (i >= 0) { modeIndex = i; initialized = false; }
    },
    get mode() { return currentMode(); },
    reset() { initialized = false; },
  };
}
