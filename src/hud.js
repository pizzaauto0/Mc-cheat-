// HUD: Tacho (Canvas), Minimap (Canvas, statische Ebene vorgerendert), DOM-Anzeigen.
import { clamp, lerp, toKmh, formatNumber } from "./util.js";

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    hud: $("hud"), modeName: $("modeName"), modeLine: $("modeLine"), modeSub: $("modeSub"),
    scoreValue: $("scoreValue"), bestValue: $("bestValue"), scorePanel: $("scorePanel"),
    driftFloat: $("driftFloat"), driftPoints: $("driftPoints"), driftLabel: $("driftLabel"), driftMult: $("driftMult"),
    targetArrow: $("targetArrow"), targetDist: $("targetDist"),
    nitroFill: $("nitroFill"), kmh: $("kmh"), gear: $("gear"), hintRow: $("hintRow"),
    speedo: $("speedo"), minimap: $("minimap"), toast: $("toast"), touch: $("touchControls"),
  };

  const speedoCtx = el.speedo.getContext("2d");
  const mapCtx = el.minimap.getContext("2d");
  let mapStatic = null;
  let mapScale = 1;
  let toastTimer = 0;
  let shownSpeed = 0;
  let shownRpm = 0;

  /* --------------------------------- Tacho --------------------------------- */
  function drawSpeedo(car) {
    const c = speedoCtx;
    const W = el.speedo.width, H = el.speedo.height;
    const cx = W / 2, cy = H / 2, r = W * 0.42;
    const maxKmh = Math.ceil((toKmh(car.spec.topSpeed) * 1.12) / 20) * 20;
    const kmh = toKmh(car.speed);
    shownSpeed = lerp(shownSpeed, kmh, 0.25);
    shownRpm = lerp(shownRpm, car.rpm, 0.3);

    c.clearRect(0, 0, W, H);
    const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22;

    // Grundring
    c.lineWidth = 12;
    c.strokeStyle = "rgba(160,190,230,.16)";
    c.beginPath(); c.arc(cx, cy, r, a0, a1); c.stroke();

    // Geschwindigkeit
    const t = clamp(shownSpeed / maxKmh, 0, 1);
    const grad = c.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#36e0c8");
    grad.addColorStop(0.65, "#ffd166");
    grad.addColorStop(1, "#ff5f6d");
    c.strokeStyle = grad;
    c.lineCap = "round";
    c.beginPath(); c.arc(cx, cy, r, a0, a0 + (a1 - a0) * t); c.stroke();

    // Drehzahl (innen)
    c.lineWidth = 5;
    c.strokeStyle = shownRpm > 6500 ? "#ff5f6d" : "rgba(110,200,255,.7)";
    c.beginPath(); c.arc(cx, cy, r - 13, a0, a0 + (a1 - a0) * clamp((shownRpm - 800) / 6800, 0, 1)); c.stroke();

    // Skala
    c.lineWidth = 2;
    c.strokeStyle = "rgba(220,235,255,.55)";
    c.font = "600 11px Inter, system-ui, sans-serif";
    c.fillStyle = "rgba(220,235,255,.65)";
    c.textAlign = "center"; c.textBaseline = "middle";
    for (let v = 0; v <= maxKmh; v += 20) {
      const ang = a0 + (a1 - a0) * (v / maxKmh);
      const big = v % 60 === 0;
      const r1 = r - (big ? 22 : 18), r2 = r - 26;
      c.beginPath();
      c.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      c.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      c.stroke();
      if (big) {
        const rt = r - 40;
        c.fillText(String(v), cx + Math.cos(ang) * rt, cy + Math.sin(ang) * rt);
      }
    }

    // Nadel
    const ang = a0 + (a1 - a0) * t;
    c.strokeStyle = "#ff5f6d";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx - Math.cos(ang) * 10, cy - Math.sin(ang) * 10);
    c.lineTo(cx + Math.cos(ang) * (r - 8), cy + Math.sin(ang) * (r - 8));
    c.stroke();
    c.fillStyle = "#0a0d14";
    c.beginPath(); c.arc(cx, cy, 6, 0, Math.PI * 2); c.fill();
  }

  /* -------------------------------- Minimap -------------------------------- */
  function buildMapStatic(world) {
    const size = el.minimap.width;
    mapStatic = document.createElement("canvas");
    mapStatic.width = size; mapStatic.height = size;
    const g = mapStatic.getContext("2d");
    const half = world.minimap.half;
    mapScale = size / (half * 2);
    const px = (x) => (x + half) * mapScale;
    const pz = (z) => (z + half) * mapScale;

    g.fillStyle = "#0e1a12";
    g.fillRect(0, 0, size, size);

    // Stadt / Flaechen
    const city = world.minimap.city;
    g.fillStyle = "rgba(120,140,170,.16)";
    g.fillRect(px(city.x - city.hx), pz(city.z - city.hz), city.hx * 2 * mapScale, city.hz * 2 * mapScale);
    const park = world.minimap.park;
    g.fillStyle = "rgba(150,160,175,.22)";
    g.fillRect(px(park.x - park.hx), pz(park.z - park.hz), park.hx * 2 * mapScale, park.hz * 2 * mapScale);
    const pad = world.minimap.skidpad;
    g.beginPath();
    g.arc(px(pad.x), pz(pad.z), pad.r * mapScale, 0, Math.PI * 2);
    g.fill();

    for (const road of world.minimap.roads) {
      g.beginPath();
      const pts = road.points;
      g.moveTo(px(pts[0].x), pz(pts[0].z));
      for (let i = 1; i < pts.length; i++) g.lineTo(px(pts[i].x), pz(pts[i].z));
      if (road.closed) g.closePath();
      g.strokeStyle = road.kind === "dirt" ? "rgba(180,150,100,.6)" : road.kind === "highway" ? "rgba(235,242,252,.75)" : "rgba(200,212,228,.55)";
      g.lineWidth = Math.max(1.2, road.width * mapScale * 0.8);
      g.lineJoin = "round";
      g.stroke();
    }
  }

  function drawMinimap(world, car, traffic, checkpoints, nextIdx) {
    if (!mapStatic) buildMapStatic(world);
    const size = el.minimap.width;
    const half = world.minimap.half;
    const px = (x) => (x + half) * mapScale;
    const pz = (z) => (z + half) * mapScale;
    const g = mapCtx;
    g.clearRect(0, 0, size, size);
    g.drawImage(mapStatic, 0, 0);

    if (traffic) {
      g.fillStyle = "rgba(255,255,255,.5)";
      for (const t of traffic.cars) {
        g.fillRect(px(t.x) - 1.2, pz(t.z) - 1.2, 2.4, 2.4);
      }
    }

    if (checkpoints && checkpoints.length) {
      checkpoints.forEach((cp, i) => {
        const active = i === nextIdx;
        g.fillStyle = active ? "#36e0c8" : i < nextIdx ? "rgba(54,224,200,.25)" : "rgba(255,209,102,.55)";
        g.beginPath();
        g.arc(px(cp.x), pz(cp.z), active ? 4 : 2.4, 0, Math.PI * 2);
        g.fill();
      });
    }

    // Spielerpfeil
    const x = px(car.pos.x), y = pz(car.pos.z);
    g.save();
    g.translate(x, y);
    g.rotate(-car.yaw + Math.PI);
    g.fillStyle = "#ff5f6d";
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6);
    g.closePath();
    g.fill();
    g.restore();
  }

  /* ---------------------------------- DOM ---------------------------------- */
  function update(dt, state) {
    const { car, world, traffic, display } = state;
    el.kmh.textContent = String(Math.round(toKmh(car.speed)));
    el.gear.textContent = car.gear < 0 ? "R" : car.speed < 0.6 && car.throttleSmooth < 0.05 ? "N" : String(car.gear);
    el.nitroFill.style.transform = `scaleX(${(car.nitro / car.spec.nitroTank).toFixed(3)})`;
    el.nitroFill.style.filter = car.nitroActive ? "brightness(1.6)" : "none";

    if (display) {
      el.modeName.textContent = display.title ?? "";
      el.modeLine.textContent = display.main ?? "";
      el.modeSub.textContent = display.sub ?? "";
      if (display.score === null || display.score === undefined) {
        el.scorePanel.classList.add("hidden");
      } else {
        el.scorePanel.classList.remove("hidden");
        el.scoreValue.textContent = typeof display.score === "number" ? formatNumber(display.score) : display.score;
        el.bestValue.textContent = display.best ?? "—";
      }

      // Drift-Anzeige
      const drift = display.drift;
      if (drift && drift.active) {
        el.driftFloat.classList.add("on");
        el.driftPoints.textContent = formatNumber(drift.points);
        el.driftMult.textContent = `x${drift.mult.toFixed(1)}`;
        el.driftLabel.textContent = drift.label ?? "DRIFT";
      } else {
        el.driftFloat.classList.remove("on");
      }

      // Zielpfeil
      if (display.target) {
        el.targetArrow.classList.remove("hidden");
        const dx = display.target.x - car.pos.x;
        const dz = display.target.z - car.pos.z;
        const dist = Math.hypot(dx, dz);
        const rel = Math.atan2(dx, dz) - car.yaw;
        el.targetArrow.firstElementChild.style.transform = `rotate(${(rel * 180 / Math.PI).toFixed(1)}deg)`;
        el.targetDist.textContent = `${Math.round(dist)} m`;
      } else {
        el.targetArrow.classList.add("hidden");
      }
    }

    drawSpeedo(car);
    if (el.minimap.offsetParent !== null) {
      drawMinimap(world, car, traffic, display?.checkpoints, display?.nextCheckpoint ?? -1);
    }

    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) el.toast.classList.remove("on");
    }
  }

  function toast(text, seconds = 2) {
    el.toast.textContent = text;
    el.toast.classList.add("on");
    toastTimer = seconds;
  }

  return {
    update, toast, drawSpeedo, drawMinimap,
    show() { el.hud.classList.remove("hidden"); },
    hide() { el.hud.classList.add("hidden"); },
    setHint(text) { el.hintRow.textContent = text; },
    invalidateMap() { mapStatic = null; },
    el,
  };
}
