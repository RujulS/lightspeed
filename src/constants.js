// SI units throughout. World frame: ICRF/J2000 equatorial, origin at the Sun, metres.
export const C = 299792458;
export const G = 6.6743e-11;
export const AU = 1.495978707e11;
export const LY = 9.4607304725808e15;
export const PC = 3.0856775814913673e16;
export const KPC = PC * 1e3;
export const DAY = 86400;
export const YEAR = 365.25 * DAY;
export const G0 = 9.80665;
export const MSUN = 1.98847e30;
export const GM_SUN = 1.32712440018e20;
export const GM_EARTH = 3.986004418e14;
export const DEG = Math.PI / 180;

// J2000.0 = 2000-01-01T12:00:00 TT (UTC difference is irrelevant at this scale)
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
export const dateToSim = (d) => (d.getTime() - J2000_MS) / 1000;
export const simToDate = (t) => new Date(J2000_MS + t * 1000);

// Small double-precision vec3 helpers (plain arrays) — Three's Vector3 is fine too,
// but these make the physics code independent of rendering.
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
