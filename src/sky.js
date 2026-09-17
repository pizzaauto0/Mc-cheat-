// Himmel, Licht, Nebel, Wolken, Sterne -- plus Tageszeit-Umschaltung.
import * as THREE from "three";
import { skyTexture, cloudTexture, blobTexture } from "./textures.js";
import { rng, lerp } from "./util.js";

const PRESETS = {
  day: {
    label: "Tag",
    sky: ["#3f7fd6", "#a9d4ef", "#c9d8cf"],
    fog: 0x9fc3e0, fogDensity: 0.00085,
    sun: { color: 0xfff4e0, intensity: 2.3, dir: [-0.5, 0.78, 0.36] },
    hemi: { sky: 0xbcd8ff, ground: 0x4a5a3a, intensity: 1.1 },
    ambient: 0.2, clouds: 0.85, stars: 0, night: false, exposure: 0.98,
  },
  dusk: {
    label: "Abend",
    sky: ["#1d2b57", "#ff9a5c", "#4b3a44"],
    fog: 0xd48a5f, fogDensity: 0.0012,
    sun: { color: 0xffa763, intensity: 1.9, dir: [-0.92, 0.2, 0.18] },
    hemi: { sky: 0xffb07a, ground: 0x2c2a33, intensity: 0.75 },
    ambient: 0.2, clouds: 0.7, stars: 0.35, night: false, exposure: 1.0,
  },
  night: {
    label: "Nacht",
    sky: ["#04060f", "#0b1730", "#06080f"],
    fog: 0x070b16, fogDensity: 0.0019,
    sun: { color: 0x8fb4ff, intensity: 0.32, dir: [0.4, 0.7, -0.5] },
    hemi: { sky: 0x2a3c66, ground: 0x0a0d14, intensity: 0.32 },
    ambient: 0.14, clouds: 0.18, stars: 1, night: true, exposure: 1.18,
  },
};

const ORDER = ["day", "dusk", "night"];

export function createSky(scene, renderer, opts = {}) {
  const shadowSpan = opts.shadowSpan ?? 110;
  const skyTextures = {};
  for (const key of ORDER) {
    const p = PRESETS[key];
    skyTextures[key] = skyTexture(p.sky[0], p.sky[1], p.sky[2]);
  }

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  sun.shadow.camera.left = -shadowSpan;
  sun.shadow.camera.right = shadowSpan;
  sun.shadow.camera.top = shadowSpan;
  sun.shadow.camera.bottom = -shadowSpan;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.9;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambient);

  // Sonnenscheibe
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: blobTexture("rgba(255,250,230,1)", "rgba(255,200,120,0)", 128),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sunSprite.scale.setScalar(260);
  scene.add(sunSprite);

  // Wolken
  const cloudGroup = new THREE.Group();
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTexture(), transparent: true, depthWrite: false, opacity: 0.85, side: THREE.DoubleSide,
  });
  const rand = rng(4711);
  for (let i = 0; i < 26; i++) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cloudMat);
    const scale = 220 + rand() * 340;
    plane.scale.set(scale, scale * 0.55, 1);
    plane.position.set((rand() * 2 - 1) * 1500, 230 + rand() * 180, (rand() * 2 - 1) * 1500);
    plane.rotation.x = -Math.PI / 2;
    plane.rotation.z = rand() * Math.PI;
    cloudGroup.add(plane);
  }
  scene.add(cloudGroup);

  // Sterne
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const u = rand() * Math.PI * 2;
    const v = rand() * 0.55 + 0.05;
    const r = 2400;
    starPos[i * 3] = Math.cos(u) * Math.cos(v) * r;
    starPos[i * 3 + 1] = Math.sin(v) * r;
    starPos[i * 3 + 2] = Math.sin(u) * Math.cos(v) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 9, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false,
  }));
  scene.add(stars);

  scene.fog = new THREE.FogExp2(0x9fc3e0, 0.00085);

  let currentKey = "day";
  let shadowsOn = true;

  function apply(key) {
    const p = PRESETS[key] ?? PRESETS.day;
    currentKey = key;
    scene.background = skyTextures[key];
    scene.fog.color.setHex(p.fog);
    scene.fog.density = p.fogDensity;
    sun.color.setHex(p.sun.color);
    sun.intensity = p.sun.intensity;
    hemi.color.setHex(p.hemi.sky);
    hemi.groundColor.setHex(p.hemi.ground);
    hemi.intensity = p.hemi.intensity;
    ambient.intensity = p.ambient;
    cloudMat.opacity = p.clouds;
    cloudGroup.visible = p.clouds > 0.05;
    stars.material.opacity = p.stars;
    stars.visible = p.stars > 0.02;
    sunSprite.visible = !p.night;
    sunSprite.material.opacity = p.night ? 0 : 1;
    renderer.toneMappingExposure = p.exposure;
    sun.castShadow = shadowsOn && p.sun.intensity > 0.6;
    return p;
  }

  const dirVec = new THREE.Vector3();
  function update(dt, focus) {
    const p = PRESETS[currentKey];
    dirVec.set(...p.sun.dir).normalize();
    sun.position.copy(focus).addScaledVector(dirVec, 190);
    sun.target.position.copy(focus);
    sun.target.updateMatrixWorld();
    sunSprite.position.copy(focus).addScaledVector(dirVec, 1900);
    cloudGroup.position.x = focus.x;
    cloudGroup.position.z = focus.z;
    cloudGroup.rotation.y += dt * 0.004;
    stars.position.set(focus.x, 0, focus.z);
  }

  return {
    update,
    apply,
    set(key) { return apply(key); },
    next() {
      const i = ORDER.indexOf(currentKey);
      return apply(ORDER[(i + 1) % ORDER.length]);
    },
    setShadows(on) {
      shadowsOn = on;
      sun.castShadow = on && PRESETS[currentKey].sun.intensity > 0.6;
    },
    get key() { return currentKey; },
    get isNight() { return !!PRESETS[currentKey].night; },
    get label() { return PRESETS[currentKey].label; },
    sun,
  };
}
