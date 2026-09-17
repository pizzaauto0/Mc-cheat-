/**
 * Prueft die Parcours-Level rein rechnerisch (ohne Browser): tastet das
 * Gelaendeprofil per Raycast ab und meldet Stufen, die kein Fahrzeug schafft,
 * sowie Startpositionen, die in der Luft oder im Boden haengen.
 *
 *   node tools/check-levels.mjs
 */
import { createPhysics, createBox } from "../src/phys2d.js";
import { LEVELS } from "../src/levels.js";

const CHASSIS_TO_CONTACT = 1.39;      // Abstand Schwerpunkt -> Radaufstandspunkt
const STEP_LIMIT = 1.6;               // groesste Stufe, die noch fahrbar ist
let problems = 0;

for (const [i, level] of LEVELS.entries()) {
  const P = createPhysics({});
  for (const def of level.bodies) {
    if (def.t === "crate" || def.t === "boulder") continue;       // dynamisch, egal
    P.add(createBox({
      x: def.x, y: def.y, w: def.w, h: def.h,
      angle: ((def.a ?? 0) * Math.PI) / 180,
      mass: def.t === "seesaw" ? def.mass : 0,
      pivot: def.t === "seesaw",
    }));
  }
  const x0 = Math.min(level.start.x, level.finish.x) - 4;
  const x1 = Math.max(level.start.x, level.finish.x) + 4;
  const profile = [];
  for (let x = x0; x <= x1; x += 0.5) {
    const hit = P.raycast(x, 40, 0, -1, 90);
    profile.push({ x, y: hit ? hit.y : null, seesaw: hit ? hit.body.pivot === true : false });
  }
  // Startpunkt
  const startHit = P.raycast(level.start.x, 40, 0, -1, 90);
  const startGround = startHit ? startHit.y : null;
  const clearance = startGround === null ? null : level.start.y - CHASSIS_TO_CONTACT - startGround;
  const startOk = clearance !== null && clearance > -0.3 && clearance < 1.2;
  // Ziel
  const finishHit = P.raycast(level.finish.x, 40, 0, -1, 90);
  const finishDy = finishHit ? level.finish.y - finishHit.y : null;

  // Stufen im Profil (nur wo beide Seiten Boden haben)
  const steps = [];
  for (let k = 1; k < profile.length; k++) {
    const a = profile[k - 1], b = profile[k];
    if (a.y === null || b.y === null) continue;
    if (a.seesaw || b.seesaw) continue;          // Wippen kippen ja gerade
    const d = b.y - a.y;
    if (Math.abs(d) > STEP_LIMIT) steps.push({ x: b.x, d: +d.toFixed(2) });
  }
  const gaps = [];
  let gapStart = null;
  for (const p of profile) {
    if (p.y === null && gapStart === null) gapStart = p.x;
    if (p.y !== null && gapStart !== null) { gaps.push(+(p.x - gapStart).toFixed(1)); gapStart = null; }
  }

  const flags = [];
  if (!startOk) flags.push(`Start haengt (Abstand ${clearance === null ? "kein Boden" : clearance.toFixed(2)} m)`);
  if (finishDy === null) flags.push("Ziel steht ueber dem Nichts");
  else if (Math.abs(finishDy) > 0.6) flags.push(`Zielflagge ${finishDy > 0 ? "schwebt" : "steckt"} (${finishDy.toFixed(2)} m)`);
  if (steps.length) flags.push(`Stufen: ${steps.map((s) => `${s.d} m @ x=${s.x}`).join(", ")}`);
  const bigGap = gaps.filter((g) => g > 9);
  if (bigGap.length) flags.push(`grosse Luecken: ${bigGap.join(", ")} m`);

  if (flags.length) problems++;
  console.log(`${flags.length ? "!" : "ok"} L${i + 1} ${level.name.padEnd(14)} Luecken [${gaps.join(", ")}] ${flags.length ? "-> " + flags.join(" | ") : ""}`);
}
console.log(problems ? `\n${problems} Level brauchen noch Feinschliff.` : "\nAlle Level plausibel.");
