import { Vector3 } from 'three';

// Shared GLSL. All "sky" shaders work with directions; the observer's velocity enters only through
// special-relativistic aberration and the Doppler factor D.

export const RELATIVITY = /* glsl */ `
uniform vec3 uBetaDir;      // unit vector of observer velocity (world frame)
uniform float uBeta;        // |v|/c
uniform float uGamma;       // Lorentz factor (passed separately: beta rounds to 1.0 in float32)
uniform float uOneMinusBeta;

// rest-frame direction to a source -> direction the moving observer sees
vec3 aberrate(vec3 n) {
  if (uBeta < 1e-7) return n;
  float c = dot(n, uBetaDir);
  float cp = (c + uBeta) / (1.0 + uBeta * c);
  vec3 perp = n - c * uBetaDir;
  float pl = length(perp);
  if (pl < 1e-12) return n;
  return cp * uBetaDir + sqrt(max(0.0, 1.0 - cp * cp)) * perp / pl;
}
// apparent direction -> rest-frame direction
vec3 unaberrate(vec3 np) {
  if (uBeta < 1e-7) return np;
  float cp = dot(np, uBetaDir);
  float c = (cp - uBeta) / (1.0 - uBeta * cp);
  vec3 perp = np - cp * uBetaDir;
  float pl = length(perp);
  if (pl < 1e-12) return np;
  return c * uBetaDir + sqrt(max(0.0, 1.0 - c * c)) * perp / pl;
}
// Doppler factor (observed/emitted frequency) from the rest-frame direction
float dopplerRest(vec3 n) { return uGamma * (1.0 + uBeta * dot(n, uBetaDir)); }
// ... and from the apparent direction (numerically safer looking forward)
float dopplerApparent(vec3 np) {
  float cp = dot(np, uBetaDir);
  float k = (1.0 - cp) + cp * uOneMinusBeta;
  return 1.0 / (uGamma * max(k, 1e-30));
}

// Planck spectral radiance (arbitrary units) sampled at R, G, B wavelengths (µm)
vec3 planckRGB(float T) {
  vec3 lam = vec3(0.610, 0.550, 0.465);
  vec3 x = 14387.77 / (lam * max(T, 1.0));
  vec3 ex = mix(exp(min(x, vec3(85.0))) - 1.0, x, step(x, vec3(1e-3)));
  return 1.0 / (pow(lam, vec3(5.0)) * ex);
}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Colour of a blackbody normalised to unit luminance
vec3 bbColor(float T) { vec3 c = planckRGB(T); return c / lum(c); }
// Spectral shift of light that left the source with colour temperature T0
vec3 dopplerTint(float D, float T0) { return planckRGB(D * T0) / planckRGB(T0); }
`;

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*snoise(p); p*=2.03; a*=0.5; } return s; }
`;

// Vertex helper for meshes: world-relative position (camera at origin) -> aberrated position
export const MESH_ABERRATION = /* glsl */ `
vec3 aberratePos(vec3 p) {
  float d = length(p);
  if (d < 1e-6 || uBeta < 1e-7) return p;
  return aberrate(p / d) * d;
}
`;

// One shared set of uniform objects: every material references these, main loop updates them once.
export const REL = {
  uBetaDir: { value: new Vector3(1, 0, 0) }, uBeta: { value: 0 }, uGamma: { value: 1 }, uOneMinusBeta: { value: 1 },
};
export function setObserverVelocity(dir, phi) {
  // phi = rapidity; keeps precision at extreme Lorentz factors
  REL.uBetaDir.value.set(dir[0], dir[1], dir[2]);
  REL.uBeta.value = Math.tanh(phi);
  REL.uGamma.value = Math.cosh(phi);
  REL.uOneMinusBeta.value = phi > 0 ? 1 / (Math.exp(2 * phi) + 1) * 2 : 1; // 1 − tanh φ = 2/(e^{2φ}+1)
}
