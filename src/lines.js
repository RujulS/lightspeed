import * as THREE from 'three';
import { RELATIVITY, MESH_ABERRATION, REL } from './shaders/common.js';

// Faint guide lines (planet and moon orbits, the flight path). Points are kept in world metres as
// doubles and rewritten camera-relative every frame, so a line passing right beside the camera stays
// steady even 10¹² m from the Sun; the vertex shader applies the same aberration as the bodies.

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${RELATIVITY}
${MESH_ABERRATION}
uniform vec3 uColor;
varying vec3 vCol;
#ifdef DOTTED
  attribute float aIdx; // vertex index: each segment between two vertices draws one dot
  varying float vIdx;
#endif
void main() {
  #ifdef DOTTED
    vIdx = aIdx;
  #endif
  #ifdef USE_COLOR
    vCol = uColor * color;
  #else
    vCol = uColor;
  #endif
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(aberratePos(wp.xyz), 1.0);
  #include <logdepthbuf_vertex>
}`;
const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uOpacity;
varying vec3 vCol;
#ifdef DOTTED
  varying float vIdx;
#endif
void main() {
  #include <logdepthbuf_fragment>
  #ifdef DOTTED
    if (fract(vIdx) > 0.4) discard;
  #endif
  gl_FragColor = vec4(vCol, uOpacity);
}`;

export function lineMaterial(color, opacity, vertexColors = false, dotted = false) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, ...REL },
    vertexShader: VERT, fragmentShader: FRAG, vertexColors, transparent: true, depthWrite: false,
    defines: dotted ? { DOTTED: 1 } : {},
  });
}
/** Dotted lines need each vertex's index (see the shader). */
export function addDotIndex(geo, n) {
  geo.setAttribute('aIdx', new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1));
}

/** A line through n world points (Float64Array, xyz…), redrawn relative to the camera with rebase(). */
export class WorldLine {
  constructor(n, color, opacity, { loop = false, vertexColors = false, dotted = false } = {}) {
    this.world = new Float64Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    if (vertexColors) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    if (dotted) addDotIndex(g, n);
    this.geo = g;
    this.line = new (loop ? THREE.LineLoop : THREE.Line)(g, lineMaterial(color, opacity, vertexColors, dotted));
    this.line.frustumCulled = false;
    this.count = n;
  }
  /** world point i → (p − foc) − off, for the first `count` points (relative to an origin, if given) */
  rebase(foc, off, origin = null, count = this.count) {
    const W = this.world, P = this.geo.attributes.position.array;
    const ox = (origin ? origin[0] : 0) - foc[0], oy = (origin ? origin[1] : 0) - foc[1], oz = (origin ? origin[2] : 0) - foc[2];
    for (let i = 0; i < count * 3; i += 3) {
      P[i] = (W[i] + ox) - off[0]; P[i + 1] = (W[i + 1] + oy) - off[1]; P[i + 2] = (W[i + 2] + oz) - off[2];
    }
    this.geo.setDrawRange(0, count);
    this.geo.attributes.position.needsUpdate = true;
  }
  set opacity(v) { this.line.material.uniforms.uOpacity.value = v; }
}
