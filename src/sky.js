import * as THREE from 'three';
import { RELATIVITY, REL } from './shaders/common.js';

// Brightness scale shared by everything self-luminous: a star's photosphere renders at SUN_SURFACE.
export const SUN_SURFACE = 14.0;

// ------------------------------------------------------------------------------------------------
// Milky Way background (NASA SVS Deep Star Maps 2020, stars removed) — valid near the Sun only.
// Also carries the cosmic microwave background, which Doppler-shifts into view at extreme speed.
// ------------------------------------------------------------------------------------------------
export function createPanorama(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture }, uGain: { value: 1 }, uSunSurface: { value: SUN_SURFACE }, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uEclN: { value: new THREE.Vector3(0, 0, 1) }, uZodi: { value: 0 }, ...REL },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(position * 1000.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${RELATIVITY}
      uniform sampler2D uMap;
      uniform float uGain, uSunSurface, uZodi;
      uniform vec3 uSunDir, uEclN;   // toward the Sun from the camera; ecliptic north (world)
      varying vec3 vDir;
      // Zodiacal light: sunlight scattered by the dust between the planets. Brightest toward the Sun,
      // concentrated along the ecliptic, with the faint gegenschein straight opposite the Sun (a simple
      // fit to the measured shape; uZodi carries the fall-off with distance from the Sun).
      vec3 zodiacal(vec3 n) {
        float ce = clamp(dot(n, uSunDir), -1.0, 1.0), e = acos(ce);
        float sb = abs(dot(n, uEclN));                     // |sin(ecliptic latitude)|
        float band = exp(-sb / mix(0.22, 0.5, smoothstep(1.2, 0.3, e)));   // fatter near the Sun
        float I = band * pow(max(sin(e), 0.08), -2.3) * smoothstep(0.08, 0.35, e);
        I += 0.35 * exp(-pow((3.14159 - e) / 0.18, 2.0)) * exp(-sb / 0.12);   // gegenschein
        return vec3(1.0, 0.92, 0.8) * I * uZodi;
      }
      const float PI = 3.141592653589793;
      void main() {
        vec3 np = normalize(vDir);
        vec3 n = unaberrate(np);
        float D = dopplerApparent(np);
        float ra = atan(n.y, n.x);
        float dec = asin(clamp(n.z, -1.0, 1.0));
        vec2 uv = vec2(fract(0.5 - ra / (2.0 * PI)), 0.5 + dec / PI);
        vec2 uvAlt = vec2(fract(uv.x + 0.5) - 0.5, uv.y);   // seam-free derivatives
        vec2 dx = dFdx(uv), dy = dFdy(uv), dxa = dFdx(uvAlt), dya = dFdy(uvAlt);
        if (dot(dxa, dxa) < dot(dx, dx)) dx = dxa;
        if (dot(dya, dya) < dot(dy, dy)) dy = dya;
        vec3 col = textureGrad(uMap, uv, dx, dy).rgb * uGain * 0.1 + zodiacal(n);
        if (uBeta > 1e-4) {
          col *= dopplerTint(D, 6000.0);
          // CMB: 2.725 K blackbody, shifted to temperature D·2.725 K, scaled relative to the Sun's surface
          col += planckRGB(2.725 * D) / planckRGB(5772.0).g * uSunSurface;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

// ------------------------------------------------------------------------------------------------
// HYG v4.1 star catalogue: 109k real stars at their real 3D positions (parsecs).
// Apparent magnitude is recomputed from the camera position every frame, so parallax,
// fading with distance, aberration and Doppler colour/brightness are all physical.
// ------------------------------------------------------------------------------------------------
export function createStarfield(buffer, excludePc = []) {
  const f = new Float32Array(buffer);
  const n = f.length / 5;
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), temp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = f[i * 5]; pos[i * 3 + 1] = f[i * 5 + 1]; pos[i * 3 + 2] = f[i * 5 + 2];
    mag[i] = f[i * 5 + 3]; temp[i] = f[i * 5 + 4];
    // stars rendered as real bodies elsewhere (Sun, Proxima) are removed from the point cloud
    for (const e of excludePc) {
      if (Math.hypot(pos[i * 3] - e[0], pos[i * 3 + 1] - e[1], pos[i * 3 + 2] - e[2]) < 0.002) mag[i] = 99;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  geo.setAttribute('aTemp', new THREE.BufferAttribute(temp, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCamPc: { value: new THREE.Vector3() }, uPx: { value: 2.0 }, uGain: { value: 1.0 }, ...REL },
    vertexShader: /* glsl */ `
      ${RELATIVITY}
      attribute float aMag;
      attribute float aTemp;
      uniform vec3 uCamPc;
      uniform float uPx, uGain;
      varying vec3 vColor;
      void main() {
        vec3 rel = position - uCamPc;
        float d = max(length(rel), 1e-7);
        vec3 n = rel / d;
        float m = aMag + 5.0 * log(d) / log(10.0) - 5.0;
        float flux = pow(10.0, -0.4 * m);                 // 1.0 at magnitude 0
        float D = dopplerRest(n);
        // where aberration squeezes the sky ahead (solid angle ÷ D²), draw 1 in D² points, each D² times
        // brighter: the same light, without hundreds of thousands of points piling onto a few pixels
        float kSq = D * D;
        if (kSq > 1.5) {
          uint hv = uint(gl_VertexID) * 2654435761u; hv ^= hv >> 15u; hv *= 2246822519u; hv ^= hv >> 13u;
          if (float(hv & 0xffffu) / 65536.0 * kSq > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        } else kSq = 1.0;
        // observed spectrum of a blackbody of temperature T seen with Doppler factor D is a blackbody at D·T
        vec3 rgb = planckRGB(D * aTemp) / lum(planckRGB(aTemp)) * flux;
        rgb *= kSq;
        float F = lum(rgb);
        float I = uGain * 1.1 * pow(max(F, 0.0), 0.5);     // perceptual compression (eye/camera response)
        if (I < 0.004 || aMag > 50.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        vColor = rgb / max(F, 1e-30) * min(I, 80.0);
        gl_PointSize = clamp(uPx * (1.0 + 0.55 * log(1.0 + I)), uPx, 48.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(aberrate(n) * 1000.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 6.0) + 0.08 * exp(-r2 * 1.5) * (1.0 - r2);
        gl_FragColor = vec4(vColor * a, 1.0);
      }`,
    // transparent:false keeps the stars in the opaque pass, ordered (renderOrder) before the planets;
    // in the transparent pass they would be drawn on top of every planet.
    transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -90;
  return pts;
}
