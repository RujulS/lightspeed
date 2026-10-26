import { AU, DAY, DEG, v3 } from './constants.js';

export const OBLIQUITY = 23.43928 * DEG;
const cE = Math.cos(OBLIQUITY), sE = Math.sin(OBLIQUITY);
export const eclToEq = ([x, y, z]) => [x, cE * y - sE * z, sE * y + cE * z];
// Ecliptic north pole expressed in the equatorial world frame
export const ECLIPTIC_NORTH = [0, -sE, cE];

export function radecToVec(raDeg, decDeg) {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

// JPL "Keplerian Elements for Approximate Positions of the Major Planets" (Standish),
// valid 1800–2050. [a AU, e, I deg, L deg, varpi deg, Omega deg] + rates per Julian century.
const EL = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
  pluto: [[39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482]],
};

function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/** Heliocentric position (m, equatorial J2000) of a planet at sim time t (s since J2000). */
export function planetPos(name, t) {
  const [e0, r] = EL[name];
  const TL = t / (36525 * DAY);
  // secular drift terms are only valid for a few centuries — freeze them outside ±30 centuries
  const T = Math.max(-30, Math.min(30, TL));
  const a = (e0[0] + r[0] * T) * AU, e = e0[1] + r[1] * T, I = (e0[2] + r[2] * T) * DEG;
  const L = ((e0[3] + r[3] * TL) % 360) * DEG, wb = (e0[4] + r[4] * T) * DEG, O = (e0[5] + r[5] * T) * DEG;
  const w = wb - O;
  let M = (L - wb) % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI; else if (M < -Math.PI) M += 2 * Math.PI;
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  const z = (sw * sI) * xp + (cw * sI) * yp;
  return eclToEq([x, y, z]);
}

export const planetVel = (name, t) => {
  const h = 600;
  return v3.scale(v3.sub(planetPos(name, t + h), planetPos(name, t - h)), 1 / (2 * h));
};

export function orbitalPeriod(name) {
  return 2 * Math.PI * Math.sqrt((EL[name][0][0] * AU) ** 3 / 1.32712440018e20);
}

/** Geocentric Moon position, simple mean-element model (good to ~1°, plenty for display). */
export function moonGeo(t) {
  const d = t / DAY;
  const L = (218.316 + 13.176396 * d) * DEG; // mean longitude
  const Mm = (134.963 + 13.064993 * d) * DEG; // mean anomaly
  const F = (93.272 + 13.22935 * d) * DEG; // argument of latitude
  const lon = L + 6.289 * DEG * Math.sin(Mm);
  const lat = 5.128 * DEG * Math.sin(F);
  const dist = (385001 - 20905 * Math.cos(Mm)) * 1000;
  return eclToEq([dist * Math.cos(lat) * Math.cos(lon), dist * Math.cos(lat) * Math.sin(lon), dist * Math.sin(lat)]);
}

// IAU WGCCRE 2015 rotation models: pole RA, Dec (deg) and prime meridian W = W0 + Wd·days
export const ROTATION = {
  sun: [286.13, 63.87, 84.176, 14.1844],
  mercury: [281.0103, 61.4155, 329.5988, 6.1385108],
  venus: [272.76, 67.16, 160.2, -1.4813688],
  earth: [0, 90, 190.147, 360.9856235],
  moon: [269.9949, 66.5392, 38.3213, 13.17635815],
  mars: [317.269, 54.432, 176.049, 350.891982443],
  jupiter: [268.056595, 64.495303, 284.95, 870.536],
  saturn: [40.589, 83.537, 38.9, 810.7939024],
  uranus: [257.311, -15.175, 203.81, -501.1600928],
  neptune: [299.36, 43.46, 249.978, 541.1397757],
  pluto: [132.993, -6.163, 302.695, 56.3625225],
};

// ---------------------------------------------------------------- two-body mechanics
function stumpff(psi) {
  if (psi > 1e-6) { const s = Math.sqrt(psi); return [(1 - Math.cos(s)) / psi, (s - Math.sin(s)) / (s * s * s)]; }
  if (psi < -1e-6) { const s = Math.sqrt(-psi); return [(Math.cosh(s) - 1) / -psi, (Math.sinh(s) - s) / (s * s * s)]; }
  return [0.5, 1 / 6];
}

/** Universal-variable Lambert solver (Vallado). Prograde w.r.t. `normal`. Returns {v1, v2} or null. */
export function lambert(r1, r2, tof, mu, normal = ECLIPTIC_NORTH) {
  const R1 = v3.len(r1), R2 = v3.len(r2);
  const cosd = Math.max(-1, Math.min(1, v3.dot(r1, r2) / (R1 * R2)));
  const tm = v3.dot(v3.cross(r1, r2), normal) >= 0 ? 1 : -1;
  const A = tm * Math.sqrt(R1 * R2 * (1 + cosd));
  if (Math.abs(A) < 1e-9) return null;
  const smu = Math.sqrt(mu);
  // time of flight as a function of psi; y < 0 means the geometry is unreachable for that psi
  const yOf = (psi) => { const [c2, c3] = stumpff(psi); return R1 + R2 + A * (psi * c3 - 1) / Math.sqrt(c2); };
  const tofOf = (psi) => {
    const [c2, c3] = stumpff(psi), y = yOf(psi);
    if (y < 0) return -1;
    const chi = Math.sqrt(y / c2);
    return (chi ** 3 * c3 + A * Math.sqrt(y)) / smu;
  };
  let psiUp = 4 * Math.PI * Math.PI * 0.999, psiLow = -4 * Math.PI;
  // strongly hyperbolic transfers need a much more negative lower bound
  for (let i = 0; i < 60 && tofOf(psiLow) > tof; i++) psiLow *= 2;
  let psi = 0, y = 0;
  for (let i = 0; i < 300; i++) {
    psi = 0.5 * (psiUp + psiLow);
    const dt = tofOf(psi);
    if (dt >= 0 && Math.abs(dt - tof) < 1e-9 * tof) break;
    if (dt <= tof) psiLow = psi; else psiUp = psi;
  }
  y = yOf(psi);
  if (!(y > 0) || Math.abs(tofOf(psi) - tof) > 1e-5 * tof) return null;
  const f = 1 - y / R1, g = A * Math.sqrt(y / mu), gd = 1 - y / R2;
  return {
    v1: v3.scale(v3.sub(r2, v3.scale(r1, f)), 1 / g),
    v2: v3.scale(v3.sub(v3.scale(r2, gd), r1), 1 / g),
  };
}

/** Universal-variable Kepler propagation. Returns [r, v]. */
export function propagate(r0, v0, dt, mu) {
  if (dt === 0) return [r0.slice(), v0.slice()];
  const R0 = v3.len(r0), V0 = v3.len(v0), smu = Math.sqrt(mu), rv = v3.dot(r0, v0);
  const alpha = -V0 * V0 / mu + 2 / R0;
  let chi;
  if (alpha > 1e-12) chi = smu * dt * alpha;
  else if (alpha < -1e-12) {
    const a = 1 / alpha, s = Math.sign(dt);
    chi = s * Math.sqrt(-a) * Math.log((-2 * mu * alpha * dt) / (rv + s * Math.sqrt(-mu * a) * (1 - R0 * alpha)));
  } else chi = smu * dt / R0;
  let r = R0, c2 = 0.5, c3 = 1 / 6, psi = 0;
  for (let i = 0; i < 60; i++) {
    psi = chi * chi * alpha;
    [c2, c3] = stumpff(psi);
    r = chi * chi * c2 + rv / smu * chi * (1 - psi * c3) + R0 * (1 - psi * c2);
    const d = (smu * dt - chi ** 3 * c3 - rv / smu * chi * chi * c2 - R0 * chi * (1 - psi * c3)) / r;
    chi += d;
    if (Math.abs(d) < 1e-9) break;
  }
  const f = 1 - chi * chi / R0 * c2, g = dt - chi ** 3 / smu * c3;
  const gd = 1 - chi * chi / r * c2, fd = smu / (r * R0) * chi * (psi * c3 - 1);
  return [v3.add(v3.scale(r0, f), v3.scale(v0, g)), v3.add(v3.scale(r0, fd), v3.scale(v0, gd))];
}
