import { Star } from './bodies.js';
import { v3 } from './constants.js';

// Close passes of real stars. The HYG catalogue's stars sit at their true 3-D positions, so on long
// trips some come within a parsec or so of the route (the Gaia BH1 route passes 15 within 1 pc, the
// closest outshining Venus). While one is near, it is drawn as a star body (core, glare, diffraction
// spikes, sized by its brightness from where the ship is), so it swells, sweeps past with its real
// parallax and fades; the moment of closest approach is announced. Nothing here is illustrative.

const PC = 3.0856775814913673e16;
const NEAR_PC = 1.0;   // candidates pass within this distance of the route…
const BRIGHT = 0;      // …and outshine this apparent magnitude at closest approach
const SHOW_PC = 4;     // drawn as a body while within this distance

const kind = (T) => (T > 7500 ? 'a hot white star' : T > 6000 ? 'a yellow-white star' : T > 5200 ? 'a Sun-like star'
  : T > 3900 ? 'an orange dwarf' : 'a red dwarf');

export class StarPasses {
  /** buffer: data/stars.bin (x, y, z pc, absolute magnitude, temperature); named: [{name, x, y, z}] */
  constructor(buffer, named, scene) {
    this.f = new Float32Array(buffer);
    this.named = named;
    this.scene = scene;
    this.pool = [];
    this.list = [];
  }

  /** Stars that pass close to a straight-line mission, with the time of closest approach. */
  setMission(m) {
    for (const s of this.pool) s.root.visible = false;
    this.list = [];
    if (m.mode !== 'straight') return;
    const f = this.f, n = f.length / 5, S = v3.scale(m.S, 1 / PC), dir = m.dir, L = m.L / PC;
    for (let i = 0; i < n; i++) {
      const p = [f[i * 5] - S[0], f[i * 5 + 1] - S[1], f[i * 5 + 2] - S[2]];
      const s = v3.dot(p, dir);
      if (s < 0.05 || s > L - 0.05) continue;
      const b = v3.len(v3.sub(p, v3.scale(dir, s)));
      const M = f[i * 5 + 3];
      if (b > NEAR_PC || M > 50 || M + 5 * Math.log10(b / 10) > BRIGHT) continue;
      const pos = [f[i * 5], f[i * 5 + 1], f[i * 5 + 2]];
      const nm = this.named.find((x) => Math.hypot(x.x - pos[0], x.y - pos[1], x.z - pos[2]) < 0.01);
      this.list.push({ pos: v3.scale(pos, PC), M, T: f[i * 5 + 4], b, s, name: nm ? nm.name : kind(f[i * 5 + 4]), tc: this.timeAt(m, s * PC) });
    }
    this.list.sort((a, b) => a.tc - b.tc);
  }

  timeAt(m, x) {
    let lo = 0, hi = m.tArrive;
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (m.prof.at(mid).x < x) lo = mid; else hi = mid; }
    return hi;
  }

  body(i) {
    while (this.pool.length <= i) {
      const s = new Star({ temp: 5772, radius: 7e8, absMag: 5 });
      s.root.visible = false;
      this.scene.add(s.root);
      this.pool.push(s);
    }
    return this.pool[i];
  }

  /**
   * rel: s after launch; ctx: { place(obj, world, scale) → distance, pxPerRad, dpr, simT, label(text, world),
   * onPass(star) } — onPass is called once per star, at its closest approach.
   */
  update(rel, camW, ctx) {
    let k = 0;
    for (const p of this.list) {
      const d = v3.len(v3.sub(p.pos, camW)) / PC;
      if (d < SHOW_PC && k < 3) {
        const s = this.body(k++);
        if (s.src !== p) {
          // a main-sequence-style radius from its luminosity and temperature (only for the disk, if ever resolved)
          const Lsun = Math.pow(10, -0.4 * (p.M - 4.83));
          s.radius = 6.957e8 * Math.sqrt(Lsun) * (5772 / p.T) ** 2;
          s.absMag = p.M; s.temp = p.T; s.glareU.uTemp.value = p.T; s.uniforms.uTemp.value = p.T;
          s.src = p;
        }
        s.root.visible = true;
        const dist = ctx.place(s.root, p.pos, s.radius);
        s.update(ctx.simT, dist, ctx.pxPerRad, ctx.dpr);
        if (d < 1.5) ctx.label(`${p.name[0].toUpperCase() + p.name.slice(1)}<small>${(d * 3.2616).toFixed(d < 0.3 ? 2 : 1)} ly</small>`, p.pos);
      }
      // announced once, at closest approach (not when the timeline jumps past it)
      if (!p.heard && rel >= p.tc) { p.heard = true; if (d < 2 * p.b + 0.05) ctx.onPass?.(p); }
    }
    for (let i = k; i < this.pool.length; i++) { this.pool[i].root.visible = false; this.pool[i].src = null; }
  }
}
