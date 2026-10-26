import * as THREE from 'three';
import { RELATIVITY, REL } from './shaders/common.js';
import { GALAXIES } from './destinations.js';
import { PC, v3, DEG } from './constants.js';
import { radecToVec } from './astro.js';
import { createAndromedaDisk } from './andromeda.js';

// Procedural galaxies built from published structural parameters (scale lengths, bar, arm pitch,
// inclination, position angle). Each particle is a star cloud of physical size `aSize` (pc);
// surface brightness is distance-invariant, so apparent size/brightness follow from geometry.

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const HII = -1; // marker temperature: H-alpha emission nebula (pink)

class Builder {
  constructor() { this.p = []; this.t = []; this.l = []; this.s = []; this.dp = []; this.ds = []; this.dl = []; }
  star(x, y, z, T, L, S) { this.p.push(x, y, z); this.t.push(T); this.l.push(L); this.s.push(S); }
  dust(x, y, z, S, L) { this.dp.push(x, y, z); this.ds.push(S); this.dl.push(L); }
}

function spiral(b, o, r) {
  const { Rd, arms, pitch, r0, phase, bulgeR, nBulge, nDisk, nArm, z0, armSpread, bar, barLen, barAngle = 0, Rmax, ring, flat = 0.55, dust = 1 } = o;
  const k = 1 / Math.tan(pitch * DEG);
  // bulge: old, red, spheroidal
  for (let i = 0; i < nBulge; i++) {
    const rad = bulgeR * Math.pow(-Math.log(r() * r() + 1e-9), 1.6) * 0.5;
    const th = Math.acos(2 * r() - 1), ph = 2 * Math.PI * r();
    b.star(rad * Math.sin(th) * Math.cos(ph), rad * Math.sin(th) * Math.sin(ph), rad * Math.cos(th) * flat, 4300 + 600 * r(), 2.2, bulgeR * 0.35);
  }
  // bar
  if (bar) for (let i = 0; i < nBulge * 0.6; i++) {
    const u = gauss(r) * barLen * 0.45, w = gauss(r) * barLen * 0.13;
    const ca = Math.cos(barAngle), sa = Math.sin(barAngle);
    b.star(u * ca - w * sa, u * sa + w * ca, gauss(r) * z0 * 1.2, 4600 + 700 * r(), 1.6, barLen * 0.12);
  }
  // smooth old disk
  for (let i = 0; i < nDisk; i++) {
    const R = -Rd * Math.log(r() * r() + 1e-9);
    if (R > Rmax) continue;
    const th = 2 * Math.PI * r();
    b.star(R * Math.cos(th), R * Math.sin(th), gauss(r) * z0, 5200 + 1400 * r(), 0.9, Rd * 0.09 + 40);
  }
  // spiral arms: young blue stars, HII regions and dust lanes on the inner edge
  for (let i = 0; i < nArm; i++) {
    let R = r0 + (-Rd * 1.1) * Math.log(r() + 1e-9);
    if (R > Rmax) continue;
    const a = Math.floor(r() * arms);
    const thArm = Math.log(R / r0) * k + phase + (2 * Math.PI * a) / arms;
    const spread = armSpread * (0.6 + 0.4 * R / Rd);
    const off = gauss(r) * spread;
    const th = thArm + off / R;
    const x = R * Math.cos(th), y = R * Math.sin(th);
    const roll = r();
    if (roll < 0.06) b.star(x, y, gauss(r) * z0 * 0.3, HII, 3.2, 70 + 120 * r());
    else b.star(x, y, gauss(r) * z0 * 0.4, 8000 + 14000 * r() * r(), 1.5, 60 + 60 * r());
    if (dust && r() < 0.5 * dust) {
      const thd = thArm - (spread * 0.9 + Math.abs(gauss(r)) * spread * 0.5) / R;
      b.dust(R * Math.cos(thd), R * Math.sin(thd), gauss(r) * z0 * 0.25, 120 + 160 * r(), 0.55);
    }
  }
  if (ring) for (let i = 0; i < ring.n; i++) {
    const R = ring.R + gauss(r) * ring.w, th = 2 * Math.PI * r();
    const roll = r();
    b.star(R * Math.cos(th), R * Math.sin(th), gauss(r) * z0 * 0.3, roll < 0.08 ? HII : 9000 + 9000 * r(), roll < 0.08 ? 3 : 1.4, 80 + 80 * r());
    if (r() < 0.6) { const Rd2 = R - Math.abs(gauss(r)) * ring.w * 0.6; b.dust(Rd2 * Math.cos(th + 0.02), Rd2 * Math.sin(th + 0.02), gauss(r) * z0 * 0.2, 150 + 200 * r(), 0.6); }
  }
}

function elliptical(b, o, r) {
  const { n, Re, q, T = 4400, cx = 0, cy = 0, cz = 0, L = 2 } = o;
  for (let i = 0; i < n; i++) {
    const rad = Re * Math.pow(-Math.log(r() + 1e-9), 1.5) * 0.6;
    const th = Math.acos(2 * r() - 1), ph = 2 * Math.PI * r();
    b.star(cx + rad * Math.sin(th) * Math.cos(ph), cy + rad * Math.sin(th) * Math.sin(ph) * q, cz + rad * Math.cos(th) * q, T + 500 * r(), L, Re * 0.3);
  }
}

// sky basis for an external galaxy: inclination i, position angle PA (N through E)
function externalBasis(center, inclDeg, paDeg) {
  const L = v3.norm(center);
  const E = v3.norm(v3.cross([0, 0, 1], L));
  const N = v3.cross(L, E);
  const pa = paDeg * DEG, inc = inclDeg * DEG;
  const M = v3.add(v3.scale(N, Math.cos(pa)), v3.scale(E, Math.sin(pa)));
  const m = v3.add(v3.scale(N, -Math.sin(pa)), v3.scale(E, Math.cos(pa)));
  const Z = v3.norm(v3.add(v3.scale(L, -Math.cos(inc)), v3.scale(m, Math.sin(inc))));
  const X = v3.norm(v3.sub(M, v3.scale(Z, v3.dot(M, Z))));
  const Y = v3.cross(Z, X);
  return [X, Y, Z];
}

const VERT = /* glsl */ `
${RELATIVITY}
attribute float aTemp;
attribute float aLum;
attribute float aSize;
uniform vec3 uCenter;     // galaxy centre relative to camera (pc)
uniform mat3 uBasis;
uniform float uProj, uGain, uFade, uMaxPx;
uniform float uSplit, uLow, uScale; // blobs at least uSplit px across go to the half-resolution layer
varying vec3 vColor;
varying float vSoft;
void main() {
  vec3 rel = uCenter + uBasis * position;
  float d = max(length(rel), 1e-3);
  vec3 n = rel / d;
  float px = aSize / d * uProj;
  float I = uGain * aLum * uFade;
  I *= smoothstep(aSize * 0.5, aSize * 3.0, d);            // dissolve clouds the camera is inside
  if (px < 1.6) { I *= (px / 1.6) * (px / 1.6); px = 1.6; }  // conserve flux below one pixel
  if (px > uMaxPx) { px = uMaxPx; }
  if ((px >= uSplit) != (uLow > 0.5)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float D = dopplerRest(n);
  // where aberration squeezes the sky ahead (solid angle ÷ D²), draw 1 in D² points, each D² times
  // brighter: the same light, without hundreds of thousands of points piling onto a few pixels
  float kSq = D * D;
  if (kSq > 1.5) {
    uint hv = uint(gl_VertexID) * 2654435761u; hv ^= hv >> 15u; hv *= 2246822519u; hv ^= hv >> 13u;
    if (float(hv & 0xffffu) / 65536.0 * kSq > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  } else kSq = 1.0;
  I *= kSq;
  vec3 base = aTemp < 0.0 ? vec3(1.0, 0.32, 0.5) * 1.2 : bbColor(aTemp);
  float T0 = aTemp < 0.0 ? 6000.0 : aTemp;
  vColor = base * dopplerTint(D, T0) * I;
  vSoft = aTemp < 0.0 ? 2.5 : 3.5;
  if (I < 1e-5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_PointSize = px * 2.0 * uScale;
  gl_Position = projectionMatrix * viewMatrix * vec4(aberrate(n) * 1000.0, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vSoft;
uniform float uDust;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * vSoft);
  if (uDust > 0.5) gl_FragColor = vec4(vec3(0.05, 0.03, 0.02), a * min(vColor.r, 1.0));
  else gl_FragColor = vec4(vColor * a, 1.0);
}`;

// Nearby clouds are drawn as soft blobs up to ~100 px wide: hundreds of millions of fragments a frame.
// Blobs this wide are smooth, so the big ones go to a half-resolution layer (main.js) and look the same.
export const GALAXY_SPLIT = { value: 1e9 };   // px; 1e9 = everything at full resolution

function points(arrPos, cols, center, basis, opts) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(arrPos, 3));
  for (const [k, v] of Object.entries(cols)) geo.setAttribute(k, new THREE.Float32BufferAttribute(v, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCenter: { value: new THREE.Vector3() }, uBasis: { value: new THREE.Matrix3() },
      uProj: { value: 1000 }, uGain: { value: opts.gain }, uFade: { value: 1 }, uMaxPx: { value: 48 },
      uDust: { value: opts.dust ? 1 : 0 }, uSplit: GALAXY_SPLIT, uLow: { value: 0 }, uScale: { value: 1 }, ...REL,
    },
    vertexShader: VERT, fragmentShader: FRAG, transparent: false, depthTest: false, depthWrite: false,
    // opaque pass (drawn before planets); dust uses alpha blending spelled out as custom blending
    blending: opts.dust ? THREE.CustomBlending : THREE.AdditiveBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const [X, Y, Z] = basis;
  mat.uniforms.uBasis.value.set(X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]);
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.renderOrder = opts.dust ? -70 : -80;
  p.userData.centerPc = v3.scale(center, 1 / PC);
  // the same points again on layer 1, drawing only the big soft blobs into the half-resolution layer.
  // Its alpha keeps the dust's transmission, so the composite darkens what lies behind exactly as before.
  const low = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { ...mat.uniforms, uLow: { value: 1 }, uScale: { value: 0.5 } },
    vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: opts.dust ? THREE.SrcAlphaFactor : THREE.OneFactor, blendDst: opts.dust ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: opts.dust ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
  }));
  low.layers.set(1);
  low.frustumCulled = false;
  low.renderOrder = p.renderOrder;
  p.add(low);
  return p;
}

function finish(b, center, basis, gain) {
  const group = new THREE.Group();
  group.add(points(b.p, { aTemp: b.t, aLum: b.l, aSize: b.s }, center, basis, { gain }));
  if (b.dp.length) group.add(points(b.dp, { aTemp: b.ds.map(() => 5000), aLum: b.dl, aSize: b.ds }, center, basis, { gain: 0.6, dust: true }));
  group.userData.centerPc = v3.scale(center, 1 / PC);
  return group;
}

export function createGalaxies() {
  // --- Milky Way (Bland-Hawthorn & Gerhard 2016): Rd 2.6 kpc, bar 5 kpc at 27°, 4 arms, pitch ~12°
  const mw = GALAXIES.milkyway;
  const toSun = v3.scale(mw.center, -1);
  const Zmw = mw.pole;
  const Xmw = v3.norm(v3.sub(toSun, v3.scale(Zmw, v3.dot(toSun, Zmw))));
  const basisMW = [Xmw, v3.cross(Zmw, Xmw), Zmw];
  const bMW = new Builder();
  const r1 = rng(7);
  spiral(bMW, {
    Rd: 2600, arms: 4, pitch: 12, r0: 3200, phase: Math.PI / 4 - Math.log(8178 / 3200) / Math.tan(12 * DEG), bulgeR: 900,
    nBulge: 26000, nDisk: 90000, nArm: 120000, z0: 280, armSpread: 380, bar: true, barLen: 5000, barAngle: -27 * DEG, Rmax: 17000,
  }, r1);
  const milkyway = finish(bMW, mw.center, basisMW, 0.004);

  // --- Andromeda: photographic card at its true sky position, size and position angle
  const m31 = GALAXIES.andromeda;
  const L = v3.norm(m31.center);
  const E = v3.norm(v3.cross([0, 0, 1], L)), N = v3.cross(L, E);
  const pa = m31.pa * DEG;
  const X = v3.add(v3.scale(N, Math.cos(pa)), v3.scale(E, Math.sin(pa)));   // major axis on the sky
  const Zc = v3.scale(L, -1);                                                // card faces the Solar System
  const andromeda = createAndromedaDisk([X, v3.cross(Zc, X), Zc], v3.scale(m31.center, 1 / PC));

  return { milkyway, andromeda, ...createAndromedaSystem(basisM31()) };
}

// ---- Andromeda's surroundings, as a long exposure would record them (the eye would see only M31
// itself, the Milky Way and, barely, M33). Shown only near M31; M32 and M110 are already in the photo.
// Positions and distances: NED / McConnachie 2012.
export const M31_GROUP = [
  { key: 'm33', name: 'Triangulum Galaxy', ra: 23.4621, dec: 30.6599, kpc: 840 },
  { key: 'n185', name: 'NGC 185', ra: 9.7415, dec: 48.3374, kpc: 617 },
  { key: 'n147', name: 'NGC 147', ra: 8.3005, dec: 48.5087, kpc: 712 },
].map((g) => ({ ...g, center: v3.scale(radecToVec(g.ra, g.dec), g.kpc * 1000 * PC) }));

function basisM31() {
  const m31 = GALAXIES.andromeda;
  return externalBasis(m31.center, m31.incl, m31.pa);
}

function createAndromedaSystem(basis) {
  const r = rng(31);
  // stellar halo: bright red giants (and some blue horizontal-branch stars), density ∝ r⁻³ out to
  // ~150 kpc, slightly flattened; each is a point source (flux ∝ aLum·aSize²/d²)
  const halo = new Builder();
  for (let i = 0; i < 40000; i++) {
    const R = 2500 * Math.pow(150000 / 2500, r());
    const th = Math.acos(2 * r() - 1), ph = 2 * Math.PI * r();
    const blue = r() < 0.12;
    halo.star(R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph), R * Math.cos(th) * 0.8,
      blue ? 7500 + 2000 * r() : 3700 + 1100 * r(), 60 * Math.pow(r() + 0.02, -1.4), 1);
  }
  // globular clusters (~450, most within 30 kpc): compact fuzzy points
  for (let i = 0; i < 450; i++) {
    const R = 1500 * Math.pow(120000 / 1500, Math.pow(r(), 1.8));
    const th = Math.acos(2 * r() - 1), ph = 2 * Math.PI * r();
    halo.star(R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph), R * Math.cos(th), 5000 + 900 * r(), 50 * Math.pow(r() + 0.05, -1.2), 6);
  }
  const m31halo = finish(halo, GALAXIES.andromeda.center, basis, 1);
  const out = { m31halo };
  for (const g of M31_GROUP) {
    const b = new Builder(), rg = rng(g.ra * 100);
    if (g.key === 'm33') {
      // Triangulum: a small, loose (flocculent) spiral, i ≈ 54°, PA ≈ 22°
      spiral(b, { Rd: 1400, arms: 2, pitch: 24, r0: 400, phase: 0.6, bulgeR: 180, nBulge: 1500, nDisk: 14000, nArm: 18000,
        z0: 140, armSpread: 420, bar: false, Rmax: 9000, dust: 0.5 }, rg);
      out[g.key] = finish(b, g.center, externalBasis(g.center, 54, 22), 0.014);
    } else {
      // dwarf ellipticals
      elliptical(b, { n: 3000, Re: g.key === 'n147' ? 620 : 460, q: g.key === 'n147' ? 0.55 : 0.8, L: 1.6 }, rg);
      out[g.key] = finish(b, g.center, externalBasis(g.center, 0, g.key === 'n147' ? 25 : 45), 0.008);
    }
  }
  return out;
}

export function updateGalaxy(group, camPc, proj, fade) {
  const c = group.userData.centerPc;
  for (const p of group.children) {
    const u = p.material.uniforms;
    u.uCenter.value.set(c[0] - camPc[0], c[1] - camPc[1], c[2] - camPc[2]);
    u.uProj.value = proj;
    u.uFade.value = fade;
  }
}
export { radecToVec };
