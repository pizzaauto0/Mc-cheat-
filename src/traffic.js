// Einfacher KI-Verkehr: Autos folgen geschlossenen Routen, bremsen voreinander
// und werden bei einem Treffer weggeschleudert.
import * as THREE from "three";
import { clamp, rng, resamplePath, TAU } from "./util.js";
import { buildCarMesh, VEHICLES } from "./vehicle.js";

const COLORS = [0xd8dde6, 0x2b3a4a, 0xc8412f, 0x2f6fb0, 0xe0b23c, 0x3f7d52, 0x8a8f98];

export function createTraffic(scene, world, opts = {}) {
  const count = opts.count ?? 14;
  const rand = rng(opts.seed ?? 8823);
  const routes = [];

  // Ringautobahn
  const ring = world.roads.find((r) => r.kind === "highway");
  if (ring) routes.push({ points: ring.points, lane: ring.width * 0.24, speed: 26 });

  // Zwei Stadtrunden auf dem Strassenraster
  const s = world.streets;
  const innerLoop = resamplePath([
    { x: s[1], z: s[1] }, { x: s[3], z: s[1] }, { x: s[3], z: s[3] }, { x: s[1], z: s[3] },
  ], 8, true);
  const outerLoop = resamplePath([
    { x: s[0], z: s[0] }, { x: s[4], z: s[0] }, { x: s[4], z: s[4] }, { x: s[0], z: s[4] },
  ], 10, true);
  routes.push({ points: innerLoop, lane: 4.4, speed: 13 });
  routes.push({ points: outerLoop, lane: 4.4, speed: 15 });

  const cars = [];
  const specPool = VEHICLES.map((v) => v);

  for (let i = 0; i < count; i++) {
    const route = routes[i % routes.length];
    const spec = { ...specPool[Math.floor(rand() * specPool.length)] };
    spec.color = COLORS[Math.floor(rand() * COLORS.length)];
    const { group } = buildCarMesh(spec, { simple: true });
    group.name = "traffic-" + i;
    scene.add(group);
    cars.push({
      route, mesh: group, spec,
      t: rand() * route.points.length,
      speed: route.speed * (0.82 + rand() * 0.3),
      baseSpeed: route.speed * (0.82 + rand() * 0.3),
      lane: route.lane * (rand() < 0.5 ? 1 : 1),
      spun: 0, vx: 0, vz: 0, yaw: 0, yawRate: 0,
      x: 0, z: 0, y: 0,
    });
  }

  const tmp = new THREE.Vector3();
  const euler = new THREE.Euler();

  function pathPoint(route, t) {
    const pts = route.points;
    const n = pts.length;
    const i0 = Math.floor(t) % n;
    const i1 = (i0 + 1) % n;
    const f = t - Math.floor(t);
    const a = pts[i0], b = pts[i1];
    const x = a.x + (b.x - a.x) * f;
    const z = a.z + (b.z - a.z) * f;
    const tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    return { x, z, tx: tx / len, tz: tz / len, segLen: len };
  }

  function update(dt, player) {
    for (const car of cars) {
      if (car.spun > 0) {
        // ausgeschleudert: frei ausrollen und dann zurueck auf die Route
        car.spun -= dt;
        car.vx *= 1 - 1.1 * dt;
        car.vz *= 1 - 1.1 * dt;
        car.x += car.vx * dt;
        car.z += car.vz * dt;
        car.yaw += car.yawRate * dt;
        car.yawRate *= 1 - 0.9 * dt;
        car.y = world.terrainHeightAt(car.x, car.z);
        car.mesh.position.set(car.x, car.y, car.z);
        euler.set(0, car.yaw, clamp(car.yawRate * 0.12, -0.3, 0.3), "YXZ");
        car.mesh.quaternion.setFromEuler(euler);
        if (car.spun <= 0) {
          const snap = world.snapToRoad(car.x, car.z, car.yaw);
          car.x = snap.x; car.z = snap.z; car.yaw = snap.yaw;
          car.speed = car.baseSpeed * 0.4;
        }
        continue;
      }

      const p = pathPoint(car.route, car.t);
      const nx = -p.tz, nz = p.tx;
      car.x = p.x + nx * car.lane;
      car.z = p.z + nz * car.lane;
      car.y = world.terrainHeightAt(car.x, car.z);
      car.yaw = Math.atan2(p.tx, p.tz);

      // Spieler direkt voraus? -> bremsen
      let targetSpeed = car.baseSpeed;
      if (player) {
        const dx = player.pos.x - car.x, dz = player.pos.z - car.z;
        const ahead = dx * p.tx + dz * p.tz;
        const side = Math.abs(dx * nx + dz * nz);
        const dist = Math.hypot(dx, dz);
        if (ahead > 0 && ahead < 26 && side < 5) targetSpeed = clamp(player.speed * 0.8, 2, car.baseSpeed);
        if (dist < 80) targetSpeed *= 1; // nah dran: nichts Besonderes, nur Bremslogik oben
      }
      car.speed += clamp(targetSpeed - car.speed, -18 * dt, 6 * dt);
      car.t += (car.speed * dt) / Math.max(p.segLen, 0.001);
      if (car.t >= car.route.points.length) car.t -= car.route.points.length;

      car.mesh.position.set(car.x, car.y, car.z);
      euler.set(0, car.yaw, 0, "YXZ");
      car.mesh.quaternion.setFromEuler(euler);
    }
  }

  /** Kollision Spieler <-> Verkehr. Gibt die Aufprallstaerke zurueck (0 = nichts). */
  function collide(player) {
    let impact = 0;
    const pr = Math.max(player.spec.body.w, player.spec.body.l * 0.5) * 0.5;
    for (const car of cars) {
      const cr = Math.max(car.spec.body.w, car.spec.body.l * 0.5) * 0.5;
      const dx = player.pos.x - car.x, dz = player.pos.z - car.z;
      const d = Math.hypot(dx, dz);
      const minD = pr + cr;
      if (d > minD || d < 1e-4) continue;
      if (player.pos.y - player.spec.body.ride > car.y + 1.6) continue; // drueber gesprungen
      const nx = dx / d, nz = dz / d;
      const pen = minD - d;
      player.pos.x += nx * pen * 0.7;
      player.pos.z += nz * pen * 0.7;
      const vn = player.vel.x * nx + player.vel.z * nz;
      if (vn < 0) {
        player.vel.x -= nx * vn * 1.25;
        player.vel.z -= nz * vn * 1.25;
        player.yawRate *= 0.7;
        impact = Math.max(impact, -vn);
      }
      car.spun = 2.6;
      car.vx = -nx * Math.max(6, Math.abs(vn) * 0.8) + player.vel.x * 0.35;
      car.vz = -nz * Math.max(6, Math.abs(vn) * 0.8) + player.vel.z * 0.35;
      car.yawRate = (Math.random() - 0.5) * 5;
    }
    return impact;
  }

  function setVisible(v) {
    for (const car of cars) car.mesh.visible = v;
  }

  function dispose() {
    for (const car of cars) scene.remove(car.mesh);
    cars.length = 0;
  }

  return { cars, update, collide, setVisible, dispose, tmp };
}
