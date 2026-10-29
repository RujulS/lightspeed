import * as THREE from 'three';
import { RELATIVITY, REL, NOISE, MESH_ABERRATION } from './shaders/common.js';
import { SUN_SURFACE } from './sky.js';
import { ROTATION, radecToVec } from './astro.js';
import { DAY, v3 } from './constants.js';
import { loadTexture } from './textures.js';

const VERT_HEAD = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${RELATIVITY}
${MESH_ABERRATION}
`;
const FRAG_HEAD = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${RELATIVITY}
`;

// ------------------------------------------------------------------------------------------ planets
const PLANET_VERT = /* glsl */ `
${VERT_HEAD}
varying vec3 vN;
varying vec3 vObj;
varying vec3 vWorld;
varying vec2 vUv;
varying float vD;
varying vec3 vLocal;
varying vec3 vC;
varying float vR;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vC = modelMatrix[3].xyz;
  vR = length(modelMatrix[0].xyz);
  vN = normalize(mat3(modelMatrix) * normal);
  vObj = mat3(modelMatrix) * position;
  vWorld = wp.xyz;
  vUv = uv;
  vLocal = position;
  vec3 ap = aberratePos(wp.xyz);
  vD = dopplerApparent(normalize(ap));
  gl_Position = projectionMatrix * viewMatrix * vec4(ap, 1.0);
  #include <logdepthbuf_vertex>
}`;

const PLANET_FRAG = /* glsl */ `
${FRAG_HEAD}
${NOISE}
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uSpec;
uniform sampler2D uNormal;
uniform sampler2D uRingTex;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAtmo;
uniform float uAtmoStrength;
uniform vec3 uPole;
uniform vec2 uRing;          // inner, outer radius in planet radii (0 = none)
uniform int uProc;           // 0 textured, 1 Pluto, 2 rocky exoplanet, 3 hazy moon (Titan)
uniform vec3 uTint;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vWorld;
varying vec2 vUv;
varying float vD;
varying vec3 vLocal;
varying vec3 vC;
varying float vR;

vec3 perturb(vec3 p, vec3 n, vec2 uv, vec3 m) {
  vec3 q0 = dFdx(p), q1 = dFdy(p);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, n), q0p = cross(n, q0);
  vec3 T = q1p * st0.x + q0p * st1.x, B = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(T * m.x * s + B * m.y * s + n * m.z);
}

vec3 proceduralAlbedo(vec3 p) {
  if (uProc == 3) return uTint * (0.92 + 0.08 * fbm(vec3(p.x * 2.0, p.y * 9.0, p.z * 2.0)));
  if (uProc == 1) { // Pluto: tholin-red Cthulhu Macula, nitrogen-ice Sputnik Planitia (the "heart")
    float n = fbm(p * 3.0) * 0.5 + 0.5;
    vec3 base = mix(vec3(0.62, 0.50, 0.40), vec3(0.85, 0.78, 0.68), n);
    float lat = asin(p.y), lon = atan(p.z, -p.x);
    float dark = smoothstep(0.35, -0.05, abs(lat + 0.05)) * smoothstep(0.2, 0.6, fbm(p * 2.0 + 3.0) * 0.5 + 0.6);
    base = mix(base, vec3(0.30, 0.15, 0.09), dark * 0.85 * step(0.0, -sin(lon)));
    float heart = smoothstep(0.55, 0.25, length(vec2(lon - 3.0, lat - 0.35) * vec2(0.8, 1.2)) + fbm(p * 6.0) * 0.12);
    return mix(base, vec3(0.95, 0.93, 0.9), heart);
  }
  // rocky exoplanet (artist's impression): basalt plains, highlands, ice toward the poles
  float h = fbm(p * 2.5) + 0.35 * fbm(p * 9.0);
  vec3 rock = mix(vec3(0.20, 0.17, 0.15), vec3(0.48, 0.38, 0.30), smoothstep(-0.4, 0.6, h));
  float ice = smoothstep(0.55, 0.8, abs(p.y) + 0.15 * fbm(p * 5.0));
  vec3 col = mix(rock, vec3(0.86, 0.9, 0.95), ice);
  float sea = smoothstep(0.02, -0.08, h - 0.0);
  return mix(col, vec3(0.03, 0.06, 0.1), sea * (1.0 - ice));
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vN);
  vec3 V = normalize(-vWorld);
  vec3 L = normalize(uSunDir);
  vec3 albedo = uProc == 0 ? texture2D(uDay, vUv).rgb * uTint : proceduralAlbedo(normalize(vLocal));
  #ifdef EARTH
    vec3 mN = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    N = perturb(vObj, N, vUv, normalize(vec3(mN.xy * 1.2, mN.z)));
  #endif
  float NdL = dot(N, L);
  float lit = smoothstep(-0.06, 0.18, NdL) * max(NdL, 0.0) + 0.0;
  // shadow of the rings on the planet
  float ringShadow = 1.0;
  if (uRing.y > 0.0) {
    vec3 q = (vWorld - vC) / vR;
    float lp = dot(L, uPole);
    if (abs(lp) > 1e-4) {
      float t = -dot(q, uPole) / lp;
      if (t > 0.0) {
        float r = length(q + t * L);
        if (r > uRing.x && r < uRing.y) ringShadow = 1.0 - 0.85 * texture2D(uRingTex, vec2((r - uRing.x) / (uRing.y - uRing.x), 0.5)).a;
      }
    }
  }
  vec3 col = albedo * uSunColor * lit * ringShadow * 1.05;
  #ifdef EARTH
    float ocean = texture2D(uSpec, vUv).r;
    vec3 H = normalize(L + V);
    col += uSunColor * ocean * pow(max(dot(N, H), 0.0), 80.0) * 2.5 * step(0.0, NdL);
    vec3 night = texture2D(uNight, vUv).rgb;
    col += night * vec3(1.0, 0.8, 0.55) * 1.6 * smoothstep(0.05, -0.2, NdL);
  #endif
  // limb scattering
  float fres = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0);
  col += uAtmo * uAtmoStrength * fres * smoothstep(-0.25, 0.5, dot(normalize(vN), L)) * uSunColor;
  col *= dopplerTint(vD, 5800.0);
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_FRAG = /* glsl */ `
${FRAG_HEAD}
uniform sampler2D uDay;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vWorld;
varying vec2 vUv;
varying float vD;
varying vec3 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  float a = texture2D(uDay, vUv).r;
  float NdL = dot(normalize(vN), normalize(uSunDir));
  vec3 col = vec3(1.0) * uSunColor * smoothstep(-0.1, 0.25, NdL) * max(NdL, 0.03) * 1.6;
  gl_FragColor = vec4(col * dopplerTint(vD, 5800.0), a * 0.95);
}`;

const ATMO_FRAG = /* glsl */ `
${FRAG_HEAD}
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAtmo;
uniform float uAtmoStrength;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vWorld;
varying vec2 vUv;
varying float vD;
varying vec3 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vN);
  vec3 V = normalize(-vWorld);
  float rim = pow(clamp(1.0 + dot(N, V) * 1.15, 0.0, 1.0), 2.5);  // back faces: brightest at the limb
  float light = smoothstep(-0.4, 0.5, dot(N, normalize(uSunDir)));
  vec3 col = uAtmo * uSunColor * rim * light * uAtmoStrength * 1.6;
  gl_FragColor = vec4(col * dopplerTint(vD, 5800.0), 1.0);
}`;

const RING_VERT = /* glsl */ `
${VERT_HEAD}
varying vec3 vWorld;
varying vec3 vLocal;
varying float vD;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLocal = position;
  vec3 ap = aberratePos(wp.xyz);
  vD = dopplerApparent(normalize(ap));
  gl_Position = projectionMatrix * viewMatrix * vec4(ap, 1.0);
  #include <logdepthbuf_vertex>
}`;
const RING_FRAG = /* glsl */ `
${FRAG_HEAD}
uniform sampler2D uRingTex;
uniform vec2 uRing;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uPlanetC;
uniform float uPlanetR;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vD;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vLocal.xy);
  vec4 t = texture2D(uRingTex, vec2((r - uRing.x) / (uRing.y - uRing.x), 0.5));
  vec3 L = normalize(uSunDir);
  vec3 q = (vWorld - uPlanetC) / uPlanetR;
  float b = dot(q, L), c = dot(q, q) - 1.0;
  float sh = (b * b - c > 0.0 && -b - sqrt(b * b - c) > 0.0) ? 0.04 : 1.0;  // planet's shadow on the rings
  vec3 col = t.rgb * uSunColor * sh * 1.35;
  gl_FragColor = vec4(col * dopplerTint(vD, 5800.0), t.a);
}`;

const PLANET_LOOK = {
  mercury: { map: '8k_mercury.jpg', atmo: [0, 0, 0], s: 0 },
  venus: { map: '4k_venus_atmosphere.jpg', atmo: [0.95, 0.8, 0.55], s: 0.55 },
  earth: { map: '8k_earth_daymap.jpg', atmo: [0.3, 0.55, 1.0], s: 1.0, earth: true },
  moon: { map: '8k_moon.jpg', atmo: [0, 0, 0], s: 0 },
  mars: { map: '8k_mars.jpg', atmo: [0.85, 0.55, 0.4], s: 0.25 },
  jupiter: { map: '8k_jupiter.jpg', atmo: [0.8, 0.72, 0.6], s: 0.25 },
  saturn: { map: '8k_saturn.jpg', atmo: [0.85, 0.75, 0.55], s: 0.25, ring: [74500e3, 140220e3] },
  uranus: { map: '2k_uranus.jpg', atmo: [0.55, 0.85, 0.95], s: 0.5 },
  neptune: { map: '2k_neptune.jpg', atmo: [0.35, 0.55, 1.0], s: 0.6 },
  pluto: { proc: 1, atmo: [0.5, 0.6, 0.9], s: 0.08 },
  proximab: { proc: 2, atmo: [0.55, 0.65, 1.0], s: 0.35 },
};

const texCache = {};
const texWhen = {};
let texLoaded = 0;
/** [maps loaded, maps requested] */
export const textureProgress = () => [texLoaded, Object.keys(texCache).length];
function tex(name, srgb = true, priority = 'low') {
  if (!texCache[name]) {
    let done;
    texWhen[name] = new Promise((r) => (done = r));
    texCache[name] = loadTexture('textures/' + name, { srgb, priority, done: () => { texLoaded++; done(); } });
  }
  return texCache[name];
}
// maps each planet uses; the data maps (not colours) are loaded without sRGB decoding
const DATA_MAPS = new Set(['earth_specular.jpg', 'earth_normal.png', '8k_earth_clouds.jpg']);
function mapsOf(look) {
  return [look.map, ...(look.earth ? ['8k_earth_nightmap.jpg', ...DATA_MAPS] : []), ...(look.ring ? ['8k_saturn_ring_alpha.png'] : [])].filter(Boolean);
}
/** Start every planet map downloading at once, the first planet's ahead of the rest. */
export function preloadTextures(first) {
  for (const name of mapsOf(PLANET_LOOK[first])) tex(name, !DATA_MAPS.has(name), 'high');
  for (const look of Object.values(PLANET_LOOK)) for (const name of mapsOf(look)) tex(name, !DATA_MAPS.has(name));
  tex('8k_sun.jpg');
}
const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
blank.needsUpdate = true;

const SPHERE = new THREE.SphereGeometry(1, 160, 80);
const SPHERE_LO = new THREE.SphereGeometry(1, 64, 32); // moons: small on screen

function poleFrame(id) {
  const r = ROTATION[id];
  const p = r ? radecToVec(r[0], r[1]) : [0, 0, 1];
  let q = v3.cross([0, 0, 1], p);
  if (v3.len(q) < 1e-6) q = [1, 0, 0];
  q = v3.norm(q);
  const z = v3.cross(q, p);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...q), new THREE.Vector3(...p), new THREE.Vector3(...z));
  return { quat: new THREE.Quaternion().setFromRotationMatrix(m), pole: new THREE.Vector3(...p) };
}

export class Planet {
  /** look: for bodies not in PLANET_LOOK (moons): { map, tint, proc, atmo, s, lo (low-poly) } */
  constructor(id, radius, look = PLANET_LOOK[id]) {
    this.id = id; this.radius = radius;
    this.root = new THREE.Object3D();
    this.tilt = new THREE.Object3D();
    this.root.add(this.tilt);
    const { quat, pole } = poleFrame(id);
    this.tilt.quaternion.copy(quat);
    this.pole = pole;
    const uniforms = {
      uDay: { value: look.map ? tex(look.map) : blank },
      uNight: { value: look.earth ? tex('8k_earth_nightmap.jpg') : blank },
      uSpec: { value: look.earth ? tex('earth_specular.jpg', false) : blank },
      uNormal: { value: look.earth ? tex('earth_normal.png', false) : blank },
      uRingTex: { value: look.ring ? tex('8k_saturn_ring_alpha.png') : blank },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uAtmo: { value: new THREE.Color(...look.atmo) },
      uAtmoStrength: { value: look.s },
      uPole: { value: pole },
      uRing: { value: new THREE.Vector2(look.ring ? look.ring[0] / radius : 0, look.ring ? look.ring[1] / radius : 0) },
      uProc: { value: look.proc || 0 },
      uTint: { value: new THREE.Color(...(look.tint || [1, 1, 1])) },
      ...REL,
    };
    this.uniforms = uniforms;
    // true once every map this planet uses has arrived (the menu waits for it before showing the planet)
    this.ready = false;
    Promise.all(mapsOf(look).map((n) => (tex(n, !DATA_MAPS.has(n)), texWhen[n]))).then(() => { this.ready = true; });
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG, defines: look.earth ? { EARTH: 1 } : {} });
    const sphere = look.lo ? SPHERE_LO : SPHERE;
    this.mesh = new THREE.Mesh(sphere, mat);
    this.tilt.add(this.mesh);
    if (look.earth) {
      const cm = new THREE.ShaderMaterial({
        uniforms: { uDay: { value: tex('8k_earth_clouds.jpg', false) }, uSunDir: uniforms.uSunDir, uSunColor: uniforms.uSunColor, ...REL },
        vertexShader: PLANET_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
      });
      this.clouds = new THREE.Mesh(SPHERE, cm);
      this.clouds.scale.setScalar(1.006);
      this.tilt.add(this.clouds);
    }
    if (look.s > 0) {
      const am = new THREE.ShaderMaterial({
        uniforms: { uSunDir: uniforms.uSunDir, uSunColor: uniforms.uSunColor, uAtmo: uniforms.uAtmo, uAtmoStrength: uniforms.uAtmoStrength, ...REL },
        vertexShader: PLANET_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.atmo = new THREE.Mesh(sphere, am);
      this.atmo.scale.setScalar(look.earth ? 1.035 : 1.025);
      this.tilt.add(this.atmo);
    }
    if (look.ring) {
      const [ri, ro] = [look.ring[0] / radius, look.ring[1] / radius];
      const rm = new THREE.ShaderMaterial({
        uniforms: {
          uRingTex: uniforms.uRingTex, uRing: { value: new THREE.Vector2(ri, ro) }, uSunDir: uniforms.uSunDir,
          uSunColor: uniforms.uSunColor, uPlanetC: { value: new THREE.Vector3() }, uPlanetR: { value: 1 }, ...REL,
        },
        vertexShader: RING_VERT, fragmentShader: RING_FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false,
      });
      this.ring = new THREE.Mesh(new THREE.RingGeometry(ri, ro, 512, 1), rm);
      this.ring.rotation.x = -Math.PI / 2;
      this.tilt.add(this.ring);
    }
  }

  update(simT, sunDir, sunColor) {
    const r = ROTATION[this.id];
    if (r) {
      const W = ((r[2] + r[3] * (simT / DAY)) % 360) * Math.PI / 180;
      this.mesh.rotation.y = W;
      if (this.clouds) this.clouds.rotation.y = W * 1.0 + (simT / DAY) * 0.002;
    }
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uSunColor.value.copy(sunColor);
    if (this.ring) {
      this.ring.material.uniforms.uPlanetC.value.copy(this.root.position);
      this.ring.material.uniforms.uPlanetR.value = this.root.scale.x;
    }
  }
}

// ------------------------------------------------------------------------------------------- stars
const STAR_FRAG = /* glsl */ `
${FRAG_HEAD}
${NOISE}
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uTemp;
uniform float uBright;
uniform float uTime;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vWorld;
varying vec2 vUv;
varying float vD;
varying vec3 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vN), V = normalize(-vWorld);
  float mu = max(dot(N, V), 0.0);
  vec3 p = normalize(vLocal);
  // granulation + supergranulation, slowly evolving
  float g = snoise(p * 60.0 + vec3(0.0, uTime * 0.02, 0.0)) * 0.5 + snoise(p * 160.0 - uTime * 0.05) * 0.25;
  float spots = smoothstep(0.62, 0.75, snoise(p * 3.0 + uTime * 0.002));
  float tex = uHasMap > 0.5 ? texture2D(uMap, vUv).r * 1.3 : 1.0;
  float I = (0.85 + 0.15 * g) * tex * (1.0 - 0.75 * spots);
  float limb = 1.0 - 0.62 * (1.0 - mu) - 0.2 * (1.0 - mu) * (1.0 - mu);   // solar limb darkening
  float T = uTemp * (0.92 + 0.08 * limb);
  vec3 col = planckRGB(vD * T) / lum(planckRGB(uTemp)) * I * limb * uBright;
  gl_FragColor = vec4(col, 1.0);
}`;

const GLARE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${RELATIVITY}
${MESH_ABERRATION}
uniform float uSize;
uniform float uTemp;
uniform float uIntensity;
varying vec3 vColor;
void main() {
  vec4 wp = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 ap = aberratePos(wp.xyz);
  float D = dopplerApparent(normalize(ap));
  vec3 rgb = planckRGB(D * uTemp) / lum(planckRGB(uTemp));
  float boost = lum(rgb);
  vColor = rgb / max(boost, 1e-30) * min(uIntensity * pow(boost, 0.5), 400.0);
  gl_PointSize = uSize * clamp(pow(boost, 0.25), 0.3, 4.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(ap, 1.0);
  #include <logdepthbuf_vertex>
}`;
const GLARE_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  // as a camera records a very bright star: a hot core, a soft photographic falloff and six thin
  // diffraction spikes (a six-bladed aperture), all fading out at the sprite's edge
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  float edge = pow(1.0 - r, 2.0);
  float core = exp(-r * r * 60.0);
  float halo = (0.22 * exp(-r * 14.0) + 0.05 * exp(-r * 4.5)) * edge;
  float a = atan(c.y, c.x) + 0.26, spikes = 0.0;
  for (int k = 0; k < 3; k++) spikes += exp(-abs(r * sin(a - float(k) * 1.0472)) * 260.0);
  spikes *= 0.16 * edge * smoothstep(0.0, 0.04, r);
  gl_FragColor = vec4(vColor * (core + halo + spikes), 1.0);
}`;

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The corona, as a coronagraph or an eclipse shows it: streamers out to ~4 solar radii, fading roughly
// as r^-2.6. A camera-facing quad around the star; drawn only once the disk is resolved.
const CORONA_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${RELATIVITY}
${MESH_ABERRATION}
uniform float uR;
varying vec2 vC;
void main() {
  vC = position.xy * 4.0;                         // in stellar radii
  vec4 wp = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 mv = viewMatrix * vec4(aberratePos(wp.xyz), 1.0);
  mv.xy += vC * uR;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const CORONA_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE}
uniform float uI;
varying vec2 vC;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vC);
  if (r < 1.0 || r > 4.0) discard;
  vec2 d = vC / r;
  float streamers = 0.55 + 0.3 * snoise(vec3(d * 2.5, 1.7)) + 0.15 * snoise(vec3(d * 9.0, 4.2 + r * 0.3));
  float k = pow(r, -2.6) * max(streamers, 0.0) * smoothstep(4.0, 2.4, r);
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * k * uI, 1.0);
}`;

export class Star {
  /** temp K, radius m, absMag (V) */
  constructor({ temp, radius, absMag, map }) {
    this.temp = temp; this.radius = radius; this.absMag = absMag;
    this.root = new THREE.Object3D();
    const uniforms = {
      uMap: { value: map ? tex(map) : blank }, uHasMap: { value: map ? 1 : 0 }, uTemp: { value: temp },
      uBright: { value: SUN_SURFACE }, uTime: { value: 0 }, ...REL,
    };
    this.uniforms = uniforms;
    this.mesh = new THREE.Mesh(SPHERE, new THREE.ShaderMaterial({ uniforms, vertexShader: PLANET_VERT, fragmentShader: STAR_FRAG }));
    this.root.add(this.mesh);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    this.glareU = { uSize: { value: 10 }, uTemp: { value: temp }, uIntensity: { value: 1 }, ...REL };
    this.glare = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.glareU, vertexShader: GLARE_VERT, fragmentShader: GLARE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.glare.frustumCulled = false;
    this.root.add(this.glare);
    if (map) {
      this.coronaU = { uR: { value: 1 }, uI: { value: 0 }, ...REL };
      this.corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: this.coronaU, vertexShader: CORONA_VERT, fragmentShader: CORONA_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      this.corona.frustumCulled = false;
      this.root.add(this.corona);
    }
    this.color = new THREE.Color();
    const c = bbColorJS(temp);
    this.color.setRGB(c[0], c[1], c[2]);
  }

  /** distM: true distance to camera, pxPerRad: screen pixels per radian */
  update(simT, distM, pxPerRad, dpr) {
    this.uniforms.uTime.value = (simT % 1e6);
    const dPc = distM / 3.0856775814913673e16;
    const m = this.absMag + 5 * Math.log10(Math.max(dPc, 1e-12)) - 5;
    const I = 1.1 * Math.sqrt(Math.pow(10, -0.4 * m));
    const angR = (this.radius / distM) * pxPerRad;   // disk radius in px
    this.mesh.visible = angR > 0.3;
    // glare sized by apparent brightness: ~240 px across for the Sun seen from Earth (m = −26.7),
    // larger closer in, shrinking to a star-like point as it fades (from Pluto, m ≈ −19: ~40 px)
    // …and for stars a fixed photographic scale on top, so the brightest-looking ones (m ≈ −1 … −6) carry
    // a visible glow and spikes: ~6 px at m = −1, ~29 px at m = −4.4, at most 60 px
    const R = Math.max(4, Math.min(420, Math.max(120 * Math.pow(10, -0.1 * (m + 26.74)), 6 * Math.pow(10, -0.2 * (Math.max(m, -6) + 1)))));
    const size = Math.min(Math.max(2 * R, angR * 6), this.maxGlare || 1e9);
    this.glareU.uSize.value = size * dpr;
    this.glareU.uIntensity.value = angR > 2 ? Math.min(I, 30) * 0.35 : Math.min(I, 300);
    if (this.corona) {
      this.coronaU.uR.value = this.root.scale.x;         // the drawn radius (place() may have shrunk it)
      this.coronaU.uI.value = 1.6 * smoothstep(8, 40, angR);
      this.corona.visible = this.coronaU.uI.value > 0.001;
    }
  }
}

export function bbColorJS(T) {
  const lam = [0.61, 0.55, 0.465];
  const b = lam.map((l) => 1 / (l ** 5 * (Math.exp(Math.min(14387.77 / (l * T), 85)) - 1)));
  const L = 0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2];
  return b.map((x) => x / L);
}

// ------------------------------------------------------------------------------------- orbit lines
export function createOrbitLine(fn, period, t0, color, n = 720) {
  const pts = new Float32Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) {
    const p = fn(t0 + (period * i) / n);
    pts.set(p, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
  line.frustumCulled = false;
  return line;
}
