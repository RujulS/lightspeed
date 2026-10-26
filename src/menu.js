import * as THREE from 'three';
import { C, v3, dateToSim } from './constants.js';
import { planetPos, radecToVec } from './astro.js';
import { PROBES, Mission } from './missions.js';
import { DESTINATIONS, RADIUS } from './destinations.js';
import { Planet, bbColorJS } from './bodies.js';
import { ProbeModel } from './probes3d.js';
import { createAndromedaDisk, setDiskBasis } from './andromeda.js';
import { $, fmtDist, fmtTime } from './ui.js';

// Main menu: a dedicated 3-D stage with the chosen destination slowly turning in the background and
// the chosen spacecraft in the foreground, framed by two minimal pick-lists.

// Andromeda's halo as the arrival view shows it (a long exposure): red giants and a few blue stars,
// thinning out away from the galaxy, plus fuzzy globular clusters. A flat sprinkle facing the menu
// camera, in preview units (the photo card is ~6 units across here).
function haloSprinkle(seed) {
  let s = seed;
  const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  const pos = [], col = [], size = [];
  const add = (r, a, T, px) => {
    pos.push(r * Math.cos(a) * 1.25, r * Math.sin(a) * 0.85, 0);
    col.push(...bbColorJS(T).map((x) => x / 1.5)); size.push(px);
  };
  for (let i = 0; i < 4200; i++) { // surface density ∝ 1/(1 + (r/1.6)²), out to 16 units
    const r = 1.6 * Math.sqrt(Math.pow(1 + 100, rnd()) - 1);
    const blue = rnd() < 0.12;
    add(r, rnd() * 6.2832, blue ? 8000 + 3000 * rnd() : 3700 + 1200 * rnd(), 1 + 2.4 * Math.pow(rnd(), 6));
  }
  for (let i = 0; i < 70; i++) add(0.8 + 6 * Math.pow(rnd(), 1.6), rnd() * 6.2832, 5200 + 700 * rnd(), 3.6 + 0.8 * rnd());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 0 }, uDpr: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: `attribute float aSize; varying vec3 vC; varying float vS; uniform float uFade, uDpr;
      void main() { vC = color * uFade; vS = aSize; gl_PointSize = (aSize > 3.5 ? aSize * 1.5 : aSize + 2.0) * uDpr;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vC; varying float vS;
      void main() { vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard;
        float a = vS > 3.5 ? exp(-r2 * 4.0) * 0.3 : exp(-r2 * 7.0) * min(1.0, 0.35 + vS * 0.25);
        gl_FragColor = vec4(vC * a, 1.0); }`,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

function glowSprite(color, size) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, `rgba(${color},1)`); grd.addColorStop(0.18, `rgba(${color},0.55)`); grd.addColorStop(0.5, `rgba(${color},0.12)`); grd.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

export class Menu {
  constructor({ panorama, stars, envMap, onContinue, canvas }) {
    this.onContinue = onContinue;
    this.scene = new THREE.Scene();
    this.scene.environment = envMap;
    this.scene.environmentIntensity = 0.5;
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.01, 1e5);
    // look toward the bright centre of the Milky Way for a beautiful backdrop
    const gc = radecToVec(266.4, -28.9);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(new THREE.Vector3(...gc).add(new THREE.Vector3(0.25, 0.1, 0.35)));
    this.camera.updateMatrixWorld();
    const e = this.camera.matrixWorld.elements;
    this.R = new THREE.Vector3(e[0], e[1], e[2]); this.U = new THREE.Vector3(e[4], e[5], e[6]); this.F = new THREE.Vector3(-e[8], -e[9], -e[10]);
    this.scene.add(new THREE.Mesh(panorama.geometry, panorama.material), new THREE.Points(stars.geometry, stars.material));
    this.skyMats = [panorama.material, stars.material]; // dimmed for Andromeda: out there the Milky Way is behind you
    this.skyGain = 1;
    for (const o of this.scene.children) { o.frustumCulled = false; o.renderOrder = -100; }

    this.key = new THREE.DirectionalLight(0xfff4e6, 3.4);
    this.scene.add(this.key, this.key.target, new THREE.AmbientLight(0x8090b0, 0.25));
    this.lightDir = this.R.clone().multiplyScalar(-0.75).add(this.U.clone().multiplyScalar(0.35)).add(this.F.clone().multiplyScalar(-0.55)).normalize();
    this.key.position.copy(this.lightDir).multiplyScalar(50);

    this.destRoot = new THREE.Group(); this.probeRoot = new THREE.Group();
    this.scene.add(this.destRoot);
    // the spacecraft gets its own scene, drawn after the lens pass: it is in front of the black hole,
    // so its image must not be bent
    this.probeScene = new THREE.Scene();
    this.probeScene.environment = envMap;
    this.probeScene.environmentIntensity = 0.5;
    const pk = this.key.clone();
    this.probeScene.add(pk, pk.target, new THREE.AmbientLight(0x8090b0, 0.25), this.probeRoot);
    this.focus = 'dest';
    this.probeTurn = { yaw: 0, pitch: 0, idle: 10 };
    this.models = {}; this.previews = {};
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this.dest = 'saturn'; this.probe = 'antimatter';
    $('i-date').value = new Date().toISOString().slice(0, 10);
    $('i-date').addEventListener('change', () => this.refresh());
    $('b-launch').addEventListener('click', () => this.onContinue(this.dest, this.probe, this.launchT()));
    this.buildLists();
    this.select();
    this.initDrag(canvas);
  }

  // point in front of the camera at normalised screen offset (x, y) and distance d
  at(x, y, d) {
    const th = Math.tan((this.camera.fov * Math.PI) / 360);
    return this.F.clone().multiplyScalar(d).add(this.U.clone().multiplyScalar(y * 2 * th * d)).add(this.R.clone().multiplyScalar(x * 2 * th * d * this.camera.aspect));
  }
  launchT() { return dateToSim(new Date($('i-date').value + 'T12:00:00Z')); }

  buildLists() {
    const t = this.launchT();
    let g = '', html = '';
    for (const d of DESTINATIONS) {
      if (d.group !== g) { g = d.group; html += `<div class="m-group">${g}</div>`; }
      const dist = v3.len(v3.sub(d.pos(t), planetPos('earth', t)));
      html += `<button class="m-item" data-d="${d.id}"><span class="nm">${d.short || d.name}</span><span class="dd">${fmtDist(dist)}</span></button>`;
    }
    $('m-dests').innerHTML = html;
    $('m-probes').innerHTML = PROBES.map((p) => {
      const top = p.kind === 'cruise' ? p.v / 1e3 + ' km/s' : p.kind === 'ballistic' ? p.cruise / 1e3 + ' km/s'
        : p.stages.at(-1).beta >= 1 ? '→ c' : (p.stages.at(-1).beta * 100).toFixed(1) + '% c';
      return `<button class="m-item" data-p="${p.id}"><div class="row"><span class="nm">${p.name}</span><span class="dd">${top}</span></div>`
        + `<div class="row"><span class="tg">${p.tag}</span><span class="tt"></span></div></button>`;
    }).join('');
    this.rankKey = null;
    $('m-dests').onclick = (e) => { const b = e.target.closest('[data-d]'); if (b) { this.dest = b.dataset.d; this.select('dest'); } };
    $('m-probes').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) { this.probe = b.dataset.p; this.select('probe'); } };
  }

  // kind: 'dest' | 'probe' — only that preview reloads, and it glides forward
  select(kind) {
    document.querySelectorAll('#m-dests .m-item').forEach((b) => b.classList.toggle('on', b.dataset.d === this.dest));
    document.querySelectorAll('#m-probes .m-item').forEach((b) => b.classList.toggle('on', b.dataset.p === this.probe));
    if (kind !== 'probe') this.showDest();
    if (kind !== 'dest') this.showProbe();
    if (kind) this.focus = kind;
    $('m-dest-card').classList.toggle('dim', this.focus === 'probe');
    $('m-probe-card').classList.toggle('dim', this.focus === 'dest');
    this.refresh(kind);
  }

  // The spacecraft are listed by how soon each reaches the chosen destination. On short hops
  // acceleration matters more than top speed (Daedalus builds up speed at only 0.03 g), so the order
  // changes from one destination to the next; the list slides into its new order.
  rankProbes(d, t) {
    const key = d.id + ':' + t;
    if (this.rankKey === key) return;
    this.rankKey = key;
    const trip = {};
    for (const p of PROBES) { const m = new Mission(p, d, t, null); trip[p.id] = m.t0 - t + m.tArrive; }
    const list = $('m-probes'), items = [...list.children];
    const before = new Map(items.map((b) => [b, b.getBoundingClientRect().top]));
    items.sort((a, b) => trip[a.dataset.p] - trip[b.dataset.p]);
    for (const b of items) { b.querySelector('.tt').textContent = fmtTime(trip[b.dataset.p]); list.appendChild(b); }
    for (const b of items) {
      const dy = before.get(b) - b.getBoundingClientRect().top;
      if (dy) b.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 350, easing: 'cubic-bezier(.2, .7, .2, 1)' });
    }
  }

  refresh(kind) {
    const d = DESTINATIONS.find((x) => x.id === this.dest), p = PROBES.find((x) => x.id === this.probe);
    const t = this.launchT();
    const m = new Mission(p, d, t, null);
    const dist = v3.len(v3.sub(d.pos(t), planetPos('earth', t)));
    this.rankProbes(d, t);
    $('m-dest-group').textContent = d.group;
    $('m-dest-name').textContent = d.name;
    $('m-dest-sub').textContent = `${fmtDist(dist)} from Earth`;
    $('m-dest-desc').textContent = d.facts;
    $('m-probe-tag').textContent = p.tag;
    $('m-probe-name').textContent = p.name;
    const top = p.kind === 'cruise' ? `${p.v / 1e3} km/s` : p.kind === 'ballistic' ? `${p.cruise / 1e3} km/s cruise`
      : p.stages.at(-1).beta >= 1 ? 'Accelerates toward light speed' : `Up to ${(p.stages.at(-1).beta * 100).toFixed(1)}% of light speed`;
    $('m-probe-sub').textContent = top;
    $('m-blurb').textContent = p.blurb;
    $('m-trip').textContent = fmtTime(m.t0 - t + m.tArrive);
    const ab = m.shipTimeAtArrival();
    $('m-aboard-box').classList.toggle('hidden', ab > m.tArrive * 0.99);
    $('m-aboard').textContent = fmtTime(ab);
    $('m-light').textContent = fmtTime(dist / C);
    const mb = m.maxBeta();
    $('m-top').textContent = mb < 0.01 ? `${(mb * C / 1e3).toFixed(1)} km/s` : `${(mb * 100).toFixed(mb > 0.999 ? 3 : 1)}% c`;
    const ids = ['m-trip', ...(kind === 'probe' ? ['m-probe-name', 'm-blurb'] : kind === 'dest' ? ['m-dest-name', 'm-dest-desc'] : [])];
    for (const id of ids) { const el = $(id); el.classList.remove('m-fade'); void el.offsetWidth; el.classList.add('m-fade'); }
  }

  showDest() {
    for (const o of Object.values(this.previews)) o.visible = false;
    const id = this.dest;
    if (!this.previews[id]) this.previews[id] = this.makeDest(id);
    const o = this.previews[id];
    o.visible = true;
    o.userData.appear = 0;
  }

  makeDest(id) {
    const g = new THREE.Group();
    this.destRoot.add(g);
    const d = DESTINATIONS.find((x) => x.id === id);
    if (d.kind === 'planet') {
      const p = new Planet(d.body, RADIUS[d.body]);
      p.root.scale.setScalar(id === 'saturn' ? 1.1 : 1.75);
      g.add(p.root); g.userData.planet = p; g.userData.turnable = true;
    } else if (id === 'proxima') {
      const p = new Planet('proximab', 1);
      p.root.scale.setScalar(1.7);
      g.add(p.root); g.userData.planet = p; g.userData.star = 'proxima'; g.userData.turnable = true;
      const glow = glowSprite('255,120,60', 14);
      glow.position.copy(this.lightDir).multiplyScalar(9);
      this.destRoot.add(glow); g.userData.glow = glow;
    } else if (id === 'gaiabh1') {
      g.userData.bh = true; // drawn by the lens pass's ray tracer (see blackHoleView)
    } else if (d.kind === 'galaxy') {
      const disk = createAndromedaDisk([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0]);
      g.add(disk); g.userData.galaxy = disk;
      const halo = haloSprinkle(31);
      halo.quaternion.copy(this.camera.quaternion);
      halo.rotateZ(0.32); // along the card's tilt
      g.add(halo); g.userData.halo = halo;
    }
    g.userData.turn = { yaw: 0, pitch: 0 };
    return g;
  }

  /** Build every preview up front (hidden) so the GPU can be warmed before the menu opens. */
  async preloadAll() {
    for (const d of DESTINATIONS) if (!this.previews[d.id]) { this.previews[d.id] = this.makeDest(d.id); this.previews[d.id].visible = false; }
    for (const p of PROBES) if (!this.models[p.id]) this.models[p.id] = new ProbeModel(p.id);
    await Promise.all(Object.values(this.models).map((m) => m.ready));
    return Object.values(this.models);
  }

  async showProbe() {
    const id = this.probe;
    if (!this.models[id]) { this.models[id] = new ProbeModel(id); }
    const m = this.models[id];
    await m.ready;
    if (this.probe !== id) return;
    this.probeRoot.clear();
    const holder = new THREE.Group();
    holder.add(m.group);
    holder.scale.setScalar((id === 'starshot' ? 0.95 : 1.3) / m.length);
    this.probeRoot.add(holder);
    this.probeRoot.userData.appear = 0;
    m.update(0, 0, 1);
  }

  // ---- drag to turn whichever preview is nearest the pointer
  initDrag(canvas) {
    const v = new THREE.Vector3();
    const screen = (obj) => { obj.getWorldPosition(v).project(this.camera); return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]; };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.visible) return;
      const [dx, dy] = screen(this.destRoot), [px, py] = screen(this.probeRoot);
      const toDest = Math.hypot(e.clientX - dx, e.clientY - dy), toProbe = Math.hypot(e.clientX - px, e.clientY - py);
      this.drag = { target: toProbe < toDest ? 'probe' : 'dest', x: e.clientX, y: e.clientY };
    });
    addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const ddx = (e.clientX - this.drag.x) * 0.008, ddy = (e.clientY - this.drag.y) * 0.008;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      if (this.drag.target === 'probe') { this.probeTurn.yaw += ddx; this.probeTurn.pitch = clamp(this.probeTurn.pitch + ddy, -1.3, 1.3); this.probeTurn.idle = 0; }
      else {
        const o = this.previews[this.dest];
        if (o?.userData.turnable) { o.userData.turn.yaw += ddx; o.userData.turn.pitch = clamp(o.userData.turn.pitch + ddy, -1.2, 1.2); }
      }
    });
    addEventListener('pointerup', () => { this.drag = null; });
  }

  // where each preview sits: the one being chosen comes forward, the other steps back
  layout() {
    return this.focus === 'probe'
      ? { d: [-0.15, 0.2, 17], p: [0.1, -0.03, 4.4] }
      : { d: [-0.06, 0.16, 11], p: [0.2, -0.05, 10] };
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  update(dt, wall) {
    // glide toward the focused layout
    const L = this.layout(), k = 1 - Math.exp(-dt * 3.2);
    this.cur = this.cur || { d: [...L.d], p: [...L.p] };
    for (const key of ['d', 'p']) for (let i = 0; i < 3; i++) this.cur[key][i] += (L[key][i] - this.cur[key][i]) * k;
    this.destRoot.position.copy(this.at(...this.cur.d));
    this.probeRoot.position.copy(this.at(...this.cur.p));

    const o = this.previews[this.dest];
    // a planet stays hidden until its maps have arrived (they stream in after the menu opens)
    if (o) o.visible = !o.userData.planet || o.userData.planet.ready;
    if (o?.visible) {
      o.userData.appear = Math.min(1, (o.userData.appear || 0) + dt * 1.6);
      const s = 0.85 + 0.15 * easeOut(o.userData.appear);
      o.scale.setScalar(s);
      if (o.userData.turnable) {
        // manual turn, expressed in screen space (yaw about screen-up, pitch about screen-right)
        const t = o.userData.turn;
        this._e.set(t.pitch, t.yaw, 0);
        o.quaternion.copy(this.camera.quaternion).multiply(this._q.setFromEuler(this._e)).multiply(this.camera.quaternion.clone().invert());
      }
      const p = o.userData.planet;
      if (p) {
        p.update(0, this.lightDir, new THREE.Color().setRGB(...(o.userData.star ? bbColorJS(3042).map((x) => x / 2.2) : bbColorJS(5772).map((x) => x / 1.08))));
        p.mesh.rotation.y = wall * 0.12;
        if (p.clouds) p.clouds.rotation.y = wall * 0.13;
        if (p.ring) { p.ring.material.uniforms.uPlanetC.value.copy(this.destRoot.position); p.ring.material.uniforms.uPlanetR.value = p.root.scale.x * s; }
      }
      if (o.userData.galaxy) {
        // the photo card holds still, facing us, ~95 kpc away (scaled with the preview distance)
        const disk = o.userData.galaxy;
        const dir = this.destRoot.position.clone().normalize();
        const Z = dir.clone().negate().applyAxisAngle(this.R, 0.22).normalize();
        const X = this.R.clone().applyAxisAngle(Z, -0.32).projectOnPlane(Z).normalize();
        setDiskBasis(disk, [X.toArray(), Z.clone().cross(X).toArray(), Z.toArray()]);
        const dist = (95000 / s) * (this.cur.d[2] / 11);
        for (const c of disk.children) {
          c.material.uniforms.uCenter.value.copy(dir).multiplyScalar(dist);
          c.material.uniforms.uFade.value = easeOut(o.userData.appear);
        }
      }
    }
    for (const [id, g] of Object.entries(this.previews)) if (g.userData.glow) g.userData.glow.visible = id === this.dest;
    if (o?.userData.halo) o.userData.halo.material.uniforms.uFade.value = easeOut(o.userData.appear);
    // Andromeda is previewed as seen on arrival: intergalactic dark instead of the Milky Way backdrop
    this.skyGain += ((this.previews[this.dest]?.userData.halo ? 0.08 : 1) - this.skyGain) * (1 - Math.exp(-dt * 2.5));
    for (const m of this.skyMats) m.uniforms.uGain.value = this.skyGain;

    // probe: slow turntable unless it was just dragged
    const pt = this.probeTurn;
    pt.idle += dt;
    if (!(this.drag && this.drag.target === 'probe') && pt.idle > 2.5) pt.yaw += dt * 0.3;
    this.probeRoot.userData.appear = Math.min(1, (this.probeRoot.userData.appear || 0) + dt * 1.8);
    this.probeRoot.quaternion.copy(this.camera.quaternion).multiply(this._q.setFromEuler(this._e.set(0.32 + pt.pitch, pt.yaw, 0.1)));
    this.probeRoot.scale.setScalar(0.8 + 0.2 * easeOut(this.probeRoot.userData.appear));
  }

  /**
   * For the Gaia BH1 preview: where the hole sits as seen from the menu camera, how far away (in
   * Schwarzschild radii) and its spin axis (a near edge-on, slightly-from-above view of the disk).
   */
  blackHoleView() {
    if (!this.visible || this.dest !== 'gaiabh1') return null;
    const o = this.previews.gaiabh1;
    if (!o?.visible) return null;
    const dir = this.destRoot.position.clone().sub(this.camera.position).normalize();
    // farther away while the probe is in focus, as the planets step back
    const dist = 48 * (this.cur ? this.cur.d[2] / 11 : 1) / (0.85 + 0.15 * easeOut(o.userData.appear || 0));
    const n = this.U.clone().projectOnPlane(dir).normalize().addScaledVector(dir, -0.13).applyAxisAngle(dir, -0.12).normalize();
    return { dir: dir.toArray(), dist, normal: n.toArray() };
  }

  show(v) { $('menu').classList.toggle('hidden', !v); this.visible = v; if (v) { this.buildLists(); this.select(); } }
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
