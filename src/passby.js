import * as THREE from 'three';
import { AU, v3 } from './constants.js';
import { Planet } from './bodies.js';
import { RADIUS } from './destinations.js';
import { niceRate } from './timeflow.js';
import { MoonSystem, MOONS } from './moons.js';

// Illustrative passbys. A real straight-line trip passes nowhere near the planets, so where the ship
// crosses a planet's orbit a stand-in is placed beside the flight path (1.14 radii off it, a low pass like Juno's or Cassini's) and the ship
// flies past it at its real speed, in sim time. It comes into view from ~2,000 radii away and rushes in
// at the trip's normal time flow; only within SLOW radii does time drop to a pass rate, so the close
// pass is watchable, then it rushes off again (see flybyWindows). The asteroid belt and Oort cloud are scenery: real bodies there
// are millions of km apart, so a field of rocks streams past for a few seconds of screen time instead.
// All are labelled as illustrations; the planets at their true positions are untouched.

const ORBIT = { mercury: 0.387, venus: 0.723, mars: 1.524, jupiter: 5.203, saturn: 9.537, uranus: 19.19, neptune: 30.07, pluto: 39.48 };
const FIELD_S = 9;    // seconds on screen per rock field
const SIDE = 1.1, LIFT = 0.3; // closest approach ≈ 1.14 radii (Jupiter: ~10,000 km above the clouds; Juno skims 4,000 km)
const VIEW = 3200;    // in view while within this many radii (ahead or behind)
const SLOW = 18;      // time slows to close-pass rate within this many radii
const PASS = 8.5;     // during the close pass, the ship covers this many radii per screen second
const LOOK = 2200;    // the cinematic camera starts turning toward a stand-in this many radii out…
const CAM_SIDE = 7.5; // camera sweeps as if the planet passed CAM_SIDE radii out
const ALPHA = 1.75;   // power-law ramp from close-pass rate to cruise rate
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
        e.t0 = Math.max(0, e.t - (SLOW * R) / v);
        e.t1 = Math.min(m.tArrive, e.t + (SLOW * R) / v);
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

  /** Slow-motion windows for the time flow: [{t0, t1, w0, w1, tc (closest approach), rate, name, speed, body, v, R, durScreen, rateAt}], s after launch. */
  flybyWindows() {
    return this.events.filter((e) => e.kind === 'planet' && e.w1 > e.w0).map((e) => ({
      t0: e.t0,
      t1: e.t1,
      w0: e.w0,
      w1: e.w1,
      tc: e.t,
      rate: e.rate,
      v: e.v,
      R: e.R,
      name: `Flyby · ${e.name[0].toUpperCase() + e.name.slice(1)}`,
      speed: e.v,
      body: e.name,
      durScreen: 9.8,
      rateAt(rel, cruiseRate) {
        const s = Math.abs(e.t - rel) * e.v / e.R;
        if (s <= SLOW) return e.rate;
        if (s >= VIEW) return cruiseRate;
        const ramp = e.rate * Math.pow(s / SLOW, ALPHA);
        return Math.max(e.rate, Math.min(cruiseRate, ramp));
      },
    }));
  }

  clear() {
    for (const a of this.active) this.hide(a);
    this.active = [];
    for (const e of this.events) if (e.kind === 'planet' && e.basis) this.hidePlanet(e);
    this.focus = null;
  }

  hide(a) { a.field.visible = false; }
  hidePlanet(e) { this.planet(e.id).root.visible = false; this.systems[e.id]?.hide(); e.basis = null; e.heard = false; }

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
        if (!e.basis) e.basis = this.basis(ctx, true);
        this.drawPlanet(e, rel, clock, ctx);
      } else if (e.basis) this.hidePlanet(e);
    }
    // rock fields: a few seconds of screen time each
    const wall = clock;
    while (this.next < this.events.length && this.events[this.next].t <= rel) {
      const e = this.events[this.next++];
      // a field the ship has long left behind (the timeline jumped past it) is skipped, not played late
      if (e.kind === 'field' && v3.len(ctx.st.pos) < 1.3 * e.r) this.queue.push(e);
    }
    if (this.queue.length > 1) this.queue.splice(0, this.queue.length - 1);
    if (this.queue.length && !this.active.length) {
      const e = this.queue.shift();
      // faster than light (warp) the rocks flash past in about a second, like the planets do
      const dur = ctx.st.beta > 1 ? 1.2 : FIELD_S;
      this.active.push({ ...e, ...this.basis(ctx), start: wall, dur });
      this.onField?.(dur);
    }
    for (const a of [...this.active]) {
      const u = (wall - a.start) / a.dur;
      if (u >= 1 || u < 0) { this.hide(a); this.active.splice(this.active.indexOf(a), 1); continue; }
      this.drawField(a, u, ctx);
    }
  }

  // stand-ins move exactly opposite to the ship's travel (ahead → behind), on the side the camera is
  // looking toward, so they stay in view and agree with the motion from any viewpoint
  // dayside: a planet goes on the far side of the path from the Sun, so the pass is over its lit face
  basis(ctx, dayside = false) {
    const f = ctx.travelDir;
    let side = v3.sub(ctx.camF, v3.scale(f, v3.dot(ctx.camF, f)));
    side = v3.len(side) > 0.15 ? v3.norm(side) : ctx.camR;
    if (dayside) {
      const toSun = v3.norm(v3.scale(ctx.st.pos, -1)), away = v3.scale(v3.sub(toSun, v3.scale(f, v3.dot(toSun, f))), -1);
      // with the Sun nearly straight behind or ahead any side is lit alike: keep the camera's side
      if (v3.len(away) > 0.05) side = v3.norm(v3.add(v3.scale(v3.norm(away), 0.85), v3.scale(side, 0.15)));
      side = v3.norm(v3.sub(side, v3.scale(f, v3.dot(side, f))));
    }
    return { f, side, up: v3.norm(v3.cross(f, side)) };
  }

  drawPlanet(e, rel, clock, ctx) {
    const p = this.planet(e.id), R = e.R, { f, side, up } = e.basis;
    // on a line parallel to the flight path; the ship covers it at its real speed
    const along = e.v * (e.t - rel);
    const s = along / R;
    const absS = Math.abs(s);
    // Smooth distance fade near the outer edge of VIEW so the planet emerges from/shrinks to zero
    const fade = Math.min(1, Math.max(0, (VIEW - absS) / (VIEW * 0.25)));
    const w = v3.add(v3.add(ctx.st.pos, v3.scale(side, SIDE * R)), v3.add(v3.scale(up, LIFT * R), v3.scale(f, along)));

    if (fade > 0.001) {
      p.root.visible = true;
      ctx.place(p.root, w, R * fade);
      const sun = v3.norm(v3.scale(w, -1));
      p.update(ctx.t, new THREE.Vector3(...sun), ctx.sunColor);
      if (along > -100 * R && along < 1500 * R && fade > 0.1) {
        ctx.label(`${e.name[0].toUpperCase() + e.name.slice(1)}<small>illustrative pass</small>`, w);
      }
      this.systems[e.id]?.update(w, ctx.moons);
    } else {
      p.root.visible = false;
      this.systems[e.id]?.hide();
    }

    // sound: the whoosh is started ~1 screen second (at PASS rate) before closest approach
    if (!e.heard && s <= PASS && s > -SLOW) { e.heard = true; this.onPass?.(e); }

    // for the cinematic camera: turn smoothly toward the planet as it approaches from afar,
    // follow it as it sweeps past up close, and watch it smoothly recede into deep space
    const th = Math.atan2(CAM_SIDE, s);
    const out = v3.norm(v3.add(v3.scale(side, SIDE), v3.scale(up, LIFT)));
    const dir = v3.add(v3.scale(f, Math.cos(th)), v3.scale(out, Math.sin(th)));
    let weight = 0;
    if (s >= SLOW) {
      const u = Math.max(0, Math.min(1, (LOOK - s) / (LOOK - SLOW)));
      weight = u * u * (3 - 2 * u);
    } else if (s >= -SLOW) {
      weight = 1;
    } else {
      const u = Math.max(0, Math.min(1, (-s - SLOW) / (LOOK - SLOW)));
      weight = 1 - u * u * (3 - 2 * u);
    }
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
