import * as THREE from 'three';
import { DAY, v3 } from './constants.js';
import { Planet } from './bodies.js';
import { ROTATION, radecToVec, moonGeo } from './astro.js';
import { lineMaterial, addDotIndex } from './lines.js';

// Major moons: [id, name, semi-major axis km, sidereal period days (negative = retrograde), radius km, look].
// Real sizes, distances and periods, on circular orbits in the parent's equatorial plane (true to within
// a few degrees for all of these except Iapetus, tilted 15°). Where each moon is along its orbit is
// illustrative, not an ephemeris. Surfaces reuse the Moon's cratered map, tinted.
const grey = (k) => ({ tint: [k, k, k] });
export const MOONS = {
  mars: [
    ['phobos', 'Phobos', 9376, 0.31891, 11.1, grey(0.55)],
    ['deimos', 'Deimos', 23463, 1.26244, 6.2, grey(0.6)],
  ],
  jupiter: [
    ['io', 'Io', 421700, 1.769138, 1821.6, { tint: [1.35, 1.12, 0.5] }],
    ['europa', 'Europa', 671034, 3.551181, 1560.8, { tint: [1.35, 1.25, 1.1] }],
    ['ganymede', 'Ganymede', 1070412, 7.154553, 2634.1, { tint: [0.95, 0.88, 0.8] }],
    ['callisto', 'Callisto', 1882709, 16.689018, 2410.3, { tint: [0.62, 0.56, 0.5] }],
  ],
  saturn: [
    ['mimas', 'Mimas', 185539, 0.942422, 198.2, grey(1.2)],
    ['enceladus', 'Enceladus', 237948, 1.370218, 252.1, { tint: [1.65, 1.68, 1.75] }],
    ['tethys', 'Tethys', 294619, 1.887802, 531.1, grey(1.4)],
    ['dione', 'Dione', 377396, 2.736915, 561.4, grey(1.3)],
    ['rhea', 'Rhea', 527108, 4.518212, 763.8, grey(1.25)],
    ['titan', 'Titan', 1221870, 15.945421, 2574.7, { proc: 3, tint: [0.78, 0.55, 0.26], atmo: [0.95, 0.68, 0.35], s: 0.7 }],
    ['iapetus', 'Iapetus', 3560820, 79.3215, 734.5, { tint: [0.9, 0.8, 0.68] }],
  ],
  uranus: [
    ['miranda', 'Miranda', 129390, 1.413479, 235.8, grey(1.1)],
    ['ariel', 'Ariel', 191020, 2.520379, 578.9, grey(1.2)],
    ['umbriel', 'Umbriel', 266000, 4.144177, 584.7, grey(0.75)],
    ['titania', 'Titania', 435910, 8.705872, 788.4, grey(1.05)],
    ['oberon', 'Oberon', 583520, 13.463239, 761.4, grey(0.95)],
  ],
  neptune: [
    ['proteus', 'Proteus', 117647, 1.122315, 210, grey(0.6)],
    ['triton', 'Triton', 354759, -5.876854, 1353.4, { tint: [1.3, 1.2, 1.15] }],
  ],
  pluto: [
    ['charon', 'Charon', 19591, 6.3872, 606, { tint: [0.85, 0.8, 0.78] }],
    ['nix', 'Nix', 48694, 24.856, 25, grey(1.2)],
    ['hydra', 'Hydra', 64738, 38.202, 30, grey(1.2)],
  ],
};
const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 100003; return h / 100003; };

/** A planet's moons and their orbit lines. Earth's system is just the orbit of the (real) Moon. */
export class MoonSystem {
  constructor(parent, scene, t0) {
    this.parent = parent;
    const r = ROTATION[parent], pole = radecToVec(r[0], r[1]);
    const c = v3.cross([0, 0, 1], pole);
    this.e1 = v3.len(c) > 1e-6 ? v3.norm(c) : [1, 0, 0]; this.e2 = v3.cross(pole, this.e1);
    this.lines = new THREE.Group();
    this.lines.visible = false;
    scene.add(this.lines);
    this.moons = (MOONS[parent] || []).map(([id, name, a, P, R, look]) => {
      const body = new Planet(id, R * 1e3, { map: look.proc ? undefined : '8k_moon.jpg', atmo: [0, 0, 0], s: 0, lo: true, ...look });
      body.root.visible = false;
      scene.add(body.root);
      return { id, name, a: a * 1e3, P: P * DAY, R: R * 1e3, ph: hash(id) * 2 * Math.PI, body };
    });
    this.mat = lineMaterial(0x9fb4d0, 0.08, false, true); // very faint: context, not clutter
    const loop = (fn, n) => {
      const pts = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pts.set(fn(i / n), i * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      addDotIndex(g, n);
      const l = new THREE.LineLoop(g, this.mat);
      l.frustumCulled = false;
      this.lines.add(l);
    };
    for (const m of this.moons) loop((u) => this.circle(m.a, u * 2 * Math.PI), 180);
    if (parent === 'earth') loop((u) => moonGeo(t0 + u * 27.321661 * DAY), 360);
    this.reach = parent === 'earth' ? 3.844e8 : Math.max(...this.moons.map((m) => m.a));
  }

  circle(a, th) { return v3.scale(v3.add(v3.scale(this.e1, Math.cos(th)), v3.scale(this.e2, Math.sin(th))), a); }
  offset(m, t) { return this.circle(m.a, m.ph + (2 * Math.PI * t) / m.P); }

  hide() { this.lines.visible = false; for (const m of this.moons) m.body.root.visible = false; }

  /**
   * w: parent's world position. ctx: { t, show, lines (draw orbits), place(obj, world, scale), dist(world),
   * pxPerRad, sunColor, label(text, world) or null }
   */
  update(w, ctx) {
    const d = ctx.dist(w), far = this.reach * 80;
    if (!ctx.show || d > far) { this.hide(); return; }
    this.lines.visible = ctx.lines;
    if (ctx.lines) {
      ctx.place(this.lines, w, 1);
      // orbits only near the planet, fading out well before the system shrinks to a dot
      const near = this.reach * 25;
      this.mat.uniforms.uOpacity.value = 0.08 * Math.max(0, Math.min(1, (near - d) / (near * 0.5)));
      this.lines.visible = this.mat.uniforms.uOpacity.value > 0.003;
    }
    const sd = new THREE.Vector3();
    for (const m of this.moons) {
      const mw = v3.add(w, this.offset(m, ctx.t));
      m.body.root.visible = true;
      const dm = ctx.place(m.body.root, mw, m.R);
      const s = v3.norm(v3.scale(mw, -1));
      m.body.update(ctx.t, sd.set(s[0], s[1], s[2]), ctx.sunColor);
      if (ctx.label && d < this.reach * 30 && (m.R / dm) * ctx.pxPerRad < 25) ctx.label(m.name, mw);
    }
  }
}
