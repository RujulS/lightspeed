import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Gravitational lensing by a black hole, applied to the rendered scene.
// Far away: thin-lens deflection — weak-field series 2Rs/b + (15π/16)(Rs/b)² blended with Bozza's
// strong-deflection limit −ln(b/b_c − 1) − 0.40 (b_c = 3√3/2 · Rs).
// Close up (uRay = 1): every pixel's photon is traced backwards through the spacetime of a spinning
// (Kerr) black hole, so the shadow is flattened on the side spinning toward you, light is dragged
// round with the spin, and the accretion disk is seen above, below and wrapped over the top of the
// hole. Integration (our own, from the standard Kerr null-geodesic equations): Mino time, inverse
// radius w = 1/r (escape is exactly w = 0), the polar/azimuthal motion as a point on the unit sphere
// plus a separate frame-dragging angle about the spin axis (no pole singularity), 4th-order
// Runge–Kutta–Nyström steps sized by how fast the ray turns. Units: G = c = M = 1.
// The disk: Novikov–Thorne thin disk from the innermost stable orbit, Page–Thorne temperature
// profile, and each crossing glows as a blackbody at g·T, where g combines the Doppler shift of the
// orbiting gas with gravitational redshift, so the approaching side is brighter and bluer.
const LensShader = {
  uniforms: {
    tDiffuse: { value: null }, tSky: { value: null }, uActive: { value: 0 },
    uBH: { value: new THREE.Vector3(0, 0, -1) }, uRs: { value: 1 }, uDist: { value: 1 },
    uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
    uCamRot: { value: new THREE.Matrix3() }, uViewRot: { value: new THREE.Matrix3() }, uSkyGain: { value: 0.22 },
    uRay: { value: 0 }, uCamBH: { value: new THREE.Vector3() }, uDiskN: { value: new THREE.Vector3(0, 0, 1) },
    uDiskGain: { value: 6.0 }, uTime: { value: 0 }, uBgGain: { value: 2.0 },
    uSpin: { value: 0.9 }, uSpinX: { value: new THREE.Vector3(1, 0, 0) }, uDisk: { value: 1 },
    uIsco: { value: 6 }, uDiskOut: { value: 24 }, uPeakT: { value: 6000 },
    uPT0: { value: new THREE.Vector4() }, uPT1: { value: new THREE.Vector4() },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tSky;
    uniform float uActive, uRs, uDist, uSkyGain, uRay, uDiskGain, uTime;
    uniform vec3 uBH, uCamBH, uDiskN, uSpinX;
    uniform float uSpin, uDisk, uIsco, uDiskOut, uPeakT, uBgGain;
    uniform vec4 uPT0, uPT1;   // Page–Thorne: x0 x1 x2 x3 (√r of ISCO and roots), c1 c2 c3, 1/max flux
    uniform mat4 uInvProj, uProj;
    uniform mat3 uCamRot, uViewRot;
    varying vec2 vUv;
    const float PI = 3.141592653589793;
    vec3 sky(vec3 dView) {
      vec3 n = normalize(uCamRot * dView);
      float ra = atan(n.y, n.x), dec = asin(clamp(n.z, -1.0, 1.0));
      return texture2D(tSky, vec2(fract(0.5 - ra / (2.0 * PI)), 0.5 + dec / PI)).rgb * uSkyGain;
    }
    // what lies in view-space direction d: the rendered frame if on screen, else the sky map
    vec3 background(vec3 d) {
      vec4 clip = uProj * vec4(d * 1000.0, 1.0);
      if (clip.w > 0.0) {
        vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) return texture2D(tDiffuse, uv).rgb;
      }
      return sky(d);
    }
    // the same, filtered by how much the lens squeezes the sky into each pixel: near the Einstein ring a
    // pixel covers many pixels of the unlensed frame, and point-sampling them there makes moiré rings.
    // Must be called in uniform control flow (it uses screen-space derivatives).
    vec3 backgroundFiltered(vec3 d) {
      vec4 clip = uProj * vec4(d * 1000.0, 1.0);
      vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
      vec2 res = vec2(textureSize(tDiffuse, 0));
      vec2 gx = dFdx(uv), gy = dFdy(uv);
      float fp = max(length(gx * res), length(gy * res));
      bool onScreen = clip.w > 0.0 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
      if (!onScreen) return sky(d);
      if (fp < 1.5 || fp > 64.0) return texture2D(tDiffuse, uv).rgb;   // >64: across an image boundary
      vec3 acc = vec3(0.0);
      for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++)
        acc += texture2D(tDiffuse, uv + (gx * float(i) + gy * float(j)) * 0.2).rgb;
      return acc / 25.0;
    }
    vec3 planck(float T) {
      vec3 lam = vec3(0.610, 0.550, 0.465);
      vec3 x = 14387.77 / (lam * max(T, 500.0));
      return 1.0 / (pow(lam, vec3(5.0)) * (exp(min(x, vec3(80.0))) - 1.0));
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    // ---- accretion disk, after the reference Kerr renderer's model (Schwarzschild case):
    // Page–Thorne temperature, optically-thick slab with limb darkening, lognormal turbulence
    // advected at the local orbital rate (two cross-faded generations so it never winds up),
    // Doppler + gravitational shift g, and a warm "cinematic" colour grade.
    float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float vnoise3(vec3 p) {
      vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
                 mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * (vnoise3(p) * 2.0 - 1.0); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
    vec2 turbulence(float r, float az, float t) {
      float lr = log(r);
      float rate = 0.7071 * pow(r, -1.5);                     // Keplerian Ω (c/Rs)
      float life = 6.2832 * 0.6 / rate;                       // a pattern lives 0.6 orbits
      vec2 acc = vec2(0.0); float wsq = 0.0;
      for (int k = 0; k < 2; k++) {
        float ph = t / life + 0.5 * float(k);
        float age = fract(ph), gen = floor(ph) + 17.0 * float(k);
        float w = 1.0 - abs(2.0 * age - 1.0);
        float a = az - rate * age * life + 1.6 * lr;          // advected, slightly spiral
        vec3 c = vec3(cos(a) * 5.0, sin(a) * 5.0, lr * 14.0) + vec3(gen * 7.13, gen * 3.71, gen * 1.37);
        acc += w * vec2(fbm3(c), fbm3(c * 2.3 + 11.0));
        wsq += w * w;
      }
      acc *= inversesqrt(max(wsq, 0.1));
      return vec2(exp(2.4 * acc.x + 1.3 * acc.y), 0.9 * acc.x + 0.5 * acc.y);
    }
    float bbLum(float T) { return dot(planck(T), vec3(0.2126, 0.7152, 0.0722)); }
    // Page–Thorne flux of a thin disk around a Kerr hole (r in M)
    float ptFlux(float r) {
      float x = sqrt(r), a = uSpin, x0 = uPT0.x;
      float br = x - x0 - 1.5 * a * log(x / x0)
        - uPT1.x * log((x - uPT0.y) / (x0 - uPT0.y))
        - uPT1.y * log((x - uPT0.z) / (x0 - uPT0.z))
        - uPT1.z * log((x - uPT0.w) / (x0 - uPT0.w));
      float x2 = x * x;
      return max(br, 0.0) / (x2 * x2 * (x2 * x - 3.0 * x + 2.0 * a));
    }
    // one crossing of the disk plane at radius r (M): radiance (rgb) and transmission (a).
    // E, L: the photon's energy at infinity and angular momentum (per unit energy at the camera);
    // pz: its polar rate there (for the angle to the disk normal)
    vec4 diskKerr(float r, float az, float E, float L, float pz) {
      if (r < uIsco || r > uDiskOut) return vec4(0.0, 0.0, 0.0, 1.0);
      float a = uSpin, sr = sqrt(r), r32 = r * sr;
      float om = 1.0 / (r32 + a);                                             // prograde orbit
      float ut = (r32 + a) / (sqrt(sr) * sr * sqrt(max(r32 - 3.0 * sr + 2.0 * a, 1e-6)));
      float g = 1.0 / max(ut * (E - om * L), 1e-4);                           // ν_seen / ν_emitted
      float cosE = clamp(g * pz / r, 0.04, 1.0);                              // angle to the normal, gas frame
      float Te = uPeakT * pow(max(ptFlux(r) * uPT1.w, 0.0), 0.25);
      vec2 tb = turbulence(0.5 * r, az, uTime * 4.0);
      float prof = smoothstep(uIsco, uIsco * 1.3, r) * (1.0 - smoothstep(uDiskOut * 0.45, uDiskOut, r)) * pow(uIsco * 2.5 / max(r, uIsco * 2.5), 0.9);
      float slab = max(cosE, 0.15);
      float tau = 2.2 * prof * (0.35 + tb.x);
      float trans = exp(-tau / slab);
      float limb = mix(1.0, (1.0 + 2.06 * cosE) / 2.3733, 1.0 - exp(-tau));
      float Tl = Te * clamp(1.0 + 0.12 * tb.y, 0.75, 1.3);
      // thermal light seen through a shift g is again a blackbody, at temperature g·T
      vec3 rad = planck(Tl * g) / bbLum(uPeakT) * uDiskGain;
      return vec4(rad * (1.0 - trans) * limb, trans);
    }
    // ---- Kerr ray state shared by the helpers below
    float kA2, kE, kL, kQ, kK, kB;
    float wAcc(float w) { return w * (kB + w * (3.0 * kK - 2.0 * kA2 * kQ * w)); }
    vec3 sAcc(vec3 s) { float u = s.z, e2 = kA2 * kE * kE; return -(kQ + kL * kL + 2.0 * e2 * u * u) * s + vec3(0.0, 0.0, e2 * u); }
    // frame-dragging rate (traced backwards in time, hence the sign)
    float dragRate(float w) { return -uSpin * w * (2.0 * kE - uSpin * kL * w) / max(1.0 - 2.0 * w + kA2 * w * w, 1e-5); }
    float hermite(float p0, float d0, float p1, float d1, float h, float f) {
      float f2 = f * f, f3 = f2 * f;
      return (2.0 * f3 - 3.0 * f2 + 1.0) * p0 + (f3 - 2.0 * f2 + f) * h * d0 + (3.0 * f2 - 2.0 * f3) * p1 + (f3 - f2) * h * d1;
    }
    vec3 thinLens(vec3 dir) {
      float sinT = length(cross(dir, uBH)), cosT = dot(dir, uBH);
      float th = atan(sinT, cosT);
      float b = uDist * sin(min(th, 1.5707));
      float bc = 2.598076 * uRs;
      if (cosT > 0.0 && b < bc) return vec3(0.0);
      if (cosT <= 0.0 || sinT < 1e-9) return texture2D(tDiffuse, vUv).rgb;
      float x = uRs / b;
      float alpha = max(2.0 * x + (15.0 * PI / 16.0) * x * x, -log(max(b / bc - 1.0, 1e-9)) - 0.4002);
      float beta = th - alpha;
      vec3 perp = normalize(dir - cosT * uBH);
      vec3 col = background(cos(beta) * uBH + sin(beta) * perp);
      return col + vec3(1.0, 0.9, 0.8) * 0.15 * exp(-pow((b / bc - 1.0) * 30.0, 2.0));
    }
    void main() {
      if (uActive < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 vv = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
      vec3 dir = normalize(vv.xyz / vv.w);
      if (uRay < 0.5) { gl_FragColor = vec4(thinLens(dir), 1.0); return; }
      // ---- Kerr ray trace. Black-hole frame: Z = spin axis (= disk normal), units of M.
      vec3 Z = uDiskN, X = uSpinX, Y = cross(Z, X);
      vec3 cw = uCamBH * 2.0, nw = normalize(uCamRot * dir);
      vec3 c = vec3(dot(cw, X), dot(cw, Y), dot(cw, Z)), n = vec3(dot(nw, X), dot(nw, Y), dot(nw, Z));
      float a = uSpin; kA2 = a * a;
      float r = length(c), cth = clamp(c.z / r, -0.9995, 0.9995), sth = sqrt(1.0 - cth * cth), ph = atan(c.y, c.x);
      vec3 er = vec3(sth * cos(ph), sth * sin(ph), cth), eth = vec3(cth * cos(ph), cth * sin(ph), -sth), eph = vec3(-sin(ph), cos(ph), 0.0);
      float nr = dot(n, er), nt = dot(n, eth), np = dot(n, eph);
      float r2 = r * r, sig = r2 + kA2 * cth * cth, del = r2 - 2.0 * r + kA2;
      float AA = (r2 + kA2) * (r2 + kA2) - kA2 * del * sth * sth;
      // the camera is a zero-angular-momentum observer; the photon reaching it travels along −n
      float lapse = sqrt(sig * del / AA), varpi = sqrt(AA / sig) * sth, omega = 2.0 * a * r / AA;
      kL = -varpi * np;
      kE = lapse + omega * kL;
      float pth = -sqrt(sig) * nt;
      kQ = pth * pth + cth * cth * (kL * kL / (sth * sth) - kA2 * kE * kE);
      kK = kQ + (kL - a * kE) * (kL - a * kE);
      kB = kA2 * kE * kE - kL * kL - kQ;
      // state, in Mino time running backwards from the camera
      float w = 1.0 / r, dw = -w * w * sqrt(sig * del) * nr;
      vec3 s = er, sv = sqrt(sig) * nt * eth + sqrt(AA / sig) * np * eph;
      float drag = 0.0;
      float wh = 1.0 / (1.0 + sqrt(max(1.0 - kA2, 0.0)));                        // horizon
      vec3 col = vec3(0.0);
      float T = 1.0;
      int fate = 0;            // 0 undecided, 1 escaped, 2 captured
      vec3 esc = s;
      for (int i = 0; i < 320; i++) {
        float u = s.z;
        float speed = sqrt(max(kQ + kL * kL + kA2 * kE * kE * u * u, 1e-8));
        float ang = mix(0.12, 0.04, smoothstep(0.01, 0.12, w));                 // smaller turns near the hole
        float h = ang / speed;
        h = min(h, 0.08 * max(w, 0.002) / max(abs(dw), 1e-8));
        if (dw > 0.0) h = min(h, 0.45 * max(wh - w, 1e-5) / dw);                // never overshoot the horizon
        // Runge–Kutta–Nyström (4th order, three force evaluations)
        float a1 = wAcc(w); vec3 b1 = sAcc(s);
        float wm = w + 0.5 * h * dw + 0.125 * h * h * a1; vec3 sm = s + 0.5 * h * sv + 0.125 * h * h * b1;
        float a2 = wAcc(wm); vec3 b2 = sAcc(sm);
        float we = w + h * dw + 0.5 * h * h * a2; vec3 se = s + h * sv + 0.5 * h * h * b2;
        float a3 = wAcc(we); vec3 b3 = sAcc(se);
        float wn = w + h * dw + h * h / 6.0 * (a1 + 2.0 * a2);
        float dwn = dw + h / 6.0 * (a1 + 4.0 * a2 + a3);
        vec3 sn = normalize(s + h * sv + h * h / 6.0 * (b1 + 2.0 * b2));
        vec3 svn = sv + h / 6.0 * (b1 + 4.0 * b2 + b3);
        svn -= dot(svn, sn) * sn;
        float dragn = drag + h / 6.0 * (dragRate(w) + 4.0 * dragRate(wm) + dragRate(we));
        // crossing the disk plane
        if (uDisk > 0.5 && (s.z > 0.0) != (sn.z > 0.0)) {
          float f = s.z / (s.z - sn.z);
          float wc = hermite(w, dw, wn, dwn, h, f);
          float rc = 1.0 / max(wc, 1e-6);
          if (rc > uIsco && rc < uDiskOut) {
            vec3 pp = mix(s, sn, f);
            float az = atan(pp.y, pp.x) + mix(drag, dragn, f);
            vec4 e = diskKerr(rc, az, kE, kL, abs(mix(sv.z, svn.z, f)));
            col += T * e.rgb;
            T *= e.a;
            if (T < 0.004) { fate = 2; break; }
          }
        }
        if (wn <= 0.0) {                                                         // reached infinity
          float f = w / (w - wn);
          esc = normalize(mix(s, sn, f)); drag = mix(drag, dragn, f);
          fate = 1; break;
        }
        w = wn; dw = dwn; s = sn; sv = svn; drag = dragn;
        if (w >= wh * 0.997) { fate = 2; break; }
      }
      if (fate == 0 && dw < 0.0 && w < 0.05) { fate = 1; esc = s; }
      if (fate != 1) esc = s;
      float cd = cos(drag), sd = sin(drag);
      vec3 e = vec3(esc.x * cd - esc.y * sd, esc.x * sd + esc.y * cd, esc.z);        // undo the frame drag
      // a longer exposure up close, as a camera framing the hole would use: the sky comes up with it
      vec3 bg = backgroundFiltered(normalize(uViewRot * (e.x * X + e.y * Y + e.z * Z))) * uBgGain * (fate == 1 ? 1.0 : 0.0);
      vec3 outc = col + T * bg;
      // cinematic finish: slight vignette and fine grain
      vec2 vg = vUv * 2.0 - 1.0;
      outc *= 1.0 - 0.18 * dot(vg, vg) * 0.5;
      outc += (hash(vUv * 1733.0 + fract(uTime)) - 0.5) * 0.012;
      gl_FragColor = vec4(max(outc, 0.0), 1.0);
    }`,
};

export function createComposer(renderer, mainScene, probeScene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const mainPass = new RenderPass(mainScene, camera);
  composer.addPass(mainPass);
  const lens = new ShaderPass(LensShader);
  composer.addPass(lens);
  const probePass = new RenderPass(probeScene, camera);
  probePass.clear = false;
  probePass.clearDepth = true;
  composer.addPass(probePass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.7, 0.3, 1.6);
  // damp the lowest-resolution mips: they turn very bright point sources into blocky squares
  bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.8, 0.55, 0.3, 0.12];
  // cap what feeds the blur so a single extremely bright pixel cannot flood the coarse mips
  const hp = bloom.materialHighPassFilter;
  hp.fragmentShader = hp.fragmentShader.replace('gl_FragColor = mix( outputColor, texel, alpha );',
    'vec4 cb = mix( outputColor, texel, alpha ); float m = max( max( cb.r, cb.g ), cb.b ); gl_FragColor = m > 3.0 ? cb * ( 3.0 / m ) : cb;');
  hp.needsUpdate = true;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return { composer, lens, bloom, mainPass, probePass };
}
