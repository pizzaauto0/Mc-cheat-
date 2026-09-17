// Kompletter Sound per WebAudio synthetisiert: Motor, Reifen, Wind, Aufpralle.
// Keine Audiodateien -> nichts zu laden, nichts zu lizenzieren.
import { clamp, lerp } from "./util.js";

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let started = false;
  let volume = 0.7;
  const nodes = {};

  function noiseBuffer(seconds = 2) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;       // leicht rosa gefaerbt
      data[i] = last * 3.2;
    }
    return buf;
  }

  function start() {
    if (started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    started = true;

    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);

    // ---- Motor: drei Oszillatoren durch ein Tiefpassfilter
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0001;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 900;
    engineFilter.Q.value = 6;
    engineGain.connect(engineFilter).connect(master);

    const oscs = [];
    const shapes = [
      { type: "sawtooth", mul: 1, gain: 0.55 },
      { type: "square", mul: 0.5, gain: 0.3 },
      { type: "sawtooth", mul: 2.02, gain: 0.16 },
    ];
    for (const s of shapes) {
      const osc = ctx.createOscillator();
      osc.type = s.type;
      osc.frequency.value = 60;
      const g = ctx.createGain();
      g.gain.value = s.gain;
      osc.connect(g).connect(engineGain);
      osc.start();
      oscs.push({ osc, mul: s.mul });
    }
    nodes.engineGain = engineGain;
    nodes.engineFilter = engineFilter;
    nodes.oscs = oscs;

    // ---- Rauschquelle fuer Reifen / Wind / Nitro
    const nb = noiseBuffer();
    function noiseChain(filterType, freq, q) {
      const src = ctx.createBufferSource();
      src.buffer = nb;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      src.connect(f).connect(g).connect(master);
      src.start();
      return { src, filter: f, gain: g };
    }
    nodes.tire = noiseChain("bandpass", 1750, 1.1);
    nodes.wind = noiseChain("lowpass", 520, 0.7);
    nodes.nitro = noiseChain("highpass", 2400, 0.8);
    nodes.noise = nb;
  }

  function resume() {
    start();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  function setMuted(v) {
    muted = v;
    if (master) master.gain.value = v ? 0 : volume;
    return muted;
  }

  function setVolume(v) {
    volume = clamp(v, 0, 1);
    if (master && !muted) master.gain.value = volume;
  }

  function update(dt, car) {
    if (!ctx || !nodes.oscs) return;
    const t = ctx.currentTime;
    const rpmNorm = clamp((car.rpm - 850) / 6500, 0, 1);
    const base = 26 + rpmNorm * 132;                // Grundfrequenz Motor
    for (const o of nodes.oscs) {
      o.osc.frequency.setTargetAtTime(base * o.mul, t, 0.045);
    }
    const load = clamp(car.throttleSmooth * 0.8 + rpmNorm * 0.5, 0, 1);
    const engineVol = (0.035 + load * 0.075) * (car.nitroActive ? 1.35 : 1);
    nodes.engineGain.gain.setTargetAtTime(engineVol, t, 0.07);
    nodes.engineFilter.frequency.setTargetAtTime(520 + load * 3400 + rpmNorm * 1800, t, 0.09);

    const screech = clamp(car.events.screech, 0, 1);
    nodes.tire.gain.gain.setTargetAtTime(screech * 0.16, t, 0.05);
    nodes.tire.filter.frequency.setTargetAtTime(1300 + screech * 1400, t, 0.1);

    const windAmt = clamp(car.speed / 60, 0, 1);
    nodes.wind.gain.gain.setTargetAtTime(windAmt * windAmt * 0.11, t, 0.15);
    nodes.nitro.gain.gain.setTargetAtTime(car.nitroActive ? 0.085 : 0.0001, t, 0.08);
  }

  function burst({ freq = 90, decay = 0.28, gain = 0.4, noise = true, type = "sine" } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (noise && nodes.noise) {
      const src = ctx.createBufferSource();
      src.buffer = nodes.noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq * 6;
      f.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      src.connect(f).connect(g).connect(master);
      src.start(t);
      src.stop(t + decay + 0.05);
    }
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freq * 0.35, 25), t + decay);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(gain * 0.9, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g2).connect(master);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  function tone(freq, duration = 0.16, gain = 0.18, type = "triangle") {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  return {
    resume, setMuted, setVolume, update,
    get muted() { return muted; },
    get ready() { return !!ctx; },
    impact(strength) { burst({ freq: clamp(60 + strength * 6, 50, 240), decay: clamp(0.18 + strength * 0.02, 0.12, 0.5), gain: clamp(0.12 + strength * 0.03, 0.1, 0.55) }); },
    land(strength) { burst({ freq: 70, decay: 0.2, gain: clamp(0.1 + strength * 0.08, 0.08, 0.4) }); },
    coneHit() { burst({ freq: 340, decay: 0.12, gain: 0.12, type: "square" }); },
    checkpoint() { tone(880, 0.13, 0.16); setTimeout(() => tone(1320, 0.16, 0.14), 90); },
    fail() { tone(220, 0.3, 0.16, "sawtooth"); },
    success() { [660, 880, 1170].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.15), i * 110)); },
    click() { tone(520, 0.05, 0.08, "square"); },
    shift() { burst({ freq: 150, decay: 0.07, gain: 0.05 }); },
  };
}
