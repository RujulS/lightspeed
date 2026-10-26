import { C, AU, LY, v3 } from './constants.js';
import { planetPos } from './astro.js';
import { $, fmtTime, fmtDist } from './ui.js';

// Mission overview in the bottom bar:
//  • a route track from Earth to the destination with landmarks placed where the real flight path
//    crosses them. "True" draws distance to scale; "Even" spaces the landmarks evenly and moves the
//    probe linearly in distance between them; "Mix" stays as close to True as it can: only gaps too
//    short to read are widened (to MIN_PX), and the room comes out of the long gaps in proportion, so
//    long gaps keep their true ratios to one another. The track is coloured by flight phase (accelerate,
//    cruise, brake), and a marker shows where light launched with you would be;
//  • the stage checklist (in the left panel).

const MIN_PX = 64; // Mix: narrowest gap between landmarks, in px (room for a label)
const A = { mercury: 0.387, venus: 0.723, mars: 1.524, jupiter: 5.203, saturn: 9.537, uranus: 19.19, neptune: 30.07, pluto: 39.48 };
// heliocentric landmarks (crossing points are found on the real flight path)
const DEEP = [
  { d: 5.2 * AU, name: 'Jupiter orbit' },
  { d: 39.5 * AU, name: 'Pluto orbit' },
  { d: 167 * AU, name: 'Voyager 1 today' },
  { d: 2000 * AU, name: 'Oort cloud' },
  { d: 4.24 * LY, name: 'Proxima' },
  { d: 1560 * LY, name: 'Gaia BH1' },
  { d: 26700 * LY, name: 'Galactic centre' },
  { d: 2.5e6 * LY, name: 'Andromeda' },
];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
// flight-phase colours (also used by the stage list in the left panel)
export const PHASE = {
  accel: { rgb: '255,150,92', name: 'Accelerate' },
  cruise: { rgb: '110,190,255', name: 'Cruise' },
  coast: { rgb: '110,190,255', name: 'Coast' },
  brake: { rgb: '200,140,255', name: 'Brake' },
};

export class Tracker {
  constructor() {
    this.canvas = $('trk-map');
    this.timer = 0;
    try { this.scale = localStorage.getItem('ls-scale'); } catch { this.scale = null; }
    this.setScale(['even', 'mix'].includes(this.scale) ? this.scale : 'true');
    $('seg-scale').addEventListener('click', (e) => { const v = e.target.dataset.v; if (v) { this.setScale(v); this.timer = 1; } });
  }

  setScale(v) {
    this.scale = v;
    try { localStorage.setItem('ls-scale', v); } catch { /* storage unavailable */ }
    $('seg-scale').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  }

  // ---- distance travelled along the actual flight path (m)
  travelled(t) {
    const m = this.m, rel = Math.max(0, Math.min(t - m.t0, m.tArrive));
    if (m.mode === 'straight') return Math.min(m.prof.at(rel).x, m.L);
    const k = (rel / m.tArrive) * (this.cum.length - 1), i = Math.min(Math.floor(k), this.cum.length - 2);
    return this.cum[i] + (this.cum[i + 1] - this.cum[i]) * (k - i);
  }

  // time at which fn(t) (monotonic along the trip) first reaches value, or null
  cross(fn, value) {
    const m = this.m;
    let lo = m.t0, hi = m.t0 + m.tArrive;
    const f0 = fn(lo) - value, f1 = fn(hi) - value;
    if (f0 * f1 > 0) return null;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if ((fn(mid) - value) * f0 > 0) lo = mid; else hi = mid; }
    return hi;
  }

  setMission(m) {
    this.m = m;
    const d = m.dest;
    this.solar = d.kind === 'planet';
    this.geo = d.id === 'moon';
    if (m.mode === 'ballistic') {
      // arc length of the curved transfer orbit
      const N = 800;
      this.cum = [0];
      let prev = m.travelState(m.t0).pos;
      for (let i = 1; i <= N; i++) {
        const p = m.travelState(m.t0 + (m.tArrive * i) / N).pos;
        this.cum.push(this.cum[i - 1] + v3.len(v3.sub(p, prev)));
        prev = p;
      }
    }
    this.total = m.mode === 'straight' ? m.L : this.cum[this.cum.length - 1];
    // landmarks, placed where the real path crosses them
    const pos = (t) => m.travelState(t).pos;
    const marks = [];
    const tMoon = this.cross((t) => v3.len(v3.sub(pos(t), planetPos('earth', t))), 3.844e8);
    if (!this.geo && tMoon) marks.push({ d: this.travelled(tMoon), t: tMoon - m.t0, name: 'Moon distance' });
    const helio = this.solar
      ? Object.entries(A).filter(([p]) => p !== d.id).map(([p, a]) => ({ d: a * AU, name: `${cap(p)} orbit` }))
      : DEEP.filter((x) => x.name !== (d.short || d.name));
    for (const h of helio) {
      const tc = this.cross((t) => v3.len(pos(t)), h.d);
      if (tc) marks.push({ d: this.travelled(tc), t: tc - m.t0, name: h.name });
    }
    marks.sort((a, b) => a.d - b.d);
    this.nodes = [{ d: 0, t: 0, name: 'Earth' }, ...marks.filter((x) => x.d > 0 && x.d < this.total * 0.995), { d: this.total, t: m.tArrive, name: d.short || d.name, dest: true }];
    this.tHalf = this.cross((t) => this.travelled(t), this.total / 2) - m.t0;
    // flight phases along the track
    this.segs = m.mode === 'straight'
      ? m.prof.phases.filter((p) => !p.rest && p.t0 < m.tArrive).map((p) => ({
        d0: p.x0, d1: Math.min(isFinite(p.dx) ? p.x0 + p.dx : Infinity, this.total),
        kind: p.type === 'thrust' ? (p.flip ? 'brake' : 'accel') : 'cruise',
      })).filter((s) => s.d1 > s.d0)
      : [{ d0: 0, d1: this.total, kind: 'coast' }];
    this.stages = buildStages(m);
    $('trk-stages').innerHTML = this.stages.map((s) => `<li class="${s.kind ? 'k-' + s.kind : ''}"><i></i><span>${s.name}</span><em>${s.t1 > s.t0 ? fmtTime(s.t1 - s.t0) : ''}</em></li>`).join('');
    this.stageEls = [...$('trk-stages').children];
    this.timer = 1;
  }

  /** Planet flybys (closest-approach times, s after launch), shown as notches under the track. */
  setFlybys(times) { this.flybyMarks = times.map((t) => this.travelled(this.m.t0 + t)); this.timer = 1; }

  // Mix: each gap between neighbouring landmarks gets max(true share, a readable minimum); the long
  // gaps give up the room in proportion to their length (repeated until every gap fits).
  mixStops(width) {
    if (this._mix?.width === width && this._mix.nodes === this.nodes) return this._mix.stops;
    const n = this.nodes, gaps = n.slice(1).map((nd, i) => (nd.d - n[i].d) / this.total);
    const gmin = Math.min(MIN_PX / Math.max(width, 1), 0.8 / gaps.length);
    let out = gaps.slice();
    for (let k = 0; k < gaps.length; k++) {
      const small = out.map((g, i) => g <= gmin + 1e-12 || gaps[i] < gmin);
      const fixed = small.filter(Boolean).length * gmin, bigTrue = gaps.reduce((s, g, i) => s + (small[i] ? 0 : g), 0);
      const next = gaps.map((g, i) => (small[i] ? gmin : (g * (1 - fixed)) / bigTrue));
      const done = next.every((g, i) => small[i] || g >= gmin);
      out = next;
      if (done) break;
    }
    const stops = [0];
    for (const g of out) stops.push(stops[stops.length - 1] + g);
    this._mix = { width, nodes: this.nodes, stops };
    return stops;
  }

  // True: linear in distance. Even: landmarks evenly spaced. Mix: see mixStops. Between neighbouring
  // landmarks the probe always moves linearly in distance.
  x(dist, L, R) {
    const lin = Math.max(0, Math.min(1, dist / this.total));
    if (this.scale === 'true') return L + lin * (R - L);
    const n = this.nodes;
    let i = 0;
    while (i < n.length - 2 && dist >= n[i + 1].d) i++;
    const f = Math.max(0, Math.min(1, (dist - n[i].d) / (n[i + 1].d - n[i].d)));
    if (this.scale === 'mix') { const s = this.mixStops(R - L); return L + (s[i] + f * (s[i + 1] - s[i])) * (R - L); }
    return L + ((i + f) / (n.length - 1)) * (R - L);
  }

  update(t, st, dt) {
    if (!this.m) return;
    this.timer += dt;
    if (this.timer < 0.1) return;
    this.timer = 0;
    const m = this.m, rel = Math.max(0, t - m.t0);
    const dist = st.arrived ? this.total : this.travelled(t);
    const prog = dist / this.total;
    $('trk-pct').textContent = `${prog < 0.001 && prog > 0 ? (prog * 100).toPrecision(2) : (prog * 100).toFixed(prog < 0.1 ? 2 : 1)}% of the way`;
    $('trk-el').textContent = fmtDist(dist);
    $('trk-rem').textContent = st.arrived ? '0 km' : fmtDist(this.total - dist);
    this.stages.forEach((s, i) => {
      const last = i === this.stages.length - 1;
      const done = st.arrived || rel > s.t1 || (s.t1 === s.t0 && rel > s.t0 && !last);
      this.stageEls[i].className = done ? 'done' : rel > 0 && rel >= s.t0 ? 'now' : '';
    });
    this.drawTrack(dist, rel, st);
  }

  fit(cv) {
    const dpr = Math.min(devicePixelRatio, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    return [g, W, H];
  }

  drawTrack(dist, rel, st) {
    const [g, W] = this.fit(this.canvas);
    const total = this.total;
    const L = 26, R = W - 26, y = 30;
    const X = (d) => this.x(d, L, R);
    const px = X(dist);
    const seg = (a, b) => { g.beginPath(); g.moveTo(a, y); g.lineTo(b, y); g.stroke(); };
    // flight phases: faint ahead, bright behind the ship. Short burns stay at least 2 px wide.
    g.lineCap = 'butt'; g.lineWidth = 3;
    const kinds = [];
    for (const s of [...this.segs].sort((a, b) => (b.kind === 'cruise') - (a.kind === 'cruise'))) { // cruise underneath
      const c = PHASE[s.kind].rgb, a = X(s.d0), b = Math.max(X(s.d1), a + 2);
      g.strokeStyle = `rgba(${c},0.2)`; seg(a, b);
      if (px > a) { g.strokeStyle = `rgba(${c},0.95)`; seg(a, Math.min(b, Math.max(px, a + 2))); }
      if (!kinds.includes(s.kind)) kinds.push(s.kind);
    }
    // planet flybys (where time slows down): small notches under the track
    g.strokeStyle = 'rgba(235,240,255,0.55)'; g.lineWidth = 1;
    for (const d of this.flybyMarks || []) { const x = X(d); g.beginPath(); g.moveTo(x, y + 3); g.lineTo(x, y + 7); g.stroke(); }
    // legend
    g.font = '9px Inter, sans-serif'; g.textAlign = 'left';
    const leg = ['accel', 'cruise', 'coast', 'brake'].filter((k) => kinds.includes(k));
    const items = [...leg.map((k) => [PHASE[k].name, k]), ['Planet flyby (slow-down)', 'gear']];
    let lx = W / 2 - items.reduce((s, [n]) => s + g.measureText(n).width + 22, 0) / 2;
    for (const [name, k] of items) {
      if (k === 'gear') { g.strokeStyle = 'rgba(235,240,255,0.7)'; g.beginPath(); g.moveTo(lx + 4, y + 28); g.lineTo(lx + 4, y + 33); g.stroke(); }
      else { g.fillStyle = `rgb(${PHASE[k].rgb})`; g.fillRect(lx, y + 29, 8, 3); }
      g.fillStyle = 'rgba(160,168,190,0.85)'; g.fillText(name, lx + 12, y + 33);
      lx += g.measureText(name).width + 22;
    }
    // landmarks at their positions; ends labelled first. In True scale nearby landmarks merge into
    // one label ("Moon distance → Oort cloud"), pushed aside with a leader line if needed.
    g.textAlign = 'center';
    const n = this.nodes;
    const taken = [];
    const free = (a, b) => taken.every(([c, e]) => b < c || a > e);
    n.forEach((nd, i) => {
      const end = i === 0 || nd.dest;
      g.fillStyle = nd.dest ? '#ffbf85' : i === 0 ? '#6fa8ff' : dist >= nd.d ? 'rgba(220,228,250,0.95)' : 'rgba(150,158,182,0.9)';
      g.beginPath(); g.arc(X(nd.d), y, end ? 3.5 : 2.2, 0, 7); g.fill();
    });
    const groups = [];
    for (const nd of n.slice(1, -1)) {
      const x = X(nd.d), last = groups[groups.length - 1];
      if (last && x - last.x1 < 8) { last.items.push(nd); last.x1 = x; } else groups.push({ items: [nd], x0: x, x1: x });
    }
    const place = (name, sub, xc, bold, passed) => {
      g.font = `${bold ? 500 : 400} 10px Inter, sans-serif`;
      const tw = g.measureText(name).width;
      g.font = '9px "JetBrains Mono", monospace';
      const w = Math.max(tw, sub ? g.measureText(sub).width : 0) / 2 + 6;
      let tx = Math.min(Math.max(xc, w), W - w);
      for (let k = 0; k < 6 && !free(tx - w, tx + w); k++) {
        const hit = taken.find(([c, e]) => !(tx + w < c || tx - w > e));
        tx = hit[1] + w + 1;
      }
      if (!free(tx - w, tx + w) || tx + w > W || tx - xc > 260) return;
      taken.push([tx - w, tx + w]);
      if (Math.abs(tx - xc) > w) { // leader line from the landmark(s) to the moved label
        g.strokeStyle = 'rgba(150,158,182,0.45)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(xc, y - 4); g.lineTo(tx - w + 4, y - 13); g.stroke();
      }
      g.font = `${bold ? 500 : 400} 10px Inter, sans-serif`;
      g.fillStyle = bold ? 'rgba(235,240,255,0.95)' : passed ? 'rgba(220,228,250,0.9)' : 'rgba(150,158,182,0.95)';
      g.fillText(name, tx, y - 10);
      if (sub) { g.font = '9px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(125,134,158,0.75)'; g.fillText(sub, tx, y + 17); }
    };
    place('Earth', '', L, true, true);
    place(n[n.length - 1].name, fmtShort(total), R, true, false);
    for (const gr of groups) {
      const a = gr.items[0], b = gr.items[gr.items.length - 1];
      const one = gr.items.length === 1;
      place(one ? a.name : `${a.name} → ${b.name}`, one ? fmtShort(a.d) : `${fmtShort(a.d)} – ${fmtShort(b.d)}`, (gr.x0 + gr.x1) / 2, false, dist >= b.d);
    }
    // light launched together with the probe
    const dl = C * rel;
    if (rel > 0 && dl < total && !st.arrived) {
      const xl = X(dl);
      g.strokeStyle = 'rgba(255,236,170,0.85)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(xl, y - 5); g.lineTo(xl, y + 5); g.stroke();
    }
    glow(g, px, y, 9);
  }

}

function glow(g, x, y, r) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(170,215,255,0.9)'); gr.addColorStop(1, 'rgba(120,180,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}

function fmtShort(m) {
  if (m < 0.05 * AU) return `${Math.round(m / 1e6).toLocaleString()}k km`;
  if (m < 0.05 * LY) return `${m / AU < 10 ? (m / AU).toFixed(1) : Math.round(m / AU).toLocaleString()} AU`;
  const ly = m / LY;
  return ly >= 1e6 ? `${(ly / 1e6).toFixed(1)}M ly` : `${ly < 10 ? ly.toFixed(1) : Math.round(ly).toLocaleString()} ly`;
}

function buildStages(m) {
  const out = [{ name: 'Leave Earth orbit', t0: 0, t1: 0 }];
  if (m.mode === 'ballistic') out.push({ name: 'Coast on transfer orbit', t0: 0, t1: m.tArrive, kind: 'coast' });
  else {
    let flipped = false;
    for (const p of m.prof.phases) {
      if (p.rest || p.t0 >= m.tArrive) continue;
      const t1 = Math.min(p.t0 + p.dt, m.tArrive);
      if (p.flip && !flipped) { flipped = true; out.push({ name: 'Flip, engines forward', t0: p.t0, t1: p.t0 }); }
      if (p.type === 'coast' && t1 - p.t0 < 1) continue; // no zero-length coast for flip-at-midpoint ships
      out.push({ name: p.type === 'thrust' ? p.label : p.label === 'Cruising' ? 'Cruise' : 'Coast', t0: p.t0, t1, kind: p.type === 'thrust' ? (p.flip ? 'brake' : 'accel') : 'cruise', phase: p });
    }
  }
  out.push({ name: m.dest.kind === 'galaxy' ? `Arrive at ${m.dest.short || m.dest.name}` : 'Arrive & enter orbit', t0: m.tArrive, t1: m.tArrive });
  return out;
}
