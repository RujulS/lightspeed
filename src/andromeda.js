import * as THREE from 'three';
import { loadTexture } from './textures.js';
import { RELATIVITY, REL } from './shaders/common.js';

// Andromeda (M31) as a photographic "galaxy card": a real ground-based image (Adam Evans, CC BY 2.0)
// with the foreground Milky Way stars removed and the sky subtracted, mounted in 3-D at M31's true
// position, real angular size (~3.9° across the frame at 765 kpc) and position angle (38°), facing
// the Solar System. Ships arrive along the Earth–M31 line, so on arrival they see it from almost
// exactly the angle of the photograph.

const WIDTH_PC = 52000, HEIGHT_PC = 26000;

const VERT = /* glsl */ `
${RELATIVITY}
uniform vec3 uCenter;
uniform mat3 uBasis;
varying vec2 vUv;
varying float vD;
varying float vNear;
void main() {
  vUv = uv;
  vec3 rel = uCenter + uBasis * vec3(position.xy, 0.0);
  float d = max(length(rel), 1e-3);
  vec3 n = rel / d;
  vD = dopplerRest(n);
  vNear = smoothstep(800.0, 6000.0, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(aberrate(n) * 1000.0, 1.0);
}`;
const FRAG = /* glsl */ `
${RELATIVITY}
uniform sampler2D uMap;
uniform float uGain, uFade;
varying vec2 vUv;
varying float vD;
varying float vNear;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(c * uGain * uFade * vNear * dopplerTint(vD, 5200.0), 1.0);
}`;

let TEX = null;
function texture() {
  if (!TEX) {
    TEX = loadTexture('textures/m31_card.jpg');
  }
  return TEX;
}

/** basis: [X (image right), Y (image up), Z (toward the viewer)] in world coordinates. */
export function createAndromedaDisk(basis, centerPc) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture() }, uCenter: { value: new THREE.Vector3() }, uBasis: { value: new THREE.Matrix3() },
      uGain: { value: 1.5 }, uFade: { value: 1 }, uProj: { value: 1 }, ...REL,
    },
    vertexShader: VERT, fragmentShader: FRAG,
    // opaque pass so it is drawn before (behind) planets and ships
    transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH_PC, HEIGHT_PC, 48, 24), mat);
  card.frustumCulled = false;
  card.renderOrder = -77;
  const g = new THREE.Group();
  g.add(card);
  setDiskBasis(g, basis);
  g.userData.centerPc = centerPc;
  return g;
}

export function setDiskBasis(g, [X, Y, Z]) {
  for (const c of g.children) c.material.uniforms.uBasis?.value.set(X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]);
}
