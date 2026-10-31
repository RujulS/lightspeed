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
    uIsco: { value: 6 }, uDiskOut: { value: 16 }, uPeakT: { value: 6000 },
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
        // w may change by 8% a step, except outbound past r = 50 M, where the path is nearly straight and the
        // turn-angle cap alone keeps it accurate (no pixel changes by more than 2/255; the trace is ~40% faster)
        h = min(h, (dw < 0.0 && w < 0.02 ? 1.0 : 0.08) * max(w, 0.002) / max(abs(dw), 1e-8));
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

// The warp bubble seen as a lens, in two parts.
// 1. The wall. The bubble is held up by a shell of negative energy, and that bends light outward, like
//    a diverging lens. The energy sits in the wall and the bending is kept to sight lines that pass
//    close to it (a soft band about a third of the radius either side), so the bubble shows as a rim of displaced
//    sky. This is there as soon as the wall is up, with the ship still at rest. Lensing keeps surface
//    brightness, so nothing is brightened.
// 2. The motion. Alcubierre's metric contracts space ahead of the bubble and expands it behind, in
//    proportion to the bubble's speed and only where the shape function changes: in the wall. A sight
//    line through the front of the wall sees the background squeezed (brighter and bluer), through the
//    back stretched (dimmer and redder).
// Gravitational waves: a bubble at steady speed emits none, but raising or dropping the wall changes its
// shape fast and gives off a burst (Clough, Dietrich & Khan 2024 simulated the collapse). It crosses the
// view at light speed, so all that shows is a brief quadrupole wobble of the picture (uGW, from main.js).
// From inside the shell the wall bends nothing (flat space within), every sight line leaves through
// the wall and the sky is squeezed toward the front (the aberration code in main.js) plus a little
// more here. Illustrative: the strength depends on how much negative energy the wall holds and its
// shape, which the theory leaves open.
const WarpShader = {
  uniforms: {
    tDiffuse: { value: null }, uActive: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uAxis: { value: new THREE.Vector3(0, 0, -1) },
    uR: { value: 1 }, uK: { value: 0 }, uA: { value: 0 }, uGW: { value: 0 }, uTime: { value: 0 }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uActive, uR, uK, uA, uTime, uGW;
    uniform vec3 uCenter, uAxis;   // view space
    uniform mat4 uInvProj, uProj;
    varying vec2 vUv;
    void main() {
      // the gravitational-wave burst: stretch one way across the picture, squeeze the other
      vec2 q = vUv - 0.5;
      vec2 uv0 = 0.5 + q * (1.0 + uGW * vec2(1.0, -1.0));
      vec4 base = texture2D(tDiffuse, uv0);
      if (uActive < 0.5) { gl_FragColor = base; return; }
      vec4 vv = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
      vec3 d = normalize(vv.xyz / vv.w);
      vec3 b = uCenter;
      float R2 = uR * uR, tca = dot(b, d), d2 = dot(b, b) - tca * tca;
      bool inside = dot(b, b) < R2;
      vec3 dd = d;
      // 1. the wall's own bending: rotate the sight line away from the bubble's centre by α
      if (!inside && tca > 0.0) {
        float x = sqrt(max(d2, 0.0)) / uR;
        float a = uA * exp(-pow((x - 1.0) / 0.32, 2.0));
        vec3 cn = normalize(b);
        float th = acos(clamp(dot(d, cn), -1.0, 1.0));
        vec3 pd = d - cn * dot(d, cn);
        if (length(pd) > 1e-6) dd = cn * cos(th + a) + normalize(pd) * sin(th + a);
      }
      // 2. the motion: squeezed ahead, stretched behind, for sight lines through or close past the wall.
      // c is where along the axis the sight line meets the wall (its closest point when it misses), so
      // the effect runs on smoothly past the edge instead of stopping there.
      float s = 0.0, chord = 0.0, cOut = 0.0, x = sqrt(max(d2, 0.0)) / uR;
      if (inside || tca > 0.0) {
        float cIn;
        if (d2 < R2) {
          float thc = sqrt(R2 - d2);
          cOut = dot((tca + thc) * d - b, uAxis) / uR;               // where the sight line leaves the bubble
          cIn = inside ? cOut : dot((tca - thc) * d - b, uAxis) / uR;
          chord = inside ? 1.0 : thc / uR;                           // 1 through the middle, 0 grazing
        } else cOut = cIn = dot(tca * d - b, uAxis) / max(length(tca * d - b), 1e-6);
        float w = inside ? 0.12 : exp(-pow((x - 1.0) / 0.32, 2.0));
        s = uK * w * 0.5 * (cIn + cOut);                              // + ahead (contraction), − behind (expansion)
        vec3 perp = dd - uAxis * dot(dd, uAxis);
        float pl = length(perp);
        if (pl > 1e-5) dd = normalize(dd + s * perp / pl);
      }
      if (dd == d) { gl_FragColor = base; return; }
      vec4 c = uProj * vec4(dd, 1.0);
      vec2 uv = 0.5 + (c.xy / c.w * 0.5) * (1.0 + uGW * vec2(1.0, -1.0));
      // near the screen edge the bent sight line can point off the picture: fade back to the straight view
      vec2 e = min(uv, 1.0 - uv);
      float onScreen = c.w > 0.0 ? smoothstep(0.0, 0.03, min(e.x, e.y)) : 0.0;
      vec3 col = mix(base.rgb, texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb, onScreen);
      col *= max(0.0, 1.0 + 1.5 * s);
      col *= mix(vec3(1.0), s > 0.0 ? vec3(0.75, 0.9, 1.35) : vec3(1.3, 0.9, 0.7), min(1.0, abs(s) * 2.5));
      // the wall: a faint shimmer, strongest where the sight line grazes it and over the two lobes
      if (!inside && tca > 0.0) {
        float graze = exp(-pow((x - 1.0) / 0.25, 2.0));
        float ripple = 0.5 + 0.5 * sin(10.0 * cOut - uTime * 1.5);
        vec3 tint = mix(vec3(1.0, 0.7, 0.55), vec3(0.55, 0.75, 1.0), smoothstep(-0.3, 0.3, cOut));
        col += tint * (uA * 1.5 + uK) * (graze * (0.3 + 0.2 * ripple) * 0.15 + 0.025 * abs(cOut) * chord);
      }
      gl_FragColor = vec4(col, base.a);
    }`,
};

// The Enterprise's warp field: Star Trek, not Alcubierre. A lens the shape of its nested field shells
// (createWarpDrive in probes3d.js) that runs on behind the ship as a long tapering wake, where the background is
// churned, smeared along the line of flight so stars draw out into streaks, and threaded with blue light.
const TrekWarpShader = {
  uniforms: {
    tDiffuse: { value: null }, uActive: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uAxis: { value: new THREE.Vector3(0, 0, -1) },
    uR: { value: 1 }, uFwd: { value: 0.6 }, uAft: { value: -2.6 }, uWake: { value: 0 }, uK: { value: 0 }, uA: { value: 0 }, uGW: { value: 0 }, uTime: { value: 0 }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uActive, uR, uFwd, uAft, uWake, uK, uA, uTime, uGW;
    uniform vec3 uCenter, uAxis;   // view space
    uniform mat4 uInvProj, uProj;
    varying vec2 vUv;
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise2(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
    }
    // Radius of the zone at s along its spine. With a wake it tapers smoothly over the whole long tail.
    float rimAt(float s, float sFwd, float sAft) {
      if (s > 0.0) { float u = clamp(s / max(sFwd, 1e-4), 0.0, 1.0); return uR * sqrt(max(0.01, 1.0 - u * u)); }
      float u = clamp(-s / max(-sAft, 1e-4), 0.0, 1.0);
      return uR * pow(max(1.0 - u, 0.0), 1.4) + 0.01 * uR;
    }
    void main() {
      // the gravitational-wave burst: stretch one way across the picture, squeeze the other
      vec2 q = vUv - 0.5;
      vec2 uv0 = 0.5 + q * (1.0 + uGW * vec2(1.0, -1.0));
      vec4 base = texture2D(tDiffuse, uv0);
      if (uActive < 0.5) { gl_FragColor = base; return; }
      vec4 vv = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
      vec3 d = normalize(vv.xyz / vv.w);
      vec3 b = uCenter;
      vec3 a = normalize(uAxis);

      // Trailing bubble zone: elongated aerodynamic teardrop/capsule along flight axis
      float sFwd = uFwd * uR;
      float sAft = uAft * uR; // trails backward behind the ship

      // Closest approach between ray (t*d) and bubble spine (b + s*a)
      float D = dot(d, a);
      float bd = dot(b, d), ba = dot(b, a);
      float denom = 1.0 - D * D;
      float t0, s0;
      if (denom < 1e-5) {
        t0 = max(0.0, bd);
        s0 = t0 * D - ba;
      } else {
        t0 = (bd - D * ba) / denom;
        s0 = (D * bd - ba) / denom;
      }
      t0 = max(0.0, t0);
      float sClamped = clamp(s0, sAft, sFwd);

      vec3 pRay = t0 * d;
      vec3 pSpine = b + a * sClamped;
      vec3 delta = pRay - pSpine;
      float dist = length(delta);

      // Boundary radius of the trailing teardrop zone along the axis
      float rBound = rimAt(sClamped, sFwd, sAft);

      float x = dist / max(rBound, 1e-4);

      // Check if camera (origin) is inside the trailing bubble zone
      float sCam = -dot(b, a);
      float rCam = length(-b - a * sCam);
      float rCamBound = rimAt(clamp(sCam, sAft, sFwd), sFwd, sAft);
      bool inside = sCam >= sAft && sCam <= sFwd && rCam < rCamBound;

      vec3 dd = d;

      // 1. Spacetime wall metric deflection: bending away from the trailing spine
      float sNorm = sClamped / max(uR, 1e-4);
      float along = clamp(sClamped / min(sAft, -1e-4), 0.0, 1.0);
      sNorm = max(sNorm, -1.5);
      if (!inside && t0 > 0.0) {
        float aBend = uA * exp(-pow((x - 1.0) / 0.22, 2.0));
        aBend *= (1.0 - along) * (1.0 - along);
        vec3 norm = dist > 1e-5 ? delta / dist : normalize(d - a * D);
        dd = normalize(d + aBend * norm);
      }

      // 2. Motion contraction ahead & expansion behind along the trailing zone
      float w = inside ? 0.12 : exp(-pow((x - 1.0) / 0.25, 2.0));
      float sMetric = uK * w * 0.45 * sNorm;
      sMetric *= (1.0 - along) * (1.0 - along) * (1.0 - along);
      vec3 perp = dd - a * dot(dd, a);
      float pl = length(perp);
      if (pl > 1e-5) dd = normalize(dd + sMetric * perp / pl);

      // 3. The wake: the background behind the ship is churned as it streams away
      float wake = 0.0, across = 0.0, sR = s0 / max(uR, 1e-4);
      if (!inside && t0 > 0.0 && s0 < 0.0) {
        vec3 side = cross(a, d);
        side /= max(length(side), 1e-4);
        across = dot(delta, side) / max(rBound, 1e-4);
        wake = uWake * (1.0 - smoothstep(0.2, 1.05, x)) * smoothstep(0.0, 0.6, -sR) * pow(max(1.0 - along, 0.0), 1.1);
        float churn = noise2(vec2(across * 2.5, sR * 0.8 + uTime * 1.5)) - 0.5;
        dd = normalize(dd + side * wake * 0.07 * churn + a * wake * 0.03 * sin(sR * 2.6 + uTime * 4.0));
      }

      if (dd == d) { gl_FragColor = base; return; }

      vec4 c = uProj * vec4(dd, 1.0);
      vec2 uv = 0.5 + (c.xy / c.w * 0.5) * (1.0 + uGW * vec2(1.0, -1.0));
      vec2 e = min(uv, 1.0 - uv);
      float onScreen = c.w > 0.0 ? smoothstep(0.0, 0.03, min(e.x, e.y)) : 0.0;

      // Gentle, subtle chromatic dispersion
      float bendMag = length(dd - d);
      vec2 dispDir = (bendMag > 1e-5 ? normalize(uv - 0.5) : vec2(0.0)) * bendMag * 0.0035;
      vec3 col;
      if (onScreen > 0.0) {
        float cr = texture2D(tDiffuse, clamp(uv + dispDir, 0.001, 0.999)).r;
        float cg = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).g;
        float cb = texture2D(tDiffuse, clamp(uv - dispDir, 0.001, 0.999)).b;
        col = mix(base.rgb, vec3(cr, cg, cb), onScreen);
      } else {
        col = base.rgb;
      }

      // Stars in the wake smear into streaks along the line of flight, bluer toward their tails
      if (wake > 0.002) {
        vec4 ca = uProj * vec4(pSpine, 1.0), cb = uProj * vec4(pSpine - a * uR, 1.0);
        if (ca.w > 0.0 && cb.w > 0.0) {
          vec2 sd = cb.xy / cb.w - ca.xy / ca.w;
          float sl = length(sd);
          if (sl > 1e-5) {
            sd /= sl;
            float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            vec3 acc = vec3(0.0); float wsum = 0.0;
            for (int i = 0; i < 14; i++) {
              float f = (float(i) + jitter) / 14.0;
              float wt = 1.0 - 0.7 * f;
              acc += texture2D(tDiffuse, clamp(uv + sd * (0.3 - f) * wake * 0.14, 0.001, 0.999)).rgb * mix(vec3(1.0), vec3(0.55, 0.78, 1.3), f) * wt;
              wsum += wt;
            }
            col = mix(col, acc / wsum * 2.6, smoothstep(0.0, 0.2, wake));
          }
        }
        // threads of light streaming down it, on any background (even an empty sky)
        float threads = noise2(vec2(across * 5.0, sR * 0.3 + uTime * 1.9));
        float bands = pow(0.5 + 0.5 * sin(sR * 1.9 + uTime * 4.5), 4.0);
        col += mix(vec3(0.25, 0.55, 1.0), vec3(0.3, 0.22, 0.95), along) * sqrt(wake) * wake * (0.05 + 0.55 * threads * threads + 0.14 * bands);
      }

      // Subtle, clean optical tint (preserves star colors)
      col *= max(0.0, 1.0 + 1.2 * sMetric);
      col *= mix(vec3(1.0), sMetric > 0.0 ? vec3(0.94, 0.97, 1.03) : vec3(1.04, 0.98, 0.94), min(1.0, abs(sMetric) * 0.8));

      gl_FragColor = vec4(col, base.a);
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
  const warp = new ShaderPass(WarpShader);
  warp.enabled = false;
  composer.addPass(warp);
  const warpTrek = new ShaderPass(TrekWarpShader);
  warpTrek.enabled = false;
  composer.addPass(warpTrek);
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
  // The bloom is added in the output pass instead of being blended into the frame first: the same sum
  // (the blend adds rgb × alpha), minus a full-screen write and resolve of the 4×-multisampled buffer.
  const output = new OutputPass();
  output.uniforms.tBloom = { value: bloom.renderTargetsHorizontal[0].texture };
  output.material.fragmentShader = output.material.fragmentShader
    .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tBloom;')
    .replace('gl_FragColor = texture2D( tDiffuse, vUv );',
      'gl_FragColor = texture2D( tDiffuse, vUv );\n\t\t\tvec4 bl = texture2D( tBloom, vUv );\n\t\t\tgl_FragColor.rgb += bl.rgb * bl.a;');
  const quad = bloom.fsQuad, draw = quad.render.bind(quad);
  quad.render = (r) => { if (quad.material !== bloom.blendMaterial) draw(r); };
  composer.addPass(output);
  return { composer, lens, warp, warpTrek, bloom, mainPass, probePass };
}
