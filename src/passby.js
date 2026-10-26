import * as THREE from 'three';
import { AU, v3 } from './constants.js';
import { Planet } from './bodies.js';
import { RADIUS } from './destinations.js';
import { niceRate } from './timeflow.js';
import { MoonSystem, MOONS } from './moons.js';

// Illustrative passbys. A real straight-line trip passes nowhere near the planets, so where the ship
// crosses a planet's orbit a stand-in is placed beside the flight path (2.6 radii off it) and the ship
// flies past it at its real speed, in sim time. It comes into view from ~2,000 radii away and rushes in
// at the trip's normal time flow; only within SLOW radii does time drop to a pass rate, so the close
// pass is watchable, then it rushes off again (see flybyWindows). The asteroid belt and Oort cloud are scenery: real bodies there
// are millions of km apart, so a field of rocks streams past for a few seconds of screen time instead.
// All are labelled as illustrations; the planets at their true positions are untouched.

const ORBIT = { mercury: 0.387, venus: 0.723, mars: 1.524, jupiter: 5.203, saturn: 9.537, uranus: 19.19, neptune: 30.07, pluto: 39.48 };
const FIELD_S = 9;    // seconds on screen per rock field
const SIDE = 2.6;     // closest approach, in planet radii
const VIEW = 2000;    // in view while within this many radii (ahead or behind)
const SLOW = 15;      // time slows only while the stand-in is within this many radii
const PASS = 5;       // during the pass, the ship covers this many radii per screen second
const ZAP = 300, ZAP_S = 0.3; // the rush in from 300 radii is given at least 0.3 s so it can be seen
const LOOK = 1200;    // the cinematic camera starts turning toward a stand-in this many radii out…
const HOLD = 1;       // …and keeps watching it for this many screen seconds after the slow pass
// Up close the planet's direction swings round faster than any smooth camera can follow (up to ~110°/s
// at 2.6 radii). The camera instead sweeps as if the planet passed CAM_SIDE radii out: same start and
// end, peaking at ~48°/s for a moment at closest approach, and staying within ~22° of the planet's
// real direction while the planet is big in the view.
const CAM_SIDE = 6;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const bumps = Array.from({ length: 6 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, 0.15 + rnd() * 0.25]);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
    let r = 1;
    for (const [x, y, z, a] of bumps) r += a * Math.max(0, v.x * x + v.y * y + v.z * z) ** 2 - a * 0.25;
    v.multiplyScalar(r);
    v.y *= 0.75;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function rockField(color, rough, count, seed) {
  const geo = rockGeometry(seed);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  let s = seed * 7 + 3;
  const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  // positions in units of the ship's length, in a frame with z pointing along the flight
  mesh.userData.rocks = Array.from({ length: count }, () => {
    let x, y;
    do { x = (rnd() * 2 - 1) * 34; y = (rnd() * 2 - 1) * 16; } while (Math.hypot(x, y * 1.4) < 2.2);
    const big = rnd() < 0.08;
    return {
      x, y, z: 20 + rnd() * 150, size: (big ? 1.2 + rnd() * 1.6 : 0.12 + rnd() * 0.55) * (0.6 + Math.hypot(x, y) / 30),
      axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: (rnd() - 0.5) * 1.6, rot: rnd() * 6,
    };
  });
  mesh.visible = false;
  return mesh;
}

export class Passbys {
  constructor(probeScene, mainScene) {
    this.mainScene = mainScene;
    this.planets = {};
    this.belt = rockField(0x6e655c, 1.0, 240, 11);
    this.oort = rockField(0xcfdcec, 0.55, 260, 29);
    this.fieldGroup = new THREE.Group();
    this.fieldGroup.add(this.belt, this.oort);
    probeScene.add(this.fieldGroup);
    this.systems = {};
    this.events = []; this.queue = []; this.active = [];
    this.focus = null; // { dir (unit, world), weight 0–1 }: where the cinematic camera should look
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
  }

  planet(id) {
    if (!this.planets[id]) {
      const p = new Planet(id, RADIUS[id]);
      p.root.visible = false;
      this.mainScene.add(p.root);
      this.planets[id] = p;
      if (MOONS[id]) this.systems[id] = new MoonSystem(id, this.mainScene, 0);
    }
    return this.planets[id];
  }

  /** Crossing times come from the real flight path. */
  setMission(m, tracker) {
    this.clear();
    const ev = [];
    const pos = (t) => m.travelState(t).pos;
    const dest = m.dest.body || m.dest.id;
    if (m.dest.id !== 'moon') {
      const mo = tracker.nodes.find((n) => n.name === 'Moon distance');
      if (mo) ev.push({ t: mo.t, kind: 'planet', id: 'moon', name: 'the Moon' });
      for (const [id, a] of Object.entries(ORBIT)) {
        if (id === dest) continue;
        const tc = tracker.cross((t) => v3.len(pos(t)), a * AU);
        if (tc) ev.push({ t: tc - m.t0, kind: 'planet', id, name: cap(id) });
      }
      // the sim-time window in which each stand-in is in view, at the ship's real speed there
      for (const e of ev) {
        const R = RADIUS[e.id], v = Math.max(1, v3.len(m.travelState(m.t0 + e.t).vel));
        e.v = v; e.R = R;
        e.w0 = Math.max(0, e.t - (VIEW * R) / v);
        e.w1 = Math.min(m.tArrive, e.t + (VIEW * R) / v);
        e.rate = niceRate(Math.max(1, (PASS * R) / v));
      }
      const tb = tracker.cross((t) => v3.len(pos(t)), 2.7 * AU);
      if (tb && !['mars', 'mercury', 'venus'].includes(dest)) ev.push({ t: tb - m.t0, kind: 'field', field: this.belt, name: 'Asteroid belt', r: 2.7 * AU });
      const to = tracker.cross((t) => v3.len(pos(t)), 2000 * AU);
      if (to) ev.push({ t: to - m.t0, kind: 'field', field: this.oort, name: 'Oort cloud', r: 2000 * AU });
    }
    this.events = ev.sort((a, b) => a.t - b.t);
    this.next = 0; this.queue = [];
  }

  /** Slow-motion windows for the time flow: [{t0, t1, tc (closest approach), rate, z0, zrate (the rush in), name, speed, body}], s after launch. */
  flybyWindows() {
    return this.events.filter((e) => e.kind === 'planet' && e.w1 > e.w0).map((e) => ({
      t0: Math.max(0, e.t - (SLOW * e.R) / e.v), t1: e.t + (SLOW * e.R) / e.v, tc: e.t, rate: e.rate,
      z0: Math.max(0, e.t - (ZAP * e.R) / e.v), zrate: ((ZAP - SLOW) * e.R) / e.v / ZAP_S,
      name: `Flyby · ${e.name[0].toUpperCase() + e.name.slice(1)}`, speed: e.v, body: e.name,
    }));
  }

  clear() {
    for (const a of this.active) this.hide(a);
    this.active = [];
    for (const e of this.events) if (e.kind === 'planet' && e.basis) this.hidePlanet(e);
    this.focus = null;
  }

  hide(a) { a.field.visible = false; }
  hidePlanet(e) { this.planet(e.id).root.visible = false; this.systems[e.id]?.hide(); e.basis = null; e.passAt = undefined; }

  /**
   * rel: s after launch; clock: screen-time s that only advances while the sim plays (so passbys pause
   * with it); ctx: { st, t, shipLen, place(obj, world, scale), probePos (THREE.Vector3), travelDir,
   *   camF, camR (camera view direction and right, world), sunColor, label(text, world), moons (MoonSystem ctx) }
   */
  update(rel, clock, ctx) {
    // planets: positioned by sim time, so they pass at the ship's real speed and freeze when paused
    this.focus = null;
    for (const e of this.events) {
      if (e.kind !== 'planet') continue;
      if (rel >= e.w0 && rel <= e.w1) {
        if (!e.basis) e.basis = this.basis(ctx);
        this.drawPlanet(e, rel, clock, ctx);
      } else if (e.basis) this.hidePlanet(e);
    }
    // rock fields: a few seconds of screen time each
    const wall = clock;
    while (this.next < this.events.length && this.events[this.next].t <= rel) {
      const e = this.events[this.next++];
      // a field the ship has long left behind (the timeline jumped past it) is skipped, not played late
      if (e.kind === 'field' && v3.len(ctx.st.pos) < 2 * e.r) this.queue.push(e);
    }
    if (this.queue.length > 1) this.queue.splice(0, this.queue.length - 1);
    if (this.queue.length && !this.active.length) {
      const e = this.queue.shift();
      this.active.push({ ...e, ...this.basis(ctx), start: wall, dur: FIELD_S });
    }
    for (const a of [...this.active]) {
      const u = (wall - a.start) / a.dur;
      if (u >= 1 || u < 0) { this.hide(a); this.active.splice(this.active.indexOf(a), 1); continue; }
      this.drawField(a, u, ctx);
    }
  }

  // stand-ins move exactly opposite to the ship's travel (ahead → behind), on the side the camera is
  // looking toward, so they stay in view and agree with the motion from any viewpoint
  basis(ctx) {
    const f = ctx.travelDir;
    let side = v3.sub(ctx.camF, v3.scale(f, v3.dot(ctx.camF, f)));
    side = v3.len(side) > 0.15 ? v3.norm(side) : ctx.camR;
    return { f, side, up: v3.norm(v3.cross(f, side)) };
  }

  drawPlanet(e, rel, clock, ctx) {
    const p = this.planet(e.id), R = e.R, { f, side, up } = e.basis;
    // on a line parallel to the flight path; the ship covers it at its real speed
    const along = e.v * (e.t - rel);
    const w = v3.add(v3.add(ctx.st.pos, v3.scale(side, SIDE * R)), v3.add(v3.scale(up, 0.35 * R), v3.scale(f, along)));
    p.root.visible = true;
    ctx.place(p.root, w, R);
    const sun = v3.norm(v3.scale(w, -1));
    p.update(ctx.t, new THREE.Vector3(...sun), ctx.sunColor);
    if (along > -20 * R) ctx.label(`${e.name[0].toUpperCase() + e.name.slice(1)}<small>illustrative pass</small>`, w);
    this.systems[e.id]?.update(w, ctx.moons);
    // for the cinematic camera: turn toward it as it rushes in, watch it go by, then let go
    const s = along / R, th = Math.atan2(CAM_SIDE, s);
    const out = v3.norm(v3.add(v3.scale(side, SIDE), v3.scale(up, 0.35)));
    const dir = v3.add(v3.scale(f, Math.cos(th)), v3.scale(out, Math.sin(th)));
    let weight;
    if (s > 0) { const u = Math.max(0, Math.min(1, (LOOK - s) / (0.5 * LOOK))); weight = u * u * (3 - 2 * u); }
    else if (s > -SLOW) weight = 1;
    else { if (e.passAt === undefined) e.passAt = clock; weight = clock - e.passAt < HOLD ? 1 : 0; }
    if (weight > (this.focus?.weight || 0)) this.focus = { dir, weight };
  }

  drawField(a, u, ctx) {
    const mesh = a.field, L = ctx.shipLen;
    mesh.visible = true;
    const g = this.fieldGroup;
    g.position.copy(ctx.probePos);
    const x = new THREE.Vector3(...a.side), y = new THREE.Vector3(...a.up), z = new THREE.Vector3(...a.f);
    g.quaternion.setFromRotationMatrix(this.m4.makeBasis(x, y, z));
    const travel = u * 230;
    const fade = Math.min(1, u / 0.08, (1 - u) / 0.12);
    mesh.userData.rocks.forEach((r, i) => {
      const zz = r.z - travel;
      const k = zz > 150 ? 0 : zz < -60 ? 0 : Math.min(1, (150 - zz) / 30) * fade;
      this.q.setFromAxisAngle(r.axis, r.rot + r.spin * u * a.dur);
      this.v.set(r.x * L, r.y * L, zz * L);
      this.s.setScalar(Math.max(1e-6, r.size * L * k));
      mesh.setMatrixAt(i, this.m4.compose(this.v, this.q, this.s));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (u < 0.75) ctx.label(`${a.name}<small>illustrative pass</small>`, v3.add(ctx.st.pos, v3.scale(a.f, 40 * L)));
  }
}
