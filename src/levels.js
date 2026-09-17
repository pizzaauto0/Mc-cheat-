// Eigene Level fuer den Parcours-Modus.
// Alle Bausteine werden ueber ihre Oberflaechen-Endpunkte definiert, damit
// Rampen und Plattformen exakt aneinander anschliessen (siehe
// tools/check-levels.mjs, das genau das nachprueft).
//
// Koordinaten in Metern, y zeigt nach oben. Das Fahrzeug ist 2,8 m lang und
// hat 1,39 m vom Schwerpunkt bis zum Radaufstandspunkt.

/** Erdboden mit Grasdecke: Oberkante bei topY, von x0 bis x1. */
const ground = (x0, x1, topY, depth = 2.2) =>
  ({ t: "ground", x: (x0 + x1) / 2, y: topY - depth / 2, w: x1 - x0, h: depth });

/** Holzplattform (duenn). */
const plank = (x0, x1, topY, h = 0.5) =>
  ({ t: "plank", x: (x0 + x1) / 2, y: topY - h / 2, w: x1 - x0, h });

/** Rampe ueber ihre Oberflaechen-Endpunkte A -> B. */
function ramp(x0, y0, x1, y1, h = 0.55) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;             // Flaechennormale
  return {
    t: "ramp",
    x: (x0 + x1) / 2 - nx * (h / 2),
    y: (y0 + y1) / 2 - ny * (h / 2),
    w: len, h,
    a: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

const wall = (x, topY, w, h) => ({ t: "wall", x, y: topY - h / 2, w, h });
const crate = (x, groundTop, size = 1.3, mass = 45, level = 0) =>
  ({ t: "crate", x, y: groundTop + size / 2 + size * level, w: size, h: size, mass });
/**
 * Wippe: dreht sich um ihren Mittelpunkt. `tilt` ist die Startneigung in Grad
 * (positiv = das linke Ende liegt unten, damit man auffahren kann).
 */
const seesaw = (x, y, w = 22, mass = 150, tilt = 0) =>
  ({ t: "seesaw", x, y, w, h: 0.45, mass, a: tilt });
const boulder = (x, groundTop, size = 2.2, mass = 340) =>
  ({ t: "boulder", x, y: groundTop + size / 2, w: size, h: size, mass });

export const LEVELS = [
  {
    name: "Aufwärmen",
    hint: "Pfeil rechts gibt Gas, Pfeil links fährt rückwärts. Nicht überschlagen!",
    start: { x: 8, y: 2.2 }, finish: { x: 62, y: 0.6 }, killY: -18,
    bodies: [ground(-4, 32, 1), ramp(30, 1, 40, 2.6), ground(44, 74, 0.6)],
  },
  {
    name: "Erste Lücke",
    hint: "Voll aufs Gas und flach landen — Anlauf ist alles.",
    start: { x: 6, y: 2.2 }, finish: { x: 72, y: -0.4 }, killY: -20,
    bodies: [ground(-4, 32, 1), ramp(28, 1, 38, 4.2), ground(44, 80, -0.4)],
  },
  {
    name: "Die Wippe",
    hint: "Ruhig auf die Wippe rollen, warten bis sie kippt, dann rüber.",
    start: { x: 6, y: 2.2 }, finish: { x: 76, y: 1 }, killY: -20,
    bodies: [
      ground(-4, 30.2, 1), seesaw(40, 2.4, 22, 170, 8.5), ground(51.5, 84, 1),
    ],
  },
  {
    name: "Treppab",
    hint: "Kurz vor jeder Kante antippen — sonst kippt die Schnauze nach vorn.",
    start: { x: 8, y: 3.2 }, finish: { x: 80, y: -4.2 }, killY: -26,
    bodies: [
      ground(-4, 26, 2), plank(28, 36, 0.8), plank(38, 46, -0.5),
      plank(48, 56, -1.8), plank(58, 66, -3.1), ground(67, 92, -4.2),
    ],
  },
  {
    name: "Kistenlager",
    hint: "Kisten kannst du wegrammen — mit Anlauf und ohne abzuheben.",
    start: { x: 6, y: 2.2 }, finish: { x: 90, y: 0.4 }, killY: -20,
    bodies: [
      ground(-4, 58, 1),
      crate(22, 1, 1.15, 18), crate(23.4, 1, 1.15, 18), crate(22.7, 1, 1.15, 18, 1),
      crate(31, 1, 1.25, 26), crate(34.5, 1, 1.25, 26),
      ramp(56, 1, 64, 3.2), ground(67, 98, 0.4),
    ],
  },
  {
    name: "Steilhang",
    hint: "Mit Schwung den Berg hoch, oben sofort vom Gas.",
    start: { x: 6, y: 2.2 }, finish: { x: 86, y: 2 }, killY: -22,
    bodies: [
      ground(-4, 34, 1), ramp(33, 1, 47, 8), ground(46, 62, 8),
      ramp(62, 8, 74, 2), ground(73, 98, 2),
    ],
  },
  {
    name: "Doppelschanze",
    hint: "In der Luft: Gas hebt die Nase, Rückwärts senkt sie.",
    start: { x: 6, y: 2.2 }, finish: { x: 100, y: 0.4 }, killY: -24,
    bodies: [
      ground(-4, 32, 1), ramp(28, 1, 38, 4),
      ground(42.5, 66, 2.4), ramp(66, 2.4, 74.5, 5.2),
      ground(78.5, 112, 0.4),
    ],
  },
  {
    name: "Hängebrücke",
    hint: "Gleichmäßig Gas halten und die Bohlen mittig treffen.",
    start: { x: 6, y: 2.2 }, finish: { x: 96, y: 1 }, killY: -24,
    bodies: [
      ground(-4, 27, 1),
      plank(28, 36, 0.8), plank(37.8, 45.8, 0.8), plank(47.6, 55.6, 0.8),
      plank(57.4, 65.4, 0.8), plank(67.2, 75.2, 0.8),
      ground(77, 105, 1),
    ],
  },
  {
    name: "Rückwärts",
    hint: "Vorwärts ist Schluss: rückwärts die Stufen hinunter zum Ziel.",
    start: { x: 10, y: 3.2 }, finish: { x: -24, y: -2 }, killY: -22,
    bodies: [
      ground(0, 26, 2), wall(27.5, 9, 2, 8),
      plank(-8, -0.5, 0.6), plank(-16, -8.5, -0.8),
      ground(-32, -16, -2),
    ],
  },
  {
    name: "Finale",
    hint: "Schanze, Wippe, Kisten, Steilstück — und vor dem Scheitel vom Gas.",
    start: { x: 6, y: 2.2 }, finish: { x: 158, y: 3 }, killY: -26,
    bodies: [
      ground(-4, 32, 1), ramp(28, 1, 38, 4),
      ground(42.5, 58.4, 1), seesaw(68, 2.4, 20, 170, 8.1), ground(77.5, 97, 1),
      crate(83, 1, 1.15, 20), crate(84.4, 1, 1.15, 20), crate(83.7, 1, 1.15, 20, 1),
      ramp(96, 1, 116, 5.4), ramp(115.5, 5.3, 124, 6.2), ground(122, 134, 6.2),
      ramp(131, 6.2, 142, 3), ground(140, 170, 3),
    ],
  },
];

export function levelCount() { return LEVELS.length; }
