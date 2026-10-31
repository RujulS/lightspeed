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
// pass is watchable, then it rushes off again (see flybyWindows). The asteroid belt, Kuiper belt and Oort cloud are scenery:
// high-speed streams of rocks and cometary ice zip past the ship, with deflectors absorbing frontal kinetic impacts.
// All are labelled as illustrations; the planets at their true positions are untouched.

const ORBIT = { mercury: 0.387, venus: 0.723, mars: 1.524, jupiter: 5.203, saturn: 9.537, uranus: 19.19, neptune: 30.07, pluto: 39.48 };
const FIELD_S = 8.5;  // seconds on screen per rock field
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

const STREAM_SPAN = 420; // total length of the streaming corridor in ship lengths

function rockField(color, rough, count, seed, type = 'asteroid') {
  const geo = rockGeometry(seed);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: type === 'asteroid' ? 0.2 : 0.05, flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  let s = seed * 7 + 3;
  const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);

  // Distribute rocks: majority stream past with high speed and close razor-passes;
  // a targeted subset (~8) are aimed directly at the nose to collide with the forward shield.
  const rocks = [];
  const hitTargetCount = Math.max(6, Math.floor(count * 0.05));

  for (let i = 0; i < count; i++) {
    const hitShield = i < hitTargetCount;
    let x, y;
    if (hitShield) {
      // Aimed inside the forward cross-section of the ship's deflector shield
      const ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * 0.24;
      x = Math.cos(ang) * rad;
      y = Math.sin(ang) * rad * 0.85;
    } else {
      // Near and wide field distribution
      const near = rnd() < 0.4;
      if (near) {
        // High-speed close flybys (1 to 4 ship lengths)
        const ang = rnd() * Math.PI * 2, rad = 0.4 + rnd() * 3.5;
        x = Math.cos(ang) * rad;
        y = Math.sin(ang) * rad * 0.85;
      } else {
        // Wide field
        x = (rnd() * 2 - 1) * 36;
        y = (rnd() * 2 - 1) * 20;
        if (Math.hypot(x, y * 1.3) < 0.9) x += x > 0 ? 1.5 : -1.5;
      }
    }

    const big = !hitShield && rnd() < 0.06;
    const baseZ = hitShield ? 30 + (i / hitTargetCount) * (STREAM_SPAN - 80) : rnd() * STREAM_SPAN;
    const size = hitShield
      ? 0.06 + rnd() * 0.1
      : (big ? 1.0 + rnd() * 1.4 : 0.09 + rnd() * 0.4) * (0.6 + Math.hypot(x, y) / 32);

    rocks.push({
      x, y, baseZ,
      size,
      speedExtra: (rnd() - 0.5) * 50,
      hitShield,
      lastCycle: -1,
      axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
      spin: (rnd() - 0.5) * 4.5,
      rot: rnd() * 6.28,
    });
  }

  mesh.userData.rocks = rocks;
  mesh.visible = false;
  return mesh;
}

export class Passbys {
  constructor(probeScene, mainScene) {
    this.mainScene = mainScene;
    this.probeScene = probeScene;
    this.planets = {};
    this.belt = rockField(0x756c62, 1.0, 160, 11, 'asteroid');
    this.kuiper = rockField(0x8f7869, 0.85, 160, 42, 'kuiper');
    this.oort = rockField(0xc2ddf5, 0.45, 180, 29, 'oort');

    this.fieldGroup = new THREE.Group();
    this.fieldGroup.add(this.belt, this.kuiper, this.oort);

    // ---- Forward deflector shield system
    this.initShield();
    this.initSparks();

    probeScene.add(this.fieldGroup);

    this.systems = {};
    this.events = []; this.queue = []; this.active = [];
    this.focus = null; // { dir (unit, world), weight 0–1 }: where the cinematic camera should look
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.lastWall = 0;
    this.lastRockWhoosh = 0;
  }

  initShield() {
    // Parabolic energy dome at the ship's nose
    const shieldGeo = new THREE.CylinderGeometry(0.01, 0.38, 0.16, 36, 1, true);
    shieldGeo.rotateX(Math.PI / 2);

    this.hits = []; // active impact ripples: { x, y, age, intensity }
    this.shieldMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHits: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uActive: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPos;
        varying vec2 vUv;
        void main() {
          vPos = position;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec4 uHits[4]; // (x, y, age 0..1, intensity)
        uniform float uActive;
        varying vec3 vPos;
        varying vec2 vUv;
        void main() {
          float r = length(vPos.xy);
          // Hexagonal forcefield lattice pattern
          vec2 h = vPos.xy * 28.0;
          float hex = sin(h.x) * sin(h.y * 1.732 + h.x * 0.5) * sin(h.y * 1.732 - h.x * 0.5);
          hex = smoothstep(0.35, 0.85, abs(hex));
          
          // Idle forcefield glow
          float edge = pow(clamp(r / 0.38, 0.0, 1.0), 3.0);
          vec3 baseCol = vec3(0.0, 0.8, 1.0);
          float alpha = (0.025 + 0.12 * edge + 0.06 * hex) * uActive;
          vec3 col = baseCol * alpha;
          
          // Expanding shockwave ripples on impact
          for (int i = 0; i < 4; i++) {
            if (uHits[i].w > 0.01) {
              float d = length(vPos.xy - uHits[i].xy);
              float waveR = uHits[i].z * 0.42;
              float wave = smoothstep(0.06, 0.0, abs(d - waveR)) * (1.0 - uHits[i].z);
              float core = exp(-d * 24.0) * (1.0 - uHits[i].z * 1.6);
              vec3 hitCol = mix(vec3(0.1, 0.95, 1.0), vec3(1.0, 0.88, 0.45), core);
              col += hitCol * (wave * 3.5 + core * 5.5) * uHits[i].w;
              alpha = max(alpha, (wave * 0.85 + core * 0.95) * uHits[i].w);
            }
          }
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.shieldMesh = new THREE.Mesh(shieldGeo, this.shieldMat);
    this.shieldMesh.visible = false;
    this.fieldGroup.add(this.shieldMesh);

    // Point light that illuminates the ship's nose during impacts
    this.shieldLight = new THREE.PointLight(0x00f0ff, 0, 10);
    this.fieldGroup.add(this.shieldLight);
  }

  initSparks() {
    const count = 180;
    this.sparkData = Array.from({ length: count }, () => ({
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(0, 0, 0),
      life: 0,
      maxLife: 0.3,
      active: false,
    }));

    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const sparkMat = new THREE.PointsMaterial({
      size: 0.18,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sparkMesh = new THREE.Points(this.sparkGeo, sparkMat);
    this.sparkMesh.visible = false;
    this.fieldGroup.add(this.sparkMesh);
  }

  triggerShieldHit(hitX, hitY, hitZ, L) {
    // 1. Forcefield ripple
    this.hits.push({ x: hitX / L, y: hitY / L, age: 0, intensity: 1.0 });
    if (this.hits.length > 4) this.hits.shift();

    // 2. Light flash
    this.shieldLight.intensity = 4.0;

    // 3. Spray of 22 incandescent sparks
    let spawned = 0;
    for (const sp of this.sparkData) {
      if (!sp.active) {
        sp.active = true;
        sp.pos.set(hitX, hitY, hitZ);
        const ang = Math.random() * Math.PI * 2;
        const radSpd = 12 + Math.random() * 24;
        sp.vel.set(
          Math.cos(ang) * radSpd + (hitX / L) * 15,
          Math.sin(ang) * radSpd + (hitY / L) * 15,
          -(35 + Math.random() * 70) * (L / 10), // stream backward along -Z
        );
        sp.life = 0;
        sp.maxLife = 0.22 + Math.random() * 0.18;
        if (++spawned >= 16) break;
      }
    }
    this.sparkMesh.visible = true;

    // 4. Sound
    this.onHit?.(1.0);
  }

  triggerRockFlyby(dist, wall) {
    if (this.lastRockWhoosh && wall - this.lastRockWhoosh < 0.4) return;
    this.lastRockWhoosh = wall;
    const gain = Math.max(0.4, Math.min(0.85, 1.0 - (dist / 4.0) * 0.45));
    this.onRockPass?.(gain);
  }

  updateSparks(dt, L) {
    const posAttr = this.sparkGeo.attributes.position;
    const colAttr = this.sparkGeo.attributes.color;
    let anyActive = false;

    for (let i = 0; i < this.sparkData.length; i++) {
      const sp = this.sparkData[i];
      if (sp.active) {
        sp.life += dt;
        if (sp.life >= sp.maxLife) {
          sp.active = false;
          posAttr.setXYZ(i, 0, 0, -9999);
          continue;
        }
        anyActive = true;
        sp.pos.addScaledVector(sp.vel, dt);
        posAttr.setXYZ(i, sp.pos.x, sp.pos.y, sp.pos.z);
        const u = sp.life / sp.maxLife;
        // Fade from white-hot to brilliant cyan-gold
        const r = 1.0 - u * 0.4;
        const g = 0.9 - u * 0.3;
        const b = 0.5 + u * 0.5;
        const fade = (1.0 - u);
        colAttr.setXYZ(i, r * fade, g * fade, b * fade);
      } else {
        posAttr.setXYZ(i, 0, 0, -9999);
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.sparkMesh.visible = anyActive;
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
      // Asteroid belt (near Jupiter, 2.7 AU)
      const tb = tracker.cross((t) => v3.len(pos(t)), 2.7 * AU);
      if (tb && !['mars', 'mercury', 'venus'].includes(dest)) {
        ev.push({ t: tb - m.t0, kind: 'field', field: this.belt, name: 'Asteroid belt', r: 2.7 * AU });
      }
      // Kuiper belt (beyond Neptune, 38 AU)
      const tk = tracker.cross((t) => v3.len(pos(t)), 38 * AU);
      if (tk && !['mars', 'mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'].includes(dest)) {
        ev.push({ t: tk - m.t0, kind: 'field', field: this.kuiper, name: 'Kuiper belt', r: 38 * AU });
      }
      // Oort cloud (deep interstellar threshold, 2000 AU)
      const to = tracker.cross((t) => v3.len(pos(t)), 2000 * AU);
      if (to) {
        ev.push({ t: to - m.t0, kind: 'field', field: this.oort, name: 'Oort cloud', r: 2000 * AU });
      }
    }
    this.events = ev.sort((a, b) => a.t - b.t);
    this.next = 0; this.queue = [];
  }

  /** Slow-motion windows for the time flow: [{t0, t1, w0, w1, tc (closest approach), rate, name, speed, body, v, R, rateAt}], s after launch. */
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
    this.lastRockWhoosh = 0;
    for (const a of this.active) this.hide(a);
    this.active = [];
    for (const e of this.events) if (e.kind === 'planet' && e.basis) this.hidePlanet(e);
    this.focus = null;
  }

  hide(a) {
    a.field.visible = false;
    this.shieldMesh.visible = false;
    this.shieldLight.intensity = 0;
    this.sparkMesh.visible = false;
    this.hits = [];
  }

  hidePlanet(e) { this.planet(e.id).root.visible = false; this.systems[e.id]?.hide(); e.basis = null; e.heard = false; }

  update(rel, clock, ctx) {
    const wall = clock;
    const dt = Math.min(0.1, Math.max(0.001, wall - (this.lastWall || wall)));
    this.lastWall = wall;

    // planets: positioned by sim time
    this.focus = null;
    for (const e of this.events) {
      if (e.kind !== 'planet') continue;
      if (rel >= e.w0 && rel <= e.w1) {
        if (!e.basis) e.basis = this.basis(ctx, true);
        this.drawPlanet(e, rel, clock, ctx);
      } else if (e.basis) this.hidePlanet(e);
    }

    // rock fields: a few seconds of screen time each
    while (this.next < this.events.length && this.events[this.next].t <= rel) {
      const e = this.events[this.next++];
      if (e.kind === 'field' && v3.len(ctx.st.pos) < 1.3 * e.r) this.queue.push(e);
    }
    if (this.queue.length > 1) this.queue.splice(0, this.queue.length - 1);
    if (this.queue.length && !this.active.length) {
      const e = this.queue.shift();
      const dur = ctx.st.beta > 1 ? 1.5 : FIELD_S;
      this.active.push({ ...e, ...this.basis(ctx), start: wall, dur });
      this.onField?.(dur);
    }
    for (const a of [...this.active]) {
      const u = (wall - a.start) / a.dur;
      if (u >= 1 || u < 0) { this.hide(a); this.active.splice(this.active.indexOf(a), 1); continue; }
      this.drawField(a, u, wall, dt, ctx);
    }
  }

  basis(ctx, dayside = false) {
    const f = ctx.travelDir;
    let side = v3.sub(ctx.camF, v3.scale(f, v3.dot(ctx.camF, f)));
    side = v3.len(side) > 0.15 ? v3.norm(side) : ctx.camR;
    if (dayside) {
      const toSun = v3.norm(v3.scale(ctx.st.pos, -1)), away = v3.scale(v3.sub(toSun, v3.scale(f, v3.dot(toSun, f))), -1);
      if (v3.len(away) > 0.05) side = v3.norm(v3.add(v3.scale(v3.norm(away), 0.85), v3.scale(side, 0.15)));
      side = v3.norm(v3.sub(side, v3.scale(f, v3.dot(side, f))));
    }
    return { f, side, up: v3.norm(v3.cross(f, side)) };
  }

  drawPlanet(e, rel, clock, ctx) {
    const p = this.planet(e.id), R = e.R, { f, side, up } = e.basis;
    const along = e.v * (e.t - rel);
    const s = along / R;
    const absS = Math.abs(s);
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

    if (!e.heard && s <= 0.6 && s >= -2.0) { e.heard = true; this.onPass?.(e); }

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

  drawField(a, u, wall, dt, ctx) {
    const mesh = a.field, L = ctx.shipLen;
    mesh.visible = true;
    const g = this.fieldGroup;
    g.position.copy(ctx.probePos);
    const x = new THREE.Vector3(...a.side), y = new THREE.Vector3(...a.up), z = new THREE.Vector3(...a.f);
    g.quaternion.setFromRotationMatrix(this.m4.makeBasis(x, y, z));

    // Shield placement and forcefield activation
    this.shieldMesh.visible = true;
    this.shieldMesh.position.set(0, 0, 0.52 * L);
    this.shieldMesh.scale.set(L, L, L);

    this.shieldLight.position.set(0, 0, 0.54 * L);
    this.shieldLight.distance = 4.0 * L;
    this.shieldLight.intensity *= Math.max(0, 1 - dt * 14.0);

    const shieldActive = Math.min(1, u / 0.06, (1 - u) / 0.06);
    this.shieldMat.uniforms.uActive.value = shieldActive;
    this.shieldMat.uniforms.uTime.value = wall;

    // Update active shield ripple waves
    for (let i = this.hits.length - 1; i >= 0; i--) {
      this.hits[i].age += dt * 3.2; // ripple spreads and finishes in ~0.3s
      if (this.hits[i].age >= 1.0) this.hits.splice(i, 1);
    }
    const hitUniforms = this.shieldMat.uniforms.uHits.value;
    for (let i = 0; i < 4; i++) {
      if (i < this.hits.length) {
        hitUniforms[i].set(this.hits[i].x, this.hits[i].y, this.hits[i].age, this.hits[i].intensity);
      } else {
        hitUniforms[i].set(0, 0, 0, 0);
      }
    }

    // Update kinetic impact sparks
    this.updateSparks(dt, L);

    // High streaming velocity: rocks zip past at 260 to 450 units/sec
    const baseSpeed = (260) * (ctx.st.beta > 1 ? 2.5 : 1.0);
    const elapsed = (wall - a.start);
    const fade = Math.min(1, u / 0.05, (1 - u) / 0.08);

    mesh.userData.rocks.forEach((r, i) => {
      const rockSpeed = baseSpeed + r.speedExtra;
      const travel = elapsed * rockSpeed;
      const cycle = Math.floor((r.baseZ + travel) / STREAM_SPAN);
      let zz = STREAM_SPAN - ((r.baseZ + travel) % STREAM_SPAN) - 70; // streams +Z (ahead) -> -Z (behind)

      let scale = r.size * L;
      const isNearNose = zz <= 0.54 && zz >= 0.42;

      if (r.hitShield) {
        // Did it just strike the forward deflector shield?
        if (isNearNose && r.lastCycle !== cycle) {
          r.lastCycle = cycle;
          this.triggerShieldHit(r.x * L, r.y * L, 0.52 * L, L);
        }
        // Vaporized behind the shield plate
        if (zz < 0.52 && zz > -25) scale = 0;
      } else if (Math.hypot(r.x, r.y) < 3.5) {
        // A near-miss rock streaking right past the ship hull / camera
        if (zz <= 1.0 && zz >= -10.0 && r.lastCycle !== cycle) {
          r.lastCycle = cycle;
          this.triggerRockFlyby(Math.hypot(r.x, r.y), wall);
        }
      }

      // Stretch near-miss rocks along Z for intense hyperspeed zapping streaks
      const nearShip = Math.hypot(r.x, r.y) < 3.8 && Math.abs(zz) < 28;
      let stretchZ = 1.0;
      if (nearShip) {
        const proximity = 1.0 - Math.min(1.0, Math.abs(zz) / 28.0);
        stretchZ = 1.0 + proximity * 3.2;
      }

      const k = zz > 300 ? Math.max(0, (340 - zz) / 40) : zz < -50 ? Math.max(0, (zz + 70) / 20) : 1;
      const finalScale = Math.max(1e-6, scale * k * fade);

      this.q.setFromAxisAngle(r.axis, r.rot + r.spin * elapsed);
      this.v.set(r.x * L, r.y * L, zz * L);
      this.s.set(finalScale, finalScale, finalScale * stretchZ);
      mesh.setMatrixAt(i, this.m4.compose(this.v, this.q, this.s));
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (u < 0.85) ctx.label(`${a.name}<small>illustrative pass</small>`, v3.add(ctx.st.pos, v3.scale(a.f, 40 * L)));
  }
}
