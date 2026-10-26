import { C, DAY, YEAR, G0, GM_SUN, GM_EARTH, v3 } from './constants.js';
import { planetPos, planetVel, moonGeo, lambert, propagate, orbitalPeriod } from './astro.js';

// ---------------------------------------------------------------------------------------------
// Probe physics. Every number here comes from the mission or the design study it is named after.
// ---------------------------------------------------------------------------------------------
const atanh = Math.atanh;
export const PROBES = [
  {
    id: 'voyager', name: 'Voyager 1', tag: 'Real · launched 1977', kind: 'ballistic',
    // Inside the Solar System: real two-body (Lambert) trajectories with the best launch energy
    // ever flown (New Horizons, C3 = 157.7 km²/s² → v∞ 12.56 km/s). Beyond: Voyager 1's actual
    // heliocentric cruise speed after its Jupiter/Saturn gravity assists.
    vinf: 12.56e3, moonSpeed: 16.26e3, cruise: 16.99e3,
    blurb: 'Fastest object leaving the Solar System. Cruises at 17 km/s (3.6 AU per year) after gravity assists at Jupiter and Saturn.',
  },
  {
    id: 'parker', name: 'Parker Solar Probe', tag: 'Real · launched 2018', kind: 'cruise', v: 191.7e3,
    blurb: 'Fastest human-made object: 191.7 km/s at its closest approach to the Sun (Dec 2024). Here that record speed is held constant from launch, as a benchmark.',
  },
  {
    id: 'orion', name: 'Project Orion', tag: 'Studied · 1958–1968', kind: 'thrust', flyby: true,
    stages: [{ a: G0, beta: 0.033, label: 'Nuclear pulse drive' }],
    blurb: 'Pushed by nuclear explosions against a pusher plate. Freeman Dyson\'s 1968 interstellar version: ~1 g pulses to 10,000 km/s (3.3% c).',
  },
  {
    id: 'daedalus', name: 'Project Daedalus', tag: 'Studied · 1973–1978', kind: 'thrust', flyby: true,
    stages: [
      { a: C * atanh(0.071) / (2.05 * YEAR), beta: 0.071, label: 'Stage 1 fusion burn' },
      { a: C * (atanh(0.122) - atanh(0.071)) / (1.76 * YEAR), beta: 0.122, label: 'Stage 2 fusion burn' },
    ],
    blurb: 'British Interplanetary Society design: two-stage inertial-confinement fusion rocket, 54,000 t, reaching 12.2% c in 3.8 years. Flyby only.',
  },
  {
    id: 'starshot', name: 'Breakthrough Starshot', tag: 'Proposed · 2016', kind: 'thrust', flyby: true,
    stages: [{ a: 0.2 * C / 600, beta: 0.2, label: 'Laser boost (100 GW array)' }],
    blurb: 'Gram-scale chip on a 4 m light sail, pushed by a 100 GW ground laser at ~10,000 g for 10 minutes to 20% c. Flyby only, no braking.',
  },
  {
    id: 'antimatter', name: 'Antimatter Photon Ship', tag: 'Conceptual', kind: 'thrust', flyby: false,
    stages: [{ a: G0, beta: 1, label: '1 g antimatter drive' }],
    blurb: 'Ideal relativistic rocket: constant 1 g felt aboard, flip at the midpoint, 1 g braking. Time dilation lets the crew reach other galaxies within a lifetime.',
  },
];
export const probeById = (id) => PROBES.find((p) => p.id === id);

// ---------------------------------------------------------------------------------------------
// Relativistic 1-D profile: constant proper-acceleration burns and coasts (exact SR kinematics).
// ---------------------------------------------------------------------------------------------
const coshDiff = (p1, p0) => 2 * Math.sinh((p1 + p0) / 2) * Math.sinh((p1 - p0) / 2); // cosh p1 − cosh p0, stable

function burn(a, p0, p1, label) {
  return { type: 'thrust', a, p0, p1, label, dt: (C / a) * (Math.sinh(p1) - Math.sinh(p0)), dx: (C * C / a) * coshDiff(p1, p0), dtau: (C / a) * (p1 - p0) };
}

function accelBurns(stages, phiCap) {
  const out = [];
  let p = 0;
  for (const s of stages) {
    const pe = Math.min(s.beta >= 1 ? Infinity : atanh(s.beta), phiCap);
    if (pe > p) { out.push(burn(s.a, p, pe, s.label)); p = pe; }
  }
  return out;
}
const sumDx = (b) => b.reduce((s, x) => s + x.dx, 0);

export class Profile {
  /** stages: [{a, beta, label}], L: distance (m), rendezvous: brake to rest at L, v: constant speed (cruise) */
  constructor({ stages, L, rendezvous, v }) {
    this.L = L;
    const ph = [];
    if (v) {
      ph.push({ type: 'coast', phi: atanh(v / C), label: 'Cruising', dt: Infinity });
    } else if (rendezvous) {
      let burns = accelBurns(stages, Infinity);
      if (sumDx(burns) * 2 > L) {
        let lo = 0, hi = 1;
        while (sumDx(accelBurns(stages, hi)) * 2 < L) hi *= 2;
        for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (sumDx(accelBurns(stages, m)) * 2 < L) lo = m; else hi = m; }
        burns = accelBurns(stages, lo);
      }
      const pMax = burns.length ? burns[burns.length - 1].p1 : 0;
      ph.push(...burns);
      const coast = L - 2 * sumDx(burns);
      if (coast > 1) ph.push({ type: 'coast', phi: pMax, label: 'Coasting', dt: coast / (C * Math.tanh(pMax)) });
      // Mirror image: the ship flips and burns the same stages in reverse order.
      for (const b of [...burns].reverse()) ph.push({ ...burn(-b.a, b.p1, b.p0, 'Braking · ' + b.label), flip: true });
      ph.push({ type: 'coast', phi: 0, label: 'Arrived', dt: Infinity, rest: true });
    } else {
      const burns = accelBurns(stages, Infinity);
      ph.push(...burns);
      const pMax = burns.length ? burns[burns.length - 1].p1 : 0;
      ph.push({ type: 'coast', phi: pMax, label: 'Coasting', dt: Infinity });
    }
    // cumulative starts
    let t = 0, x = 0, tau = 0;
    for (const p of ph) {
      p.t0 = t; p.x0 = x; p.tau0 = tau;
      if (p.type === 'coast') { p.dx = p.dt * C * Math.tanh(p.phi); p.dtau = p.dt / Math.cosh(p.phi); }
      t += p.dt; x += p.dx; tau += p.dtau;
    }
    this.phases = ph;
    this.burnEnd = ph.filter((p) => p.type === 'thrust').reduce((m, p) => Math.max(m, p.t0 + p.dt), 0);
    this.tArrive = rendezvous ? ph[ph.length - 1].t0 : this.timeAtDistance(L);
  }

  at(t) {
    let p = this.phases[0];
    for (const q of this.phases) { if (t >= q.t0) p = q; else break; }
    const dt = Math.max(0, t - p.t0);
    if (p.type === 'coast') {
      const b = Math.tanh(p.phi);
      return { x: p.x0 + (p.dt === Infinity || dt <= p.dt ? b * C * dt : p.dx), phi: p.phi, tau: p.tau0 + dt / Math.cosh(p.phi), a: 0, label: p.label, flip: false, rest: !!p.rest };
    }
    const tt = Math.min(dt, p.dt);
    const phi = Math.asinh(Math.sinh(p.p0) + p.a * tt / C);
    return { x: p.x0 + (C * C / p.a) * coshDiff(phi, p.p0), phi, tau: p.tau0 + (C / p.a) * (phi - p.p0), a: p.a, label: p.label, flip: !!p.flip, rest: false };
  }

  timeAtDistance(L) {
    let hi = 1;
    while (this.at(hi).x < L) { hi *= 2; if (hi > 1e30) return Infinity; }
    let lo = 0;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (this.at(m).x < L) lo = m; else hi = m; }
    return hi;
  }
}

// ---------------------------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------------------------
const EARTH_R = 6.371e6;
// Departure from a 2,500 km parking orbit: high enough that Earth reads as a globe at launch.
export const DEPART_ALT = 2.5e6;

export class Mission {
  constructor(probe, dest, launchT, world) {
    this.probe = probe; this.dest = dest; this.world = world;
    this.requestedLaunch = launchT;
    this.t0 = launchT;
    this.note = '';
    const inSystem = dest.kind === 'planet';
    if (probe.kind === 'ballistic' && inSystem) this.planBallistic();
    else this.planStraight();
  }

  earthPos(t) { return planetPos('earth', t); }

  // ---- straight-line relativistic kinematics (burns, coasts, constant cruise)
  planStraight() {
    const p = this.probe, d = this.dest;
    const rendezvous = p.kind === 'thrust' && !p.flyby;
    let tArr = 0, S, T, dir, prof;
    // The ship leaves with Earth's orbital velocity (~30 km/s) and keeps it while it is still near
    // Earth; the effect is modelled as a drift that saturates after ~a month so the heliocentric
    // cruise speeds of Voyager/Parker are not altered. (A shorter fade makes Earth slide sideways
    // during the climb-out, so the departure no longer looks radial.)
    this.vE = planetVel('earth', this.t0);
    const E = this.earthPos(this.t0);
    for (let i = 0; i < 40; i++) {
      this.tauD = 30 * DAY;
      const Tc = v3.sub(d.pos(this.t0 + tArr), this.drift(tArr));
      dir = v3.norm(v3.sub(Tc, E));
      S = v3.add(E, v3.scale(dir, EARTH_R + DEPART_ALT));
      T = v3.sub(Tc, v3.scale(dir, d.standoff));
      const L = v3.len(v3.sub(T, S));
      prof = p.kind === 'cruise' ? new Profile({ v: p.v, L })
        : p.kind === 'ballistic' ? new Profile({ v: p.cruise, L })
          : new Profile({ stages: p.stages, L, rendezvous });
      if (Math.abs(prof.tArrive - tArr) < 1) break;
      tArr = prof.tArrive;
    }
    this.mode = 'straight';
    this.S = S; this.T = T; this.dir = v3.norm(v3.sub(T, S)); this.L = v3.len(v3.sub(T, S));
    this.prof = prof; this.rendezvous = rendezvous;
    this.tArrive = prof.tArrive;
    // A target that moves faster than the probe (e.g. Proxima b vs Voyager) can't be intercepted by
    // iteration; blend in the remaining miss over the last few percent of the trip.
    const want = v3.sub(v3.sub(d.pos(this.t0 + this.tArrive), this.drift(this.tArrive)), v3.scale(dir, d.standoff));
    this.corr = v3.sub(want, T);
    this.flyby = !rendezvous;
    if (p.kind === 'ballistic') this.note = 'Straight-line cruise at Voyager 1\'s real escape speed.';
    if (p.kind === 'cruise') this.note = 'Idealised: record speed held constant, gravity ignored.';
  }

  drift(t) { return v3.scale(this.vE, this.tauD * (1 - Math.exp(-Math.max(t, 0) / this.tauD))); }

  // ---- real two-body trajectory (Lambert), with a launch-window search
  planBallistic() {
    const p = this.probe, d = this.dest;
    this.mode = 'ballistic'; this.flyby = true; this.rendezvous = false;
    if (d.id === 'moon') {
      // Geocentric: leave a 200 km parking orbit, arrive at the Moon. Cap = New Horizons' burnout speed.
      const best = { tof: Infinity };
      for (let tof = 3 * 3600; tof < 6 * DAY; tof *= 1.03) {
        const r2 = moonGeo(this.t0 + tof);
        const h = v3.norm(v3.cross(moonGeo(this.t0), moonGeo(this.t0 + 3600)));
        const ang = -150 * Math.PI / 180, u = v3.norm(r2), w = v3.cross(h, u);
        const r1 = v3.scale(v3.add(v3.scale(u, Math.cos(ang)), v3.scale(w, Math.sin(ang))), EARTH_R + 2e5);
        const sol = lambert(r1, r2, tof, GM_EARTH, h);
        if (sol && v3.len(sol.v1) <= p.moonSpeed) { Object.assign(best, { tof, r1, v1: sol.v1 }); break; }
      }
      this.center = 'earth'; this.mu = GM_EARTH;
      this.r0 = best.r1; this.v0 = best.v1; this.tArrive = best.tof;
      const chordM = v3.sub(moonGeo(this.t0 + best.tof), best.r1);
      this.arrOffset = v3.scale(v3.norm(v3.cross(chordM, [0, 0, 1])), d.standoff);
      this.note = 'Two-body trajectory from low Earth orbit at New Horizons\' launch speed (16.26 km/s).';
      return;
    }
    const target = d.body;
    const Pt = orbitalPeriod(target), Pe = orbitalPeriod('earth');
    const syn = Math.abs(1 / (1 / Pe - 1 / Pt));
    const aT = Math.cbrt(GM_SUN * (Pt / (2 * Math.PI)) ** 2), aE = Math.cbrt(GM_SUN * (Pe / (2 * Math.PI)) ** 2);
    const hoh = Math.PI * Math.sqrt(((aT + aE) / 2) ** 3 / GM_SUN);
    let best = null;
    const win = Math.min(syn * 1.05, 3 * YEAR);
    for (let k = 0; k <= 160; k++) {
      const t0 = this.requestedLaunch + (win * k) / 160;
      if (best && t0 > best.arr) break;
      const r1 = planetPos('earth', t0), vE = planetVel('earth', t0);
      for (let f = 0.12; f < 2.5; f *= 1.04) {
        const tof = hoh * f;
        if (best && t0 + tof > best.arr) break;
        const r2 = planetPos(target, t0 + tof);
        const sol = lambert(r1, r2, tof, GM_SUN);
        if (!sol) continue;
        if (v3.len(v3.sub(sol.v1, vE)) <= p.vinf) {
          best = { t0, tof, arr: t0 + tof, r1, v1: sol.v1, vinf: v3.len(v3.sub(sol.v1, vE)) };
          break;
        }
      }
    }
    if (!best) { this.planStraight(); return; }
    this.center = 'sun'; this.mu = GM_SUN;
    this.t0 = best.t0; this.r0 = best.r1; this.v0 = best.v1; this.tArrive = best.tof;
    this.vinfUsed = best.vinf;
    const wait = (best.t0 - this.requestedLaunch) / DAY;
    this.note = `Real two-body transfer orbit, launch v∞ ${(best.vinf / 1000).toFixed(1)} km/s` +
      (wait > 1 ? ` · waited ${Math.round(wait)} days for the launch window` : ' · launch window open now');
    // cosmetic offsets so the path starts above Earth and passes beside (not through) the target
    const chord = v3.sub(planetPos(target, best.arr), best.r1);
    this.arrOffset = v3.scale(v3.norm(v3.cross(chord, [0, 0, 1])), d.standoff);
  }

  /** State at absolute sim time. pos/vel in world metres, m/s. After arrival the probe orbits the target. */
  stateAt(simT) {
    if (simT - this.t0 >= this.tArrive) return this.orbitState(simT);
    return this.travelState(simT);
  }

  // Arrival: the probe is placed on a circular orbit (or holds station at a galaxy), starting exactly
  // where the trip ended so the motion is continuous. Flyby designs could not really brake — the
  // arrival card says so.
  setupOrbit() {
    const tA = this.t0 + this.tArrive;
    const s = this.travelState(tA);
    const c = this.dest.pos(tA);
    const r = v3.sub(s.pos, c), R = v3.len(r);
    let n = v3.cross(r, s.vel);
    if (v3.len(n) < 1e-6 * R * (v3.len(s.vel) + 1)) n = v3.cross(r, [0, 0, 1]);
    if (v3.len(n) < 1e-9) n = v3.cross(r, [1, 0, 0]);
    const u = v3.scale(r, 1 / R), nn = v3.norm(n), w = v3.cross(nn, u);
    const P = this.dest.gm ? 2 * Math.PI * Math.sqrt(R ** 3 / this.dest.gm) : Infinity;
    this.orbit = { R, u, w, n: nn, P, tA, tau: this.shipTimeAtArrival() };
  }

  orbitState(simT) {
    if (!this.orbit) this.setupOrbit();
    const o = this.orbit, dt = simT - o.tA;
    const th = isFinite(o.P) ? (2 * Math.PI * dt) / o.P : 0;
    const c = this.dest.pos(simT);
    const pos = v3.add(c, v3.scale(v3.add(v3.scale(o.u, Math.cos(th)), v3.scale(o.w, Math.sin(th))), o.R));
    const vdir = v3.add(v3.scale(o.u, -Math.sin(th)), v3.scale(o.w, Math.cos(th)));
    const sp = isFinite(o.P) ? (2 * Math.PI * o.R) / o.P : 0;
    const label = !isFinite(o.P) ? `Holding position at ${this.dest.short || this.dest.name}` : `In orbit around ${this.dest.short || this.dest.name}`;
    return {
      pos, vel: v3.scale(vdir, sp), beta: sp / C, phi: Math.atanh(Math.min(sp / C, 0.999)), gamma: 1, tau: o.tau, accel: 0, label,
      thrustDir: null, noseDir: sp > 0 ? vdir : this.dir || [1, 0, 0], arrived: true, progress: 1, orbiting: true,
    };
  }

  travelState(simT) {
    const t = simT - this.t0;
    if (this.mode === 'ballistic') {
      const tt = Math.max(0, t);
      const [r, v] = propagate(this.r0, this.v0, tt, this.mu);
      let pos = this.center === 'earth' ? v3.add(this.earthPos(simT), r) : r;
      let vel = v;
      if (this.center === 'earth') vel = v3.add(v, planetVel('earth', simT));
      if (this.arrOffset) {
        const s = Math.min(1, tt / (this.tArrive * 0.6));
        pos = v3.add(pos, v3.scale(this.arrOffset, s * s * (3 - 2 * s)));
      }
      // first two hours: lift the drawn path clear of Earth's surface (the conic starts at its centre)
      const lift = 1 - Math.min(1, tt / 7200);
      pos = v3.add(pos, v3.scale(v3.norm(v), EARTH_R * 1.3 * lift));
      const sp = v3.len(v);
      return {
        pos, vel, beta: sp / C, phi: Math.atanh(sp / C), gamma: 1 / Math.sqrt(1 - (sp / C) ** 2), tau: tt * (1 - 0.5 * (sp / C) ** 2),
        accel: 0, label: t < 0 ? 'Waiting for launch window' : t < this.tArrive ? 'Coasting on a transfer orbit' : 'Flyby complete — escaping',
        thrustDir: null, noseDir: v3.norm(v), arrived: t >= this.tArrive, progress: Math.min(1, tt / this.tArrive),
      };
    }
    const s = this.prof.at(Math.max(0, t));
    let pos;
    if (this.rendezvous && t >= this.tArrive) pos = v3.sub(this.dest.pos(simT), v3.scale(this.dir, this.dest.standoff));
    else pos = v3.add(v3.add(this.S, v3.scale(this.dir, s.x)), this.drift(t));
    if (this.corr) {
      const f = Math.max(0, Math.min(1, (s.x / this.L - 0.94) / 0.06));
      pos = v3.add(pos, v3.scale(this.corr, f * f * (3 - 2 * f)));
    }
    const beta = Math.tanh(s.phi);
    const vel = v3.scale(this.dir, beta * C);
    const noseDir = s.flip ? v3.scale(this.dir, -1) : this.dir;
    return {
      pos, vel, beta, phi: s.phi, gamma: Math.cosh(s.phi), tau: s.tau, accel: Math.abs(s.a), label: s.label,
      thrustDir: s.a ? noseDir : null, noseDir, flip: s.flip, arrived: t >= this.tArrive,
      progress: Math.min(1, s.x / this.L),
    };
  }

  /**
   * Position t s after launch minus the position at tRef, formed as a difference of the parts (distance
   * along the line, Earth-velocity drift, final correction) so it stays exact 10²² m from the Sun,
   * where whole positions resolve only to thousands of km.
   */
  travelDelta(t, tRef) {
    if (this.mode === 'ballistic') return v3.sub(this.travelState(this.t0 + t).pos, this.travelState(this.t0 + tRef).pos);
    const part = (tt) => {
      const x = this.prof.at(Math.max(0, tt)).x;
      const f = this.corr ? Math.max(0, Math.min(1, (x / this.L - 0.94) / 0.06)) : 0;
      return { x, extra: v3.add(this.drift(tt), this.corr ? v3.scale(this.corr, f * f * (3 - 2 * f)) : [0, 0, 0]) };
    };
    const a = part(t), b = part(tRef);
    return v3.add(v3.scale(this.dir, a.x - b.x), v3.sub(a.extra, b.extra));
  }

  /** Points along the path for drawing (world metres). */
  pathPoints(n = 256) {
    if (this.mode === 'straight') return [this.S, this.T];
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(this.travelState(this.t0 + (this.tArrive * i) / n).pos);
    return pts;
  }

  /** Ship (proper) time at arrival. */
  shipTimeAtArrival() {
    if (this.mode === 'ballistic') return this.tArrive;
    return this.prof.at(this.tArrive).tau;
  }
  maxBeta() {
    if (this.mode === 'ballistic') return v3.len(this.v0) / C;
    return Math.max(...this.prof.phases.map((p) => Math.tanh(p.type === 'coast' ? p.phi : Math.max(Math.abs(p.p0), Math.abs(p.p1)))));
  }
  /** Ideal photon-rocket mass ratio m0/m1 = e^(Δφ) for the thrust phases (only meaningful for the antimatter ship). */
  massRatio() {
    if (this.mode !== 'straight' || !this.prof.phases.some((p) => p.type === 'thrust')) return null;
    const dphi = this.prof.phases.filter((p) => p.type === 'thrust').reduce((s, p) => s + Math.abs(p.p1 - p.p0), 0);
    return Math.exp(dphi);
  }
}
