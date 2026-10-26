import * as THREE from 'three';
import { C, AU, LY, PC, KPC, DAY, YEAR, G0, v3, dateToSim } from './constants.js';
import { planetPos, moonGeo, orbitalPeriod, ECLIPTIC_NORTH } from './astro.js';
import { PROBES, Mission, probeById } from './missions.js';
import { destById, RADIUS, PROXIMA, PROXIMA_PC, PROXIMA_B, GAIA_BH1, bh1CompanionPos, proximaBPos, GALAXIES } from './destinations.js';
import { REL, setObserverVelocity } from './shaders/common.js';
import { createPanorama, createStarfield } from './sky.js';
import { createGalaxies, updateGalaxy, M31_GROUP, GALAXY_SPLIT } from './galaxies.js';
import { Planet, Star, bbColorJS, texturesReady, preloadTextures } from './bodies.js';
import { loadTextureAsync, useRenderer } from './textures.js';
import { WorldLine } from './lines.js';
import { MoonSystem } from './moons.js';
import { ProbeModel } from './probes3d.js';
import { createComposer } from './postfx.js';
import { $, fmtDist, fmtTime, fmtDate } from './ui.js';
import { Tracker } from './tracker.js';
import { Menu } from './menu.js';
import { FactTicker } from './facts.js';
import { defaultFactor, rateText, stepRate, niceRate, niceUp, humanScale } from './timeflow.js';
import { Passbys } from './passby.js';
import { Radar } from './radar.js';

// ============================================================================ renderer & scenes
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
const DPR = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
useRenderer(renderer);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.004, 1e16);
const scene = new THREE.Scene();
const probeScene = new THREE.Scene();
const { composer, lens, bloom, mainPass, probePass } = createComposer(renderer, scene, probeScene, camera);

const SQZ = 4e13; // beyond this, meshes are pulled in along the line of sight and shrunk (same angular size)

// ============================================================================ world objects
const loadText = (s) => { $('loadtext').textContent = s; };
// every download starts now, in parallel; the galaxies and planets are built while they arrive
const skyTexP = loadTextureAsync('textures/milkyway_eq.jpg');
const starBufP = fetch('data/stars.bin').then((r) => r.arrayBuffer());
preloadTextures();
const skyTex = await skyTexP;
const panorama = createPanorama(skyTex);
scene.add(panorama);
lens.uniforms.tSky.value = skyTex;

loadText('Placing 109,000 stars…');
const starBuf = await starBufP;
const stars = createStarfield(starBuf, [[0, 0, 0], PROXIMA_PC]);
scene.add(stars);

loadText('Building galaxies…');
const galaxies = createGalaxies();
for (const g of Object.values(galaxies)) scene.add(g);
// The galaxies' big soft blobs (layer 1) are drawn into a half-resolution layer first, then laid over the
// frame between the galaxy stars and the dust (renderOrder −75): rgb is added, alpha (the dust's
// transmission) darkens what was drawn before, just as the full-resolution blobs would have.
const SPLIT_PX = 10;
const lowRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const sizeLow = () => { const s = renderer.getDrawingBufferSize(new THREE.Vector2()); lowRT.setSize(Math.ceil(s.x / 2), Math.ceil(s.y / 2)); };
sizeLow();
const lowQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tLow: { value: lowRT.texture } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tLow; varying vec2 vUv; void main() { gl_FragColor = texture2D(tLow, vUv); }',
  depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
}));
lowQuad.frustumCulled = false;
lowQuad.renderOrder = -75;
scene.add(lowQuad);
const lowClear = new THREE.Color();
function renderLowLayer(split = SPLIT_PX) {
  const on = mainPass.scene === scene && Object.values(galaxies).some((g) => g.visible);
  GALAXY_SPLIT.value = on ? split : 1e9;
  lowQuad.visible = on;
  if (!on) return;
  renderer.getClearColor(lowClear); const a = renderer.getClearAlpha();
  renderer.setRenderTarget(lowRT); renderer.setClearColor(0x000000, 1);
  camera.layers.set(1); renderer.render(scene, camera); camera.layers.set(0);
  renderer.setClearColor(lowClear, a); renderer.setRenderTarget(null);
}

loadText('Rendering planets…');
const PLANETS = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const planets = {};
for (const id of PLANETS) { planets[id] = new Planet(id, RADIUS[id]); scene.add(planets[id].root); }
planets.proximab = new Planet('proximab', PROXIMA_B.radius);
scene.add(planets.proximab.root);
const posOf = {
  ...Object.fromEntries(PLANETS.filter((p) => p !== 'moon').map((p) => [p, (t) => planetPos(p, t)])),
  moon: (t) => v3.add(planetPos('earth', t), moonGeo(t)),
  proximab: (t) => proximaBPos(t),
};

const sun = new Star({ temp: 5772, radius: RADIUS.sun, absMag: 4.83, map: '8k_sun.jpg' });
const proxima = new Star({ temp: 3042, radius: PROXIMA.radius, absMag: 15.5 });
const bhStar = new Star({ temp: GAIA_BH1.companion.teff, radius: GAIA_BH1.companion.radius, absMag: GAIA_BH1.companion.absMag });
for (const s of [sun, proxima, bhStar]) scene.add(s.root);
bhStar.maxGlare = 40;
// illustrative disk orientation: galactic north tilted ~26° sideways, so the Milky Way crosses the view at an angle
const BH_DISK_N = (() => {
  const ngp = GALAXIES.milkyway.pole, gc = v3.norm(v3.sub(GALAXIES.milkyway.center, GAIA_BH1.pos));
  return v3.norm(v3.add(v3.scale(ngp, 0.9), v3.scale(v3.norm(v3.cross(ngp, gc)), 0.44)));
})(); // keep the companion's glare from swamping the lensed view

// Gaia BH1's spin has not been measured; shown spinning at 0.9 of the maximum (a/M), the disk in its
// equatorial plane. Thin-disk constants: the innermost stable circular orbit (Bardeen, Press &
// Teukolsky 1972) and the Page–Thorne flux coefficients, normalised to a peak of 1.
const BH_SPIN = 0.9;
let BLOOM = bloom.strength;
(function kerrDisk(a) {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a)), z2 = Math.sqrt(3 * a * a + z1 * z1);
  const isco = 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  const x0 = Math.sqrt(isco), ac = Math.acos(a);
  const xs = [2 * Math.cos((ac - Math.PI) / 3), 2 * Math.cos((ac + Math.PI) / 3), -2 * Math.cos(ac / 3)];
  const cs = xs.map((xi, i) => { const [xj, xk] = xs.filter((_, k) => k !== i); return (3 * (xi - a) ** 2) / (xi * (xi - xj) * (xi - xk)); });
  const flux = (r) => {
    const x = Math.sqrt(r);
    const b = x - x0 - 1.5 * a * Math.log(x / x0) - xs.reduce((sum, xi, i) => sum + cs[i] * Math.log((x - xi) / (x0 - xi)), 0);
    return Math.max(b, 0) / (x ** 4 * (x ** 3 - 3 * x + 2 * a));
  };
  let fmax = 0;
  for (let r = isco * 1.0001; r < 24; r += 0.01) fmax = Math.max(fmax, flux(r));
  const u = lens.uniforms;
  u.uSpin.value = a; u.uIsco.value = isco; u.uDiskOut.value = 16;   // a compact disk: a thin, crisp band
  u.uPT0.value.set(x0, xs[0], xs[1], xs[2]); u.uPT1.value.set(cs[0], cs[1], cs[2], 1 / fmax);
})(BH_SPIN);
const spinX = (n) => v3.norm(v3.cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
const BH_SPIN_X = spinX(BH_DISK_N);

// planet orbits: one revolution from today, redrawn camera-relative every frame (see lines.js)
const orbitGroup = new THREE.Group();
scene.add(orbitGroup);
const t0Now = dateToSim(new Date());
const orbitLines = PLANETS.filter((p) => p !== 'moon').map((id) => {
  const n = 1440, L = new WorldLine(n, id === 'earth' ? 0x6fa8ff : 0x8a9ab8, 0.3, { loop: true, dotted: true });
  const P = orbitalPeriod(id);
  for (let i = 0; i < n; i++) L.world.set(planetPos(id, t0Now + (P * i) / n), i * 3);
  orbitGroup.add(L.line);
  return { id, L };
});

// moons, with their orbits, around the real planets
const moonSystems = ['earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'].map((id) => ({ id, sys: new MoonSystem(id, scene, t0Now) }));

// the flight path, start to destination: a faint line the ship rides along
const PATH_N = 200;
const pathL = new WorldLine(PATH_N, 0xffffff, 0.3, { vertexColors: true });
const pathLine = pathL.line;
scene.add(pathLine);

// Near light speed aberration squeezes the whole sky into a spot dead ahead, of angular radius ~1/γ;
// once that is far below a pixel it is drawn as a glowing point so it does not simply vanish
const skyDot = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(210,225,255,0.9)');
  gr.addColorStop(0.3, 'rgba(140,170,255,0.25)'); gr.addColorStop(1, 'rgba(110,140,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sp.frustumCulled = false; sp.visible = false;
  return sp;
})();
scene.add(skyDot);

// probe scene lighting
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
probeScene.add(sunLight, sunLight.target);
// light from the Doppler-boosted sky ahead of a relativistic ship
const skyLight = new THREE.DirectionalLight(0xbfd4ff, 0);
probeScene.add(skyLight, skyLight.target);
probeScene.add(new THREE.AmbientLight(0x8899bb, 0.06));
const pmrem = new THREE.PMREMGenerator(renderer);
probeScene.environment = pmrem.fromEquirectangular(skyTex).texture; // the sky map itself: a clone would upload 8k again
probeScene.environmentIntensity = 0.35;
const probeRoot = new THREE.Group();
probeScene.add(probeRoot);

// ============================================================================ state
const app = {
  t: t0Now, playing: false, warp: 1, factor: 1, defaultFactor: 1, flybys: [], mission: null, probe: null, dest: null, model: null,
  arrivedShown: false, showDisk: true, showOrbits: true, showLabels: true, showMoons: true, quat: new THREE.Quaternion(),
};
const models = {};
async function getModel(id) {
  if (!models[id]) { models[id] = new ProbeModel(id); await models[id].ready; }
  return models[id];
}

// mode: 'cine' (default: frames whatever is passing, otherwise looks ahead to the destination), 'chase' or
// 'orbit'; pref is the user's pick, which the camera returns to after the launch and view changes
const ctl = { mode: 'cine', pref: 'cine', focus: 'probe', yaw: 0.55, pitch: 0.18, dist: 30, tYaw: 0.55, tPitch: 0.18, tDist: 30, idle: 0, lookMix: 0 };

async function startMission(destId, probeId, launchT, autoplay = true) {
  app.dest = destById(destId);
  app.probe = probeById(probeId);
  app.mission = new Mission(app.probe, app.dest, launchT, null);
  app.t = app.mission.t0;
  app.warp = 1;
  app.arrivedShown = false;
  $('arrive').classList.add('hidden');
  const m = await getModel(probeId);
  probeRoot.clear();
  probeRoot.add(m.group);
  app.model = m;
  ctl.focus = 'probe'; setSeg('seg-focus', 'probe');
  ctl.mode = ctl.pref; setSeg('seg-cam', ctl.pref); ctl.frame = null;
  ctl.tDist = ctl.dist = m.length * 2.6;
  ctl.tYaw = ctl.yaw = 0.6; ctl.tPitch = ctl.pitch = 0.16;
  app.quat.identity(); app.quatInit = false;
  $('h-probe').textContent = app.probe.name;
  $('h-dest').textContent = app.dest.name;
  tracker.setMission(app.mission);
  passbys.setMission(app.mission, tracker);
  app.flybys = passbys.flybyWindows();
  tracker.setFlybys(app.flybys.map((f) => f.tc));
  app.defaultFactor = defaultFactor(app.dest, app.mission.t0);
  radar.setMission(app.mission);
  facts.setMission(app.mission, tracker);
  setFactor(app.defaultFactor);
  app.phaseKey = null; app.squeezeShown = false;
  ctl.snap = true;
  $('b-disk').classList.toggle('hidden', app.dest.kind !== 'blackhole');
  app.playing = autoplay;
  $('b-play').textContent = app.playing ? '❚❚' : '▶';
}

// ============================================================================ camera control
canvas.addEventListener('pointerdown', (e) => { if (menu.visible) return; ctl.drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!ctl.drag) return;
  ctl.tYaw -= (e.clientX - ctl.drag.x) * 0.005;
  ctl.tPitch = Math.max(-1.5, Math.min(1.5, ctl.tPitch + (e.clientY - ctl.drag.y) * 0.005));
  ctl.drag = { x: e.clientX, y: e.clientY };
  ctl.idle = 0;
});
canvas.addEventListener('pointerup', () => { ctl.drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (menu.visible) return; ctl.tDist *= Math.exp(e.deltaY * 0.0015); ctl.idle = 0; }, { passive: false });
let pinch = null;
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinch) ctl.tDist *= pinch / d;
    pinch = d;
  }
}, { passive: true });
canvas.addEventListener('touchend', () => { pinch = null; });

function focusRadius() {
  if (ctl.focus === 'probe') return (app.model?.length || 10) * 0.45;
  if (ctl.focus === 'earth') return RADIUS.earth;
  return app.dest.kind === 'blackhole' ? 6 * GAIA_BH1.rs : app.dest.kind === 'galaxy' ? 2 * KPC : app.dest.radius;
}

// Point the orbit camera so its offset from the focus is along world direction `o`
function aimOrbit(o) {
  const f = [1, 0, 0], up = ECLIPTIC_NORTH, r = v3.norm(v3.cross(f, up)), u = v3.cross(r, f);
  ctl.tYaw = Math.atan2(v3.dot(o, r), -v3.dot(o, f));
  ctl.tPitch = Math.asin(Math.max(-1, Math.min(1, v3.dot(o, u))));
}
// Smooth view changes: from now on the camera's direction, distance and roll glide from the current
// pose to the new view over dur seconds, instead of each easing at its own speed.
// The start pose is kept relative to what the camera was centred on, so a blend that also moves the
// centre (ship → black hole) starts where the camera really is, instead of that offset from the new centre.
function startBlend(dur) {
  if (!app.camU) return;
  ctl.blend = { off: OFF.slice(), focus: ctl.focus, up: app.camUp || app.camU, start: wall, dur };
}
function focusPos(id, st, m) {
  return id === 'probe' ? st.pos : id === 'earth' ? planetPos('earth', app.t) : m.dest.pos(app.t);
}
function slerpV(a, b, t) {
  const th = Math.acos(Math.max(-1, Math.min(1, v3.dot(a, b))));
  if (th < 1e-5) return b;
  if (th > Math.PI - 1e-3) { // opposite: go round via any perpendicular
    let p = v3.cross(a, [0, 0, 1]); if (v3.len(p) < 0.1) p = v3.cross(a, [1, 0, 0]); p = v3.norm(p);
    return t < 0.5 ? slerpV(a, p, t * 2) : slerpV(p, b, t * 2 - 1);
  }
  const sn = Math.sin(th);
  return v3.add(v3.scale(a, Math.sin((1 - t) * th) / sn), v3.scale(b, Math.sin(t * th) / sn));
}

// where the trip is headed: a planet's position at arrival (it moves on during the trip), else the destination
function aimPoint(st) {
  const m = app.mission;
  return !st.arrived && m.dest.kind === 'planet' ? m.dest.pos(m.t0 + m.tArrive) : m.dest.pos(app.t);
}
function turnToward(a, b, maxAng) {
  const th = Math.acos(Math.max(-1, Math.min(1, v3.dot(a, b))));
  return th <= maxAng ? b : slerpV(a, b, maxAng / th);
}

// Black hole: look at the hole with its companion star almost directly behind it
function blackHoleView() {
  startBlend(8);
  ctl.focus = 'dest'; setSeg('seg-focus', 'dest');
  ctl.mode = 'orbit'; setSeg('seg-cam', 'orbit');
  const toStar = v3.norm(v3.sub(bh1CompanionPos(app.t), GAIA_BH1.pos));
  // frame lies in the disk plane so pitch is height above the disk; look toward the galactic centre
  // so the Milky Way band runs diagonally behind the hole
  const N = BH_DISK_N;
  const toGC = v3.norm(v3.sub(GALAXIES.milkyway.center, GAIA_BH1.pos));
  const fwd = v3.norm(v3.sub(toGC, v3.scale(N, v3.dot(toGC, N))));
  ctl.frame = { f: fwd, up: N };
  ctl.tYaw = 0.75; ctl.tPitch = 0.14;  // ~8° above the disk, galactic centre off to one side
  ctl.tDist = 18 * GAIA_BH1.rs;        // inside the ship's parking orbit: the disk fills the view
  void toStar;
}

// Planet / star arrival: camera rides behind the probe, always looking at the destination
function arrivalView() {
  startBlend(8);
  ctl.focus = 'probe'; setSeg('seg-focus', 'probe');
  ctl.mode = 'orbit'; setSeg('seg-cam', 'orbit');
  const o = app.mission.orbit;
  ctl.frame = { track: true, up: o ? o.n : ECLIPTIC_NORTH };
  ctl.tYaw = 0.35; ctl.tPitch = 0.18;
  ctl.tDist = (app.model?.length || 10) * 3;
}

// Launch: camera beside the ship with Earth below, "up" on screen = away from Earth, so the ship
// visibly climbs away from the planet.
function launchView() {
  ctl.focus = 'probe'; setSeg('seg-focus', 'probe');
  ctl.mode = 'orbit'; setSeg('seg-cam', 'orbit');
  const st = app.mission.stateAt(app.t);
  const up = v3.norm(v3.sub(st.pos, planetPos('earth', app.t)));
  // look toward the sunward horizon (day side / glowing limb) when there is one
  const toSun = v3.norm(v3.scale(planetPos('earth', app.t), -1));
  let side = v3.sub(toSun, v3.scale(up, v3.dot(toSun, up)));
  if (v3.len(side) < 0.1) side = v3.cross(up, ECLIPTIC_NORTH);
  ctl.frame = { f: v3.norm(side), up };
  ctl.tYaw = ctl.yaw = 1.05;     // sun from the side
  ctl.tPitch = ctl.pitch = 0.78;  // above the ship, looking down past it at the curve of Earth
  ctl.tDist = ctl.dist = app.model.length * 3.6;
  ctl.snap = true;
}
// After liftoff: re-express the current camera offset in the chase frame, then ease behind the ship
// (the camera frame itself is smoothed in the main loop, so this glides instead of snapping)
function swingToChase(dur = 10) {
  startBlend(dur);
  ctl.mode = ctl.pref; setSeg('seg-cam', ctl.pref); ctl.frame = null;
  [ctl.tYaw, ctl.tPitch] = ctl.pref === 'cine' ? [0.32, 0.13] : [0.6, 0.16];
  ctl.tDist = app.model.length * 2.6;
}

// Galaxy: orbit the ship with the whole galaxy framed behind it
function galaxyView() {
  startBlend(8);
  ctl.focus = 'probe'; setSeg('seg-focus', 'probe');
  ctl.mode = 'orbit'; setSeg('seg-cam', 'orbit');
  const st = app.mission.stateAt(app.t);
  const toG = v3.norm(v3.sub(app.dest.pos(app.t), st.pos));
  let side = v3.cross(toG, ECLIPTIC_NORTH);
  if (v3.len(side) < 0.2) side = v3.cross(toG, [1, 0, 0]); // LMC sits near the south ecliptic pole
  const up2 = v3.norm(v3.cross(v3.norm(side), toG));
  ctl.frame = { f: toG, up: up2 };   // camera behind the ship, galaxy beyond it
  ctl.tYaw = 0.32; ctl.tPitch = 0.1;
  ctl.tDist = (app.model?.length || 300) * 2.2;
}

// ============================================================================ helpers
const tmpV = new THREE.Vector3();
// Camera-relative positions are formed as (world − focus) − offset: the focus is subtracted first so
// precision stays local even 10²² m from the Sun (where a double resolves only ~4,000 km).
let FOC = [0, 0, 0], OFF = [0, 0, 0];
const relW = (w) => [(w[0] - FOC[0]) - OFF[0], (w[1] - FOC[1]) - OFF[1], (w[2] - FOC[2]) - OFF[2]];
function place(obj, world, scale) {
  let [rx, ry, rz] = relW(world);
  const d = Math.hypot(rx, ry, rz);
  let k = 1;
  if (d > SQZ) { k = SQZ / d; rx *= k; ry *= k; rz *= k; }
  obj.position.set(rx, ry, rz);
  if (scale !== undefined) obj.scale.setScalar(scale * k);
  return d;
}

// JS twin of the GLSL aberration so labels sit on the aberrated image
function aberrateJS(n, dir, beta) {
  if (beta < 1e-7) return n;
  const c = v3.dot(n, dir), cp = (c + beta) / (1 + beta * c);
  const perp = v3.sub(n, v3.scale(dir, c)), pl = v3.len(perp);
  if (pl < 1e-12) return n;
  return v3.add(v3.scale(dir, cp), v3.scale(perp, Math.sqrt(Math.max(0, 1 - cp * cp)) / pl));
}

const labelsEl = $('labels');
const labelPool = [];
let labelIdx = 0;
function label(text, rel, cls, beta, dir) {
  if (!app.showLabels && !cls.includes('dest')) return;
  const d = v3.len(rel);
  const n = aberrateJS(v3.scale(rel, 1 / d), dir, beta);
  tmpV.set(n[0], n[1], n[2]).multiplyScalar(1000).project(camera);
  if (tmpV.z > 1 || tmpV.z < -1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05) return;
  let el = labelPool[labelIdx];
  if (!el) { el = document.createElement('div'); labelsEl.appendChild(el); labelPool.push(el); }
  labelIdx++;
  // touch the DOM only when something changed; move with a transform (no layout)
  if (el._cls !== cls) { el._cls = cls; el.className = 'lbl ' + cls; }
  if (el._text !== text) { el._text = text; el.innerHTML = text; }
  if (el.style.display) el.style.display = '';
  el.style.transform = `translate3d(${((tmpV.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px,${((-tmpV.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px,0) translate(9px,-50%)`;
}

// ============================================================================ UI wiring
const tracker = new Tracker();
const facts = new FactTicker();
const radar = new Radar($('radar'), $('radar-big'));
const passbys = new Passbys(probeScene, scene);
const menu = new Menu({
  panorama, stars, envMap: probeScene.environment, canvas,
  onContinue: async (d, p, t) => { menu.show(false); await prepareLaunch(d, p, t); },
});
function showRunUI(v) { for (const id of ['hud', 'tools', 'missionbar', 'mappanel']) $(id).classList.toggle('hidden', !v); if (!v) $('radar-big').classList.add('hidden'); layoutTop(); }
// Keep the top-centre readout clear of the top-right buttons: measured, not a fixed breakpoint, since
// both change width (window size, the numbers themselves, the Disk button). If they would touch, the
// readout (and the update text under it) drops below the buttons, and the arrival card below that.
function layoutTop() {
  const hud = $('hud'), tools = $('tools');
  if (hud.classList.contains('hidden')) return;
  const h = hud.getBoundingClientRect(), t = tools.getBoundingClientRect();
  const clash = !tools.classList.contains('hidden') && t.top < h.top + 40 && h.right + 12 > t.left;
  const top = clash ? Math.round(t.bottom + 10) : 14;
  if (hud._top !== top) { hud._top = top; hud.style.top = `${top}px`; $('fact').style.top = `${top + 108}px`; }
  // the arrival card (300 px wide, top right) goes below the readout if they would overlap
  const card = innerWidth - 16 - 300 < h.right + 12 ? Math.round(top + h.height + 12) : 64;
  if (hud._card !== card) { hud._card = card; $('arrive').style.top = `${card}px`; }
}

async function prepareLaunch(d, p, t) {
  await startMission(d, p, t, false);
  showRunUI(true);
  $('missionbar').classList.add('hidden'); $('mappanel').classList.add('hidden');
  app.prelaunch = true;
  launchView();
  const m = app.mission;
  const wait = (m.t0 - m.requestedLaunch) / DAY;
  $('lp-title').textContent = `${app.probe.name}  →  ${app.dest.name}`;
  $('lp-sub').textContent = `Estimated trip: ${fmtTime(m.tArrive)}` + (wait > 1 ? ` · launch window opens ${fmtDate(m.t0)}` : '') +
    (m.flyby ? ' · real design is flyby-only; here it stops to orbit so you can look around' : '');
  $('launchpad').classList.remove('hidden');
}

$('b-go').onclick = async () => {
  $('launchpad').classList.add('hidden');
  const cd = $('countdown');
  cd.classList.remove('hidden', 'go');
  for (const n of ['3', '2', '1']) { cd.textContent = n; await new Promise((r) => setTimeout(r, 800)); }
  cd.textContent = 'LIFTOFF'; cd.classList.add('go');
  app.prelaunch = false;
  $('missionbar').classList.remove('hidden'); $('mappanel').classList.remove('hidden');
  app.playing = true; $('b-play').textContent = '❚❚';
  app.liftoffAt = wall;   // the launch camera holds for a few seconds, then swings behind the ship
  setTimeout(() => cd.classList.add('hidden'), 900);
};
function setSeg(id, v) { $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }
function setCam(v) {
  startBlend(2.5); ctl.mode = ctl.pref = v; ctl.frame = null; setSeg('seg-cam', v);
  if (v !== 'orbit' && ctl.focus !== 'probe') { ctl.focus = 'probe'; setSeg('seg-focus', 'probe'); ctl.tDist = (app.model?.length || 10) * 2.6; }
}
$('seg-cam').addEventListener('click', (e) => { const v = e.target.dataset.v; if (v) setCam(v); });
$('seg-focus').addEventListener('click', (e) => {
  const v = e.target.dataset.v; if (!v) return;
  ctl.focus = v; setSeg('seg-focus', v); ctl.frame = null;
  if (v === 'dest' && app.dest.kind === 'blackhole') { blackHoleView(); return; }
  ctl.tDist = focusRadius() * (v === 'probe' ? 5.5 : app.dest.kind === 'galaxy' && v === 'dest' ? 40 : 4);
  if (v !== 'probe') { ctl.mode = 'orbit'; setSeg('seg-cam', 'orbit'); }
});
$('b-new').onclick = () => { app.playing = false; app.prelaunch = false; menu.show(true); showRunUI(false); facts.hide(); for (const id of ['arrive', 'launchpad', 'info']) $(id).classList.add('hidden'); };
$('b-disk').onclick = () => { app.showDisk = !app.showDisk; $('b-disk').classList.toggle('on', app.showDisk); };
$('b-play').onclick = togglePlay;
function togglePlay() { if (app.prelaunch) return; app.playing = !app.playing; $('b-play').textContent = app.playing ? '❚❚' : '▶'; }
$('b-orbits').onclick = () => { app.showOrbits = !app.showOrbits; $('b-orbits').classList.toggle('on', app.showOrbits); };
$('b-moons').onclick = () => { app.showMoons = !app.showMoons; $('b-moons').classList.toggle('on', app.showMoons); };
$('b-labels').onclick = () => { app.showLabels = !app.showLabels; $('b-labels').classList.toggle('on', app.showLabels); };
$('b-info').onclick = () => $('info').classList.toggle('hidden');
$('b-info-close').onclick = () => $('info').classList.add('hidden');
// the time factor: one setting for the whole trip, stepped with ‹ ›, Reset back to the default
function setFactor(f, announce) {
  app.factor = f;
  $('tf-reset').classList.toggle('on', f === app.defaultFactor);
  if (announce && app.mission && app.playing && !app.prelaunch) {
    facts.announce('Time flow', `${rateText(f).replace(/^1 s/, '1 second')}. The whole trip now takes about ${fmtTime(screenTime(f))} on screen.`);
  }
}
$('tf-slow').onclick = () => setFactor(stepRate(app.factor, -1), true);
$('tf-fast').onclick = () => setFactor(stepRate(app.factor, 1), true);
$('tf-reset').onclick = () => setFactor(app.defaultFactor, true);
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === 'o') $('b-orbits').click();
  if (e.key === 'l') $('b-labels').click();
  if (e.key === 'm') $('b-moons').click();
  if (e.key === 'c') setCam({ cine: 'chase', chase: 'orbit', orbit: 'cine' }[ctl.mode] || 'cine');
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  sizeLow();
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  menu.resize();
});

// ============================================================================ main loop
let last = performance.now(), hudTimer = 0, wall = 0;

// ---- time flow: one factor for the whole trip (app.factor: per destination, stepped by the user),
// with three slow-motion moments: liftoff, planet flybys and the final approach.
const K_LIFT = 0.7, K_ARRIVE = 0.7; // ramps: elapsed (remaining) time grows (shrinks) e-fold per screen second
// the clock is a double near (launch + trip) s: each 1/60 s frame must move it by well over its precision
const floorRate = () => niceUp((Math.abs(app.mission.t0) + app.mission.tArrive) * 2.2e-16 * 60 * 64);
function orbitRate() {
  const P = app.mission.orbit?.P;
  return Math.max(floorRate(), isFinite(P) ? niceRate(Math.max(1, P / 80)) : 1);
}
function flybyAt(rel) { for (const f of app.flybys) if (rel >= f.t0 && rel < f.t1) return f; return null; }
function zapAt(rel) { for (const f of app.flybys) if (rel >= f.z0 && rel < f.t0) return f; return null; }
/** Rough screen time of the whole trip at factor F, slow-motion moments included. */
function screenTime(F) {
  const m = app.mission, ramps = (K_LIFT + K_ARRIVE) * Math.log(Math.max(1, (F * 0.7) / floorRate()));
  return m.tArrive / F + ramps + app.flybys.reduce((s, f) => s + (f.t1 - f.t0) / Math.min(F, f.rate) + 0.3, 0);
}
/** Time-flow rate (sim s per screen s) rel s after launch, and the moment it belongs to. */
function phaseAt(rel) {
  const m = app.mission;
  if (rel >= m.tArrive) return { rate: orbitRate(), kind: 'orbit' };
  const lift = Math.max(1, rel / K_LIFT), arrive = Math.max(1, (m.tArrive - rel) / K_ARRIVE), fb = flybyAt(rel);
  let rate = app.factor, kind = 'cruise';
  if (lift < rate) { rate = lift; kind = 'lift'; }
  if (arrive < rate) { rate = arrive; kind = 'arrive'; }
  if (fb && fb.rate < rate) { rate = fb.rate; kind = 'flyby'; }
  const zap = zapAt(rel); // the planet rushing in: still far faster than the pass, but visible
  if (zap && zap.zrate < rate) rate = zap.zrate;
  return { rate: Math.max(rate, floorRate()), kind, fly: kind === 'flyby' ? fb : null };
}
const rateAt = (rel) => phaseAt(rel).rate;
// advance by dt of screen time, stopping exactly at flyby edges and the arrival so that even a very
// fast factor never jumps past them
function advance(t, dt) {
  const m = app.mission;
  let left = dt;
  for (let i = 0; i < 8 && left > 1e-9; i++) {
    const rel = t - m.t0, r = rateAt(rel);
    let edge = rel < m.tArrive ? m.tArrive : Infinity;
    for (const f of app.flybys) {
      if (f.z0 > rel && f.z0 < edge) edge = f.z0;
      if (f.t0 > rel && f.t0 < edge) edge = f.t0;
      if (f.t1 > rel && f.t1 < edge) edge = f.t1;
    }
    if (rel + r * left < edge) { t += r * left; left = 0; }
    else {
      left -= (edge - rel) / r;
      // land exactly on (or just past) the edge: t0 + edge − t0 can round a hair short of edge at
      // ~1e9 s, which would leave the clock stuck before it forever
      t = m.t0 + edge;
      for (let k = 0; k < 64 && t - m.t0 < edge; k++) t += Math.max(1e-6, Math.abs(t) * 2.3e-16);
    }
  }
  return t;
}
// announce each slow-motion moment (and the return to the normal factor) in the update area
function announcePhase(st) {
  const m = app.mission, ph = phaseAt(app.t - m.t0);
  const key = ph.fly || ph.kind;
  if (key === app.phaseKey) return;
  const prev = app.phaseKey;
  app.phaseKey = key;
  if (!app.playing || app.prelaunch) return;
  const words = (r) => rateText(r).replace(/^1 s/, '1 second').replace(/^Real time$/, 'real time');
  const F = words(app.factor), screen = screenTime(app.factor);
  if (ph.kind === 'lift') facts.announce('Liftoff', `Real time for liftoff, then time speeds up to your setting: ${F}.`);
  else if (ph.kind === 'cruise' && prev === 'lift') {
    let text = `Time flow: ${F}. At this rate the whole trip takes about ${fmtTime(screen)} on screen.`;
    if (m.tArrive > 2 * YEAR) text += ` In real life it takes ${fmtTime(m.tArrive)}: ${humanScale(m.tArrive)}.`;
    if (screen > 900) text += ' Use › to speed time up.';
    facts.announce('Time flow', text);
  } else if (ph.kind === 'cruise' && prev && prev.tc !== undefined) facts.announce('Time flow', `Back to ${F}.`);
  else if (ph.kind === 'flyby') {
    const v = ph.fly.speed / 1e3;
    facts.announce(ph.fly.name, `Slowing to ${words(ph.fly.rate)} while ${ph.fly.body} goes by. The ship is doing ${v.toLocaleString('en-US', { maximumFractionDigits: v < 100 ? 1 : 0 })} km/s.`);
  } else if (ph.kind === 'arrive') facts.announce('Final approach', 'Easing time down to watch the arrival.');
  else if (ph.kind === 'orbit' && st.orbiting && isFinite(m.orbit?.P)) facts.announce('In orbit', `Time flow: ${words(ph.rate)}.`);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now; wall += dt;
  const m = app.mission;
  if (!m) return;

  // ---- time
  let st = m.stateAt(app.t);
  if (app.playing) {
    app.t = advance(app.t, dt);
    st = m.stateAt(app.t);
    app.playClock = (app.playClock || 0) + dt; // screen time that stops while paused (drives passbys)
  }
  app.warp = rateAt(app.t - m.t0);
  announcePhase(st);
  // the launch view holds for 6 s, or less if a flyby (usually the Moon) is about to start
  if (app.liftoffAt !== undefined && (wall - app.liftoffAt > 6 || (passbys.focus && wall - app.liftoffAt > 1.5))) {
    const soon = !!passbys.focus;
    app.liftoffAt = undefined;
    if (ctl.frame) swingToChase(soon ? 4 : 10);
  }
  if (st.arrived && !app.arrivedShown) {
    app.arrivedShown = true; showArrival(st);
    if (m.dest.id === 'andromeda') facts.announce('Andromeda', 'The faint stars all around are Andromeda\'s own halo, with its star clusters and neighbouring galaxies, shown as a long-exposure camera would record them. To the eye, only Andromeda itself, the Milky Way behind you and, just barely, Triangulum would be visible.');
    if (m.dest.kind === 'blackhole') blackHoleView();
    else if (m.dest.kind === 'galaxy') galaxyView();
    else arrivalView();
  }

  // ---- camera
  const k = Math.min(1, dt * 7);
  if (!ctl.drag && ctl.mode === 'orbit' && (!app.playing || app.prelaunch)) ctl.tYaw += dt * (app.prelaunch ? 0.03 : 0.02);
  // in flight nothing outside moves visibly, so while left alone the chase camera sways gently from
  // side to side behind the ship (staying behind it, looking ahead); any drag or zoom stops it for 8 s
  ctl.idle = (ctl.idle || 0) + dt;
  if (!ctl.drag && ctl.mode === 'chase' && app.playing && !app.prelaunch && ctl.idle > 8 && !ctl.blend) {
    const ks = Math.min(1, dt * 0.4); // ease into the sway, never jump to it
    ctl.tYaw += (0.6 * Math.sin(wall * 0.045) - ctl.tYaw) * ks;
    ctl.tPitch += (0.16 + 0.12 * Math.sin(wall * 0.07) - ctl.tPitch) * ks;
  }
  // cinematic: a slow drift over the shoulder, ship in the foreground, the view beyond it
  if (!ctl.drag && ctl.mode === 'cine' && !app.prelaunch && ctl.idle > 8 && !ctl.blend) {
    const ks = Math.min(1, dt * 0.3);
    ctl.tYaw += (0.32 + 0.2 * Math.sin(wall * 0.035) - ctl.tYaw) * ks;
    ctl.tPitch += (0.13 + 0.07 * Math.sin(wall * 0.05 + 1) - ctl.tPitch) * ks;
  }
  // what the cinematic camera looks at: the destination, or a passing planet while one goes by (followed
  // until it is a little behind the ship, never all the way round). Two cascaded easings and a turn-rate
  // cap, so turns start and end gently even when the target jumps from one planet to the next.
  {
    const toDest = v3.norm(v3.sub(aimPoint(st), st.pos));
    let tgt = toDest;
    const fc = passbys.focus;
    const tracking = fc && fc.weight > 0 && ctl.focus === 'probe';
    if (tracking) tgt = slerpV(toDest, fc.dir, fc.weight);
    if (!app.cineL || ctl.snap) { app.cineL1 = app.cineL = tgt; }
    // the flyby sweep is already smooth, so follow it closely; turns between targets are slower
    app.cineTrack = tracking && fc.weight >= 1;
    const a = 1 - Math.exp(-dt * (app.cineTrack ? 6 : tracking ? 4 : 2.2));
    app.cineL1 = turnToward(app.cineL1, slerpV(app.cineL1, tgt, a), dt * (app.cineTrack ? 1.4 : 0.9));
    app.cineL = slerpV(app.cineL, app.cineL1, a);
  }
  if (ctl.blend) { ctl.yaw = ctl.tYaw; ctl.pitch = ctl.tPitch; } // the blend does the easing
  ctl.yaw += (ctl.tYaw - ctl.yaw) * k;
  ctl.pitch += (ctl.tPitch - ctl.pitch) * k;
  const rMin = focusRadius() * 1.15;
  ctl.tDist = Math.max(rMin, Math.min(ctl.tDist, 3e22));
  ctl.dist = ctl.blend ? ctl.tDist : Math.exp(Math.log(ctl.dist) + (Math.log(ctl.tDist) - Math.log(ctl.dist)) * k);
  const focusW = focusPos(ctl.focus, st, m);
  let up = ECLIPTIC_NORTH;
  let f = ctl.mode === 'chase' && ctl.focus === 'probe' ? (st.beta > 0 ? v3.norm(st.vel) : m.dir || v3.norm(v3.sub(m.dest.pos(app.t), st.pos))) : [1, 0, 0];
  if (ctl.mode === 'cine' && ctl.focus === 'probe') f = app.cineL;
  if (ctl.mode === 'orbit' && ctl.frame) {
    up = ctl.frame.up;
    f = ctl.frame.track ? v3.norm(v3.sub(m.dest.pos(app.t), st.pos)) : ctl.frame.f;
  }
  // ease the camera frame toward its target so view changes never snap the roll or heading
  const kf = 1 - Math.exp(-dt * 2.2);
  const ease = (a, b) => { const v = v3.add(a, v3.scale(v3.sub(b, a), kf)); return v3.len(v) < 1e-3 ? b : v3.norm(v); };
  if (ctl.snap || !app.camF || ctl.blend || ctl.mode === 'cine') { app.camF = f; app.camU = up; ctl.snap = false; }
  else { app.camF = ease(app.camF, f); app.camU = ease(app.camU, up); }
  f = app.camF; up = app.camU;
  if (Math.abs(v3.dot(f, up)) > 0.995) f = v3.norm(v3.add(f, [0.1, 0.1, 0]));
  const r = v3.norm(v3.cross(f, up)), u = v3.cross(r, f);
  const cp = Math.cos(ctl.pitch);
  let off = v3.scale(v3.add(v3.add(v3.scale(f, -cp * Math.cos(ctl.yaw)), v3.scale(r, cp * Math.sin(ctl.yaw))), v3.scale(u, Math.sin(ctl.pitch))), ctl.dist);
  let camUp = u;
  if (ctl.blend) {
    const b = ctl.blend, e0 = Math.min(1, (wall - b.start) / b.dur), e = e0 * e0 * (3 - 2 * e0);
    const s0 = b.focus === ctl.focus ? b.off : v3.add(v3.sub(focusPos(b.focus, st, m), focusW), b.off);
    const dir = slerpV(v3.norm(s0), v3.norm(off), e), d0 = v3.len(s0);
    off = v3.scale(dir, Math.exp(Math.log(d0) + (Math.log(v3.len(off)) - Math.log(d0)) * e));
    const uu = slerpV(b.up, u, e);
    camUp = v3.norm(v3.sub(uu, v3.scale(dir, v3.dot(uu, dir))));
    if (e0 >= 1) ctl.blend = null;
  }
  app.camUp = camUp;
  const cam = v3.add(focusW, off);
  FOC = focusW; OFF = off;
  camera.position.set(0, 0, 0);
  camera.up.set(camUp[0], camUp[1], camUp[2]);
  // cinematic: aim between the ship and what lies beyond it (but never away from the ship when the
  // view is dragged round to its front)
  // (during a flyby almost straight at the planet, the ship off to one side)
  ctl.lookMix += ((ctl.mode === 'cine' && ctl.focus === 'probe' ? (app.cineTrack ? 0.9 : 0.6) : 0) - ctl.lookMix) * (1 - Math.exp(-dt * 1.5));
  let look = v3.norm(v3.scale(off, -1));
  const mix = ctl.lookMix * Math.max(0, Math.min(1, v3.dot(look, app.cineL) / 0.5));
  if (mix > 1e-3) look = slerpV(look, app.cineL, mix);
  camera.lookAt(look[0], look[1], look[2]);
  camera.updateMatrixWorld();

  // ---- relativity: the camera rides with the probe only when it is following it
  const riding = ctl.focus === 'probe';
  const phi = riding ? (st.phi || 0) : 0;
  const vdir = st.beta > 0 ? v3.norm(st.vel) : [1, 0, 0];
  setObserverVelocity(vdir, phi);
  const beta = Math.tanh(phi);
  const Dmax = Math.exp(phi); // forward Doppler factor γ(1+β)
  // exposure adapts like a camera to the brightened forward sky
  // (capped: past D ≈ 9 the boosted sky ahead is a shrinking spot, not a brighter view, and dimming
  // further would black out the ship too)
  const expTarget = 1 / (1 + 0.45 * Math.min(Dmax - 1, 8));
  renderer.toneMappingExposure += (expTarget - renderer.toneMappingExposure) * Math.min(1, dt * 2);
  // from D ≈ 30 to 400 the sky hands over to the point (by D ≈ 1,000 the star field, galaxies and
  // panorama would all be piled onto a few pixels, and blending them there stalls the GPU)
  const squeeze = riding ? smoothstep(Math.log(30), Math.log(400), phi) : 0;
  skyDot.visible = squeeze > 0.01;
  if (skyDot.visible) {
    const R = 1e6 * (app.model?.length || 10); // far beyond the ship, along the flight direction
    skyDot.position.set(vdir[0] * R - OFF[0], vdir[1] * R - OFF[1], vdir[2] * R - OFF[2]);
    skyDot.scale.setScalar(R * 0.06);
    skyDot.material.opacity = squeeze;
    if (squeeze > 0.6 && !app.squeezeShown && app.playing && !menu.visible) {
      app.squeezeShown = true;
      facts.announce('What you would see', `At ${(beta * 100).toFixed(6)}% of light speed, aberration squeezes the entire sky into a point dead ahead, about ${fmtAngle(2 / Dmax)} across, and the Doppler effect shifts its light to X-rays. Everywhere else is truly black. This is real.`);
    }
  }

  // ---- bodies
  labelIdx = 0;
  const pxPerRad = (innerHeight / 2) / Math.tan((camera.fov * Math.PI) / 360);
  const sunW = [0, 0, 0];
  const dSun = place(sun.root, sunW, RADIUS.sun);
  sun.update(app.t, dSun, pxPerRad, DPR);
  const sunColor = new THREE.Color().setRGB(...bbColorJS(5772).map((x) => x / 1.08));
  const proxColor = new THREE.Color().setRGB(...bbColorJS(3042).map((x) => x / 2.2));
  for (const [id, p] of Object.entries(planets)) {
    const w = posOf[id](app.t);
    place(p.root, w, p.radius);
    const star = id === 'proximab' ? PROXIMA.pos : sunW;
    const sd = v3.norm(v3.sub(star, w));
    tmpV.set(sd[0], sd[1], sd[2]);
    p.update(app.t, tmpV, id === 'proximab' ? proxColor : sunColor);
    if (id === 'proximab') p.tilt.lookAt(p.root.position.clone().add(tmpV)); // tidally locked, day side toward Proxima
  }
  const dProx = place(proxima.root, PROXIMA.pos, PROXIMA.radius);
  proxima.update(app.t, dProx, pxPerRad, DPR);
  const bhW = GAIA_BH1.pos;
  const compW = bh1CompanionPos(app.t);
  const dComp = place(bhStar.root, compW, GAIA_BH1.companion.radius);
  bhStar.update(app.t, dComp, pxPerRad, DPR);

  // ---- orbits, moons & path
  orbitGroup.visible = app.showOrbits && dSun < 2000 * AU;
  if (orbitGroup.visible) {
    for (const { id, L } of orbitLines) {
      // fade a planet's own orbit near it, where the line would cut across its disk
      const dp = v3.len(relW(posOf[id](app.t))), R = RADIUS[id];
      const o = (id === 'earth' ? 0.5 : 0.4) * smoothstep(30 * R, 300 * R, dp); // dots: a little brighter
      L.line.visible = o > 0.005;
      if (L.line.visible) { L.opacity = o; L.rebase(FOC, OFF); }
    }
  }
  const moonCtx = {
    t: app.t, show: app.showMoons, lines: app.showOrbits, place, dist: (w) => v3.len(relW(w)), pxPerRad, sunColor,
    label: menu.visible ? null : (text, w) => label(text, relW(w), 'faint', beta, vdir),
  };
  for (const { id, sys } of moonSystems) sys.update(posOf[id](app.t), moonCtx);
  updatePath(st);

  // ---- sky
  const camPc = v3.scale(cam, 1 / PC);
  stars.material.uniforms.uCamPc.value.set(camPc[0], camPc[1], camPc[2]);
  stars.material.uniforms.uPx.value = 2.0 * DPR;
  const dSunPc = dSun / PC;
  const keep = menu.visible ? 1 : 1 - squeeze; // the resolved sky, while it has not collapsed into the point ahead
  const skyOn = keep > 0.01;
  for (const o of [stars, panorama, ...Object.values(galaxies)]) o.visible = skyOn;
  stars.material.uniforms.uGain.value = keep;
  const pano = 1 - smoothstep(350, 2500, dSunPc);
  panorama.material.uniforms.uGain.value = pano * keep;
  const proj = pxPerRad * DPR;
  // layers faded to nothing are not drawn at all (the panorama covers the whole screen; the Milky Way
  // model is 310,000 points)
  const mwFade = smoothstep(350, 2500, dSunPc) * keep, ext = smoothstep(150, 1500, dSunPc);
  panorama.visible &&= pano > 0;
  galaxies.milkyway.visible &&= mwFade > 0;
  galaxies.andromeda.visible &&= ext > 0;
  updateGalaxy(galaxies.milkyway, camPc, proj, mwFade);
  updateGalaxy(galaxies.andromeda, camPc, proj, ext * keep);
  // Andromeda's halo stars, clusters and neighbours: long-exposure view, only near M31
  const m31c = galaxies.andromeda.userData.centerPc;
  const nearM31 = smoothstep(400000, 150000, Math.hypot(camPc[0] - m31c[0], camPc[1] - m31c[1], camPc[2] - m31c[2]));
  for (const k of ['m31halo', ...M31_GROUP.map((g) => g.key)]) {
    galaxies[k].visible = skyOn && nearM31 > 0.002;
    if (galaxies[k].visible) updateGalaxy(galaxies[k], camPc, proj, nearM31 * keep);
  }
  lens.uniforms.uSkyGain.value = 0.1 * pano;

  // ---- black hole lensing (only when the Einstein ring is resolvable)
  const bhRel = relW(bhW), dBH = v3.len(bhRel);
  const thetaE = Math.sqrt((2 * GAIA_BH1.rs) / dBH);
  lens.uniforms.uActive.value = thetaE * pxPerRad > 0.6 ? 1 : 0;
  if (lens.uniforms.uActive.value) {
    const n = aberrateJS(v3.scale(bhRel, 1 / dBH), vdir, beta);
    tmpV.set(n[0], n[1], n[2]).transformDirection(camera.matrixWorldInverse);
    lens.uniforms.uBH.value.copy(tmpV);
    lens.uniforms.uRs.value = GAIA_BH1.rs;
    lens.uniforms.uDist.value = dBH;
    lens.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    lens.uniforms.uProj.value.copy(camera.projectionMatrix);
    lens.uniforms.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    lens.uniforms.uViewRot.value.setFromMatrix4(camera.matrixWorldInverse);
    // close in, trace photons through curved spacetime to show the (illustrative) accretion disk
    const rsUnits = dBH / GAIA_BH1.rs;
    lens.uniforms.uRay.value = rsUnits < 3000 ? 1 : 0;
    lens.uniforms.uDisk.value = app.showDisk ? 1 : 0;
    lens.uniforms.uCamBH.value.set(-bhRel[0] / GAIA_BH1.rs, -bhRel[1] / GAIA_BH1.rs, -bhRel[2] / GAIA_BH1.rs);
    lens.uniforms.uDiskN.value.set(...BH_DISK_N);
    lens.uniforms.uSpinX.value.set(...BH_SPIN_X);
    lens.uniforms.uBgGain.value = 2; lens.uniforms.uDiskGain.value = 2;
    lens.uniforms.uTime.value = wall;
    lens.uniforms.uSkyGain.value = 0.1 * pano * (lens.uniforms.uRay.value ? 1.25 : 1); // a brighter Milky Way behind the disk
  }

  // ---- probe
  const pm = app.model;
  if (pm) {
    probeRoot.position.set(...relW(st.pos));
    probeRoot.visible = !app.hideProbe && v3.len(relW(st.pos)) < pm.length * 4000;
    let nose = st.noseDir;
    if (app.probe.id === 'voyager') nose = v3.norm(v3.sub(planetPos('earth', app.t), st.pos)); // high-gain antenna points home
    if (app.probe.id === 'parker') nose = v3.norm(v3.scale(st.pos, -1));                         // heat shield toward the Sun
    const mtx = new THREE.Matrix4();
    const z = new THREE.Vector3(...nose), upv = new THREE.Vector3(...ECLIPTIC_NORTH);
    const x = new THREE.Vector3().crossVectors(upv, z).normalize();
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    const y = new THREE.Vector3().crossVectors(z, x);
    mtx.makeBasis(x, y, z);
    const q = new THREE.Quaternion().setFromRotationMatrix(mtx);
    if (!app.quatInit) { app.quat.copy(q); app.quatInit = true; }
    app.quat.rotateTowards(q, dt * 0.45); // turns (the flip, entering orbit) at a steady, visible ~26°/s
    probeRoot.quaternion.copy(app.quat);
    pm.update(app.playing ? st.accel : 0, wall, app.warp);
    // light from the nearest star (or the destination galaxy in deep space)
    const near = [[sunW, 5772, dSun, 4.83], [PROXIMA.pos, 3042, dProx, 15.5], [compW, 5850, dComp, 5.0]]
      .map(([p, T, d, M]) => ({ p, T, d, I: Math.pow(10, -0.4 * (M + 5 * Math.log10(d / PC) - 5)) }))
      .sort((a, b) => b.I - a.I)[0];
    // far from every star (intergalactic space) the light comes from the destination galaxy instead
    const deep = near.I < 1e-4;
    const sd = deep ? v3.norm(v3.sub(app.dest.pos(app.t), st.pos)) : v3.norm(v3.sub(near.p, st.pos));
    sunLight.position.set(sd[0], sd[1], sd[2]).multiplyScalar(100);
    sunLight.target.position.set(0, 0, 0);
    sunLight.position.add(probeRoot.position); sunLight.target.position.copy(probeRoot.position);
    const lc = bbColorJS(deep ? 4800 : near.T);
    sunLight.color.setRGB(lc[0] / 1.1, lc[1] / 1.1, lc[2] / 1.1);
    sunLight.intensity = deep ? (app.dest.kind === 'galaxy' ? 1.1 : 0.35) : 2.3 * Math.min(1, Math.max(0.12, Math.log10(near.I + 1) / 4));
    skyLight.position.set(vdir[0], vdir[1], vdir[2]).multiplyScalar(100).add(probeRoot.position);
    skyLight.target.position.copy(probeRoot.position);
    skyLight.intensity = 1.2 * Math.min(Dmax - 1, 6);
  }

  // ---- labels
  if (menu.visible) { for (const el of labelPool) el.style.display = 'none'; }
  else {
  passbys.update(app.t - m.t0, app.playClock || 0, {
    st, t: app.t, shipLen: pm?.length || 10, place, probePos: probeRoot.position, sunColor,
    travelDir: st.beta > 0 ? v3.norm(st.vel) : m.dir || [1, 0, 0],
    camF: v3.norm(v3.scale(off, -1)), camR: v3.norm(v3.cross(v3.scale(off, -1), u)),
    label: (text, w) => label(text, relW(w), 'faint', beta, vdir), moons: moonCtx,
  });
  const camToSunAU = dSun / AU;
  if (camToSunAU < 200) {
    for (const id of PLANETS) {
      if (id === 'moon' && v3.len(relW(planetPos('earth', app.t))) > 0.3 * AU) continue;
      if (app.dest.id === id) continue;
      const pr = relW(posOf[id](app.t));
      if (RADIUS[id] / v3.len(pr) * pxPerRad > 25) continue;
      label(id[0].toUpperCase() + id.slice(1), relW(posOf[id](app.t)), 'faint', beta, vdir);
    }
  }
  if (camToSunAU > 30) label('Sun', relW([0, 0, 0]), 'faint', beta, vdir);
  if (app.dest.id !== 'proxima' && dSunPc > 0.05 && dSunPc < 50) label('Proxima Centauri', relW(PROXIMA.pos), 'faint', beta, vdir);
  const destW = app.dest.pos(app.t);
  const dDest = v3.len(relW(destW));
  // a moving destination (a planet) is met where it will be on arrival, which can be far from where it
  // is now: mark both, so the flight path visibly leads to the meeting point
  const meetW = aimPoint(st), meetR = relW(meetW);
  const apart = meetW !== destW && v3.dot(v3.norm(meetR), v3.norm(relW(destW))) < Math.cos(0.02);
  const dName = app.dest.short || app.dest.name;
  if (dDest > focusRadius() * 30 || ctl.focus !== 'dest') label(`${dName}${apart ? ' now' : ''}<small>${fmtDist(dDest)}</small>`, relW(destW), apart ? 'dest faint' : 'dest', beta, vdir);
  if (apart) label(`${dName} when you arrive<small>${fmtDate(m.t0 + m.tArrive).slice(0, 4)}</small>`, meetR, 'dest', beta, vdir);
  if (ctl.focus !== 'probe' || ctl.dist > (pm?.length || 10) * 60) label(app.probe.name, relW(st.pos), 'probe', beta, vdir);
  if (skyDot.visible && skyDot.material.opacity > 0.4) label('The whole sky<small>squeezed ahead</small>', v3.scale(vdir, 1e12), 'faint', 0, vdir);
  if (nearM31 > 0.5) for (const g of M31_GROUP) label(g.name, relW(g.center), 'faint', beta, vdir);
  if (dSunPc > 2000) label('Milky Way', relW(GALAXIES.milkyway.center), 'faint', beta, vdir);
  for (let i = labelIdx; i < labelPool.length; i++) if (labelPool[i].style.display !== 'none') labelPool[i].style.display = 'none';
  }

  // ---- HUD (10 Hz)
  hudTimer += dt;
  if (hudTimer > 0.1) { hudTimer = 0; updateHUD(st); layoutTop(); if (!menu.visible) radar.update(app.t, st); }
  tracker.update(app.t, st, dt);

  facts.update(dt, app.playing && !menu.visible, app.t - m.t0);

  if (menu.visible) {
    // the menu has its own little stage; everything else keeps updating underneath
    setObserverVelocity([1, 0, 0], 0);
    menu.update(dt, wall);
    mainPass.scene = menu.scene; mainPass.camera = menu.camera;
    probePass.scene = menu.probeScene; probePass.camera = menu.camera; probePass.enabled = true;
    lens.uniforms.uActive.value = 0;
    renderer.toneMappingExposure = 1;
    // the Gaia BH1 preview is the real ray tracer, lensing the menu's own sky behind it
    const bh = menu.blackHoleView();
    if (bh) {
      const u = lens.uniforms, cam = menu.camera;
      u.uActive.value = 1; u.uRay.value = 1; u.uDisk.value = 1; u.uBgGain.value = 1; u.uDiskGain.value = 1; u.uTime.value = wall;
      u.uRs.value = 1; u.uDist.value = bh.dist;
      u.uCamBH.value.set(...v3.scale(bh.dir, -bh.dist));
      u.uDiskN.value.set(...bh.normal); u.uSpinX.value.set(...spinX(bh.normal));
      u.uInvProj.value.copy(cam.projectionMatrixInverse); u.uProj.value.copy(cam.projectionMatrix);
      u.uCamRot.value.setFromMatrix4(cam.matrixWorld); u.uViewRot.value.setFromMatrix4(cam.matrixWorldInverse);
    }
  } else {
    mainPass.scene = scene; mainPass.camera = camera;
    probePass.scene = probeScene; probePass.camera = camera; probePass.enabled = true;
  }
  lens.enabled = lens.uniforms.uActive.value > 0; // skip the full-screen lens pass when it would only copy
  // half the bloom on the ray-traced hole keeps the disk a sharp band instead of a wide haze
  bloom.strength = BLOOM * (lens.enabled && lens.uniforms.uRay.value > 0.5 ? 0.5 : 1);
  renderLowLayer();
  composer.render();
}

function fmtAngle(rad) {
  const as = (rad * 180 / Math.PI) * 3600;
  return as >= 60 ? `${(as / 60).toPrecision(2)} arcminutes` : as >= 0.1 ? `${as.toPrecision(2)} arcseconds` : `${(as * 1000).toPrecision(2)} milliarcseconds`;
}
function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// Sampled densely around the ship (so up close the line runs straight through it) and evenly elsewhere;
// stored as offsets from the ship so it stays exact even between galaxies.
function updatePath(st) {
  const m = app.mission, T = m.tArrive;
  pathLine.visible = app.showOrbits;
  if (!pathLine.visible) return;
  const rel = Math.min(Math.max(0, app.t - m.t0), T);
  const ts = [0, T, rel];
  for (let i = 1; i < 48; i++) ts.push((T * i) / 48);
  for (let j = 0; j <= 40; j++) { const d = T * 10 ** (-9 + (9 * j) / 40); ts.push(rel - d, rel + d); }
  const times = ts.filter((x) => x >= 0 && x <= T).sort((a, b) => a - b).filter((x, i, a) => i === 0 || x > a[i - 1]);
  const W = pathL.world, Cc = pathL.geo.attributes.color.array;
  const n = Math.min(times.length, PATH_N);
  for (let i = 0; i < n; i++) {
    W.set(times[i] === rel ? [0, 0, 0] : m.travelDelta(times[i], rel), i * 3);
    Cc.set(times[i] <= rel ? [0.45, 0.75, 1.0] : [1.0, 0.86, 0.62], i * 3);
  }
  pathL.rebase(FOC, OFF, st.arrived ? m.travelState(m.t0 + T).pos : st.pos, n);
  pathL.geo.attributes.color.needsUpdate = true;
}

function updateHUD(st) {
  const m = app.mission;
  const v = st.beta * C;
  // speed: km/s while slow, share of light speed once it matters
  if (st.beta < 0.01) {
    $('h-speed').textContent = (v / 1e3).toLocaleString('en-US', { maximumFractionDigits: v < 1e4 ? 2 : 1 });
    $('h-speed-unit').textContent = 'km/s';
  } else {
    $('h-speed').textContent = (st.beta * 100).toFixed(st.beta > 0.999 ? 4 : st.beta > 0.99 ? 3 : 1) + '%';
    $('h-speed-unit').textContent = 'of light speed';
  }
  let sub;
  if (app.prelaunch) sub = 'On the launch pad';
  else if (st.orbiting) sub = isFinite(m.orbit.P) ? `In orbit, once every ${fmtTime(m.orbit.P)}` : 'Holding position';
  else if (st.beta < 0.01) sub = `${(v * 3.6).toLocaleString('en-US', { maximumFractionDigits: 0 })} km/h`;
  else sub = `${(v / 1e3).toLocaleString('en-US', { maximumFractionDigits: 0 })} km/s`;
  if (st.accel > 0 && !app.prelaunch) sub += ` · engines at ${(st.accel / G0).toLocaleString('en-US', { maximumFractionDigits: st.accel / G0 > 100 ? 0 : 2 })} g`;
  $('h-speed-sub').textContent = sub;
  // time elapsed on Earth since launch (stops on arrival); to the minute while time runs slowly
  const te = Math.min(Math.max(0, app.t - m.t0), m.tArrive);
  const fine = !st.arrived && te > 2 * 3600 && te < 1000 * DAY && app.warp < 6 * 3600;
  let tv, tu;
  if (fine) {
    const d = Math.floor(te / DAY), h = Math.floor((te % DAY) / 3600), mi = Math.floor((te % 3600) / 60);
    tv = `${d ? d + 'd ' : ''}${h}h ${String(mi).padStart(2, '0')}m`; tu = '';
  } else {
    const ft = fmtTime(te), sp = ft.lastIndexOf(' ');
    [tv, tu] = sp > 0 ? [ft.slice(0, sp), ft.slice(sp + 1)] : [ft, ''];
  }
  $('h-time').textContent = tv;
  $('h-time-unit').textContent = tu + (st.arrived ? ' ✓' : '');
  // aboard time when relativity makes it differ, otherwise what is left
  const lag = te - Math.max(0, st.tau);
  $('h-time-sub').textContent = lag > te * 0.01 && te > 3600 ? `aboard the ship: only ${fmtTime(st.tau)}`
    : st.arrived ? 'arrived' : app.prelaunch ? `trip: ${fmtTime(m.tArrive)}` : `${fmtTime(m.tArrive - te)} to go`;
  const ph = phaseAt(app.t - m.t0);
  $('tf-rate').textContent = app.playing ? rateText(app.warp) : 'Paused';
  $('tf-gear').textContent = { lift: 'Liftoff · speeding up', cruise: 'Your setting', flyby: ph.fly?.name, arrive: 'Final approach', orbit: st.orbiting && isFinite(m.orbit?.P) ? 'In orbit' : 'Arrived' }[ph.kind];
  $('tf-set').textContent = `Setting: ${rateText(app.factor)} · trip ≈ ${fmtTime(screenTime(app.factor))} on screen`;
}

function showArrival(st) {
  const m = app.mission;
  const ts = m.shipTimeAtArrival();
  const mb = m.maxBeta();
  const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
  const top = mb < 0.01 ? (mb * C / 1e3).toFixed(1) + ' km/s' : (mb * 100).toFixed(mb > 0.999 ? 4 : 1) + '% of light';
  const flyNote = m.flyby
    ? `<p class="flyby">The real ${app.probe.name} cannot brake: it would streak past at ${top}${mb > 0.01 ? ` and cross this view in ${fmtTime((2 * app.dest.standoff) / (mb * C))}` : ''}. Here it is parked in orbit so you can look around.</p>`
    : '';
  const bhNote = app.dest.kind === 'blackhole' ? '<p class="flyby">The real Gaia BH1 is dormant. The glowing disk shows what it would look like if it were feeding on gas; the way light from the far side bends over the top is real, and so is the lopsided shadow of a spinning hole (Gaia BH1’s spin is not yet measured; it is shown at 90% of the maximum). Toggle the disk with “Disk”.</p>' : '';
  $('arrive').innerHTML = `<small>Mission complete</small><h3>${app.dest.name}</h3>
    ${kv('Trip time (Earth)', fmtTime(m.tArrive))}
    ${ts < m.tArrive * 0.99 ? kv('Trip time (aboard)', fmtTime(ts)) : ''}
    ${kv('Top speed', top)}
    ${kv('Arrival date on Earth', fmtDate(m.t0 + m.tArrive))}
    ${kv('A message home takes', fmtTime(v3.len(v3.sub(st.pos, planetPos('earth', app.t))) / C))}
    <p>${app.dest.facts}</p>
    ${flyNote}${bhNote}
    <button id="b-arr-close">Dismiss</button>`;
  $('arrive').classList.remove('hidden');
  $('b-arr-close').onclick = () => $('arrive').classList.add('hidden');
  clearTimeout(app.arriveTimer);
  app.arriveTimer = setTimeout(() => $('arrive').classList.add('hidden'), 22000);
}

// ============================================================================ boot
// Upload every texture and compile every shader now, behind the loading screen, so nothing stalls
// the first time a planet, ship or menu preview comes into view.
async function warmUp() {
  const parked = (models, root) => {
    const tmp = new THREE.Group();
    for (const mm of models) if (!mm.group.parent) tmp.add(mm.group);
    root.add(tmp);
    return tmp;
  };
  const mainTmp = parked(await Promise.all(PROBES.map((p) => getModel(p.id))), probeScene);
  const menuTmp = parked(await menu.preloadAll(), menu.probeScene);
  await texturesReady();
  for (const [s, c] of [[scene, camera], [probeScene, camera], [menu.scene, menu.camera], [menu.probeScene, menu.camera]]) {
    const hidden = [];
    const texs = new Set();
    s.traverse((o) => {
      if (!o.visible) { hidden.push(o); o.visible = true; }
      for (const mt of o.material ? [].concat(o.material) : []) {
        for (const v of Object.values(mt)) if (v?.isTexture) texs.add(v);
        for (const u of Object.values(mt.uniforms || {})) if (u.value?.isTexture) texs.add(u.value);
      }
    });
    for (const t of texs) if (t.image && (t.image.width || t.image.data)) renderer.initTexture(t);
    await renderer.compileAsync(s, c);
    for (const o of hidden) o.visible = false;
  }
  // the black-hole lens shader lives in a post pass, outside every scene
  const lensScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lens.material);
  quad.frustumCulled = false;
  lensScene.add(quad);
  await renderer.compileAsync(lensScene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); // same camera as the pass quad
  quad.geometry.dispose();
  mainTmp.removeFromParent(); mainTmp.clear();
  menuTmp.removeFromParent(); menuTmp.clear();
}
loadText('Preparing the GPU…');
await warmUp();
await startMission('mars', 'antimatter', t0Now, false);
ctl.mode = 'orbit'; ctl.focus = 'earth'; ctl.tDist = ctl.dist = RADIUS.earth * 3.2; ctl.tYaw = ctl.yaw = 2.2; ctl.tPitch = ctl.pitch = 0.25;
menu.show(true);
requestAnimationFrame(frame);
$('loading').style.opacity = 0;
setTimeout(() => $('loading').remove(), 900);
// dev-only hook for scripted camera tours while tuning visuals
if (import.meta.env.DEV) window.__ls = { renderer, composer, lens, bloom, renderLowLayer, lowQuad, GALAXY_SPLIT, galaxies, mainPass, probePass, scene, probeScene, app, menu, passbys, radar, ctl, advance, camera };
if (import.meta.env.DEV) addEventListener('message', async (e) => {
  const c = e.data && e.data.ls;
  if (!c) return;
  if (c.launch) { menu.show(false); showRunUI(true); await startMission(c.launch[0], c.launch[1], t0Now, c.play ?? false); }
  if (c.frac !== undefined) { const m = app.mission; app.t = m.t0 + m.tArrive * c.frac; }
  if (c.t !== undefined) app.t = c.t;
  if (c.bhview) blackHoleView();
  if (c.gview) galaxyView();
  if (c.sideEarth) { const st = app.mission.stateAt(app.t); const e = v3.norm(v3.sub(planetPos('earth', app.t), st.pos)); aimOrbit(v3.norm(v3.cross(e, ECLIPTIC_NORTH))); }
  if (c.sunview) { const p = v3.norm(app.mission.stateAt(app.t).pos); aimOrbit(v3.norm(v3.add(p, v3.scale(ECLIPTIC_NORTH, 0.25)))); }
  if (c.view) Object.assign(ctl, c.view, { yaw: c.view.tYaw ?? ctl.yaw, pitch: c.view.tPitch ?? ctl.pitch, dist: c.view.tDist ?? ctl.dist });
  if (c.ui === false) { menu.show(false); showRunUI(true); }
  if (c.menu) { menu.dest = c.menu[0]; menu.probe = c.menu[1]; menu.select(c.menuFocus); }
  if (c.play !== undefined) app.playing = c.play;
  if (c.warp) app.warp = c.warp;
  if (c.bloom !== undefined) BLOOM = c.bloom;
  if (c.glare !== undefined) for (const st of [sun, proxima, bhStar]) st.glare.visible = c.glare;
  if (c.hide) {
    const groups = { planets: Object.values(planets).map((p) => p.root), galaxies: Object.values(galaxies), stars: [stars], pano: [panorama], probe: [probeRoot], path: [pathLine, orbitGroup] };
    for (const [k, list] of Object.entries(groups)) for (const o of list) o.visible = !c.hide.includes(k);
    app.hideProbe = c.hide.includes('probe');
  }
  if (c.starMesh !== undefined) for (const st of [sun, proxima, bhStar]) st.root.visible = c.starMesh;
});
