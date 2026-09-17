// Tastatur, Gamepad und Touch in einen gemeinsamen Eingabezustand.
import { clamp } from "./util.js";

const KEY_ACTIONS = {
  KeyW: "up", ArrowUp: "up",
  KeyS: "down", ArrowDown: "down",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "handbrake",
  ShiftLeft: "nitro", ShiftRight: "nitro",
};

const ONE_SHOT = {
  KeyC: "camera", KeyR: "reset", KeyT: "daytime", KeyM: "mute",
  KeyF: "fullscreen", Escape: "pause", KeyP: "pause", KeyH: "help",
};

export function createInput(target = window) {
  const held = new Set();
  const touch = new Set();
  const listeners = new Map();
  const state = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, any: false };
  let enabled = true;

  function fire(action) {
    const fns = listeners.get(action);
    if (fns) for (const fn of fns) fn();
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    const act = KEY_ACTIONS[e.code];
    if (act) { held.add(act); e.preventDefault(); }
    const shot = ONE_SHOT[e.code];
    if (shot) { fire(shot); e.preventDefault(); }
  }
  function onKeyUp(e) {
    const act = KEY_ACTIONS[e.code];
    if (act) { held.delete(act); e.preventDefault(); }
  }
  function onBlur() { held.clear(); touch.clear(); }

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);

  // Touch-Buttons
  function bindTouch(root) {
    root.querySelectorAll("[data-key]").forEach((btn) => {
      const key = btn.dataset.key;
      const down = (e) => { e.preventDefault(); touch.add(key); btn.classList.add("on"); };
      const up = (e) => { e.preventDefault(); touch.delete(key); btn.classList.remove("on"); };
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("pointerleave", up);
    });
  }

  function gamepadRead() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (pad && pad.connected) return pad;
    }
    return null;
  }

  function read() {
    if (!enabled) { state.throttle = state.brake = state.steer = 0; state.handbrake = state.nitro = false; return state; }
    let throttle = (held.has("up") || touch.has("throttle")) ? 1 : 0;
    let brake = (held.has("down") || touch.has("brake")) ? 1 : 0;
    let steer = 0;
    if (held.has("left") || touch.has("left")) steer -= 1;
    if (held.has("right") || touch.has("right")) steer += 1;
    let handbrake = held.has("handbrake") || touch.has("handbrake");
    let nitro = held.has("nitro") || touch.has("nitro");

    const pad = gamepadRead();
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) steer = clamp(steer + ax, -1, 1);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (pad.buttons[0]?.pressed) throttle = 1;
      if (pad.buttons[1]?.pressed) handbrake = true;
      if (pad.buttons[2]?.pressed) nitro = true;
    }

    state.throttle = throttle;
    state.brake = brake;
    state.steer = clamp(steer, -1, 1);
    state.handbrake = handbrake;
    state.nitro = nitro;
    state.any = throttle > 0 || brake > 0 || steer !== 0 || handbrake || nitro;
    return state;
  }

  return {
    read,
    bindTouch,
    on(action, fn) {
      if (!listeners.has(action)) listeners.set(action, []);
      listeners.get(action).push(fn);
    },
    setEnabled(v) { enabled = v; if (!v) held.clear(); },
    clear: onBlur,
    dispose() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
