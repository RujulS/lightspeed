import { AU, LY, v3 } from './constants.js';
import { planetPos, OBLIQUITY } from './astro.js';
import { PROXIMA, GAIA_BH1, GALAXIES } from './destinations.js';
import { $, fmtDist } from './ui.js';

// Map of the whole journey, seen from above with the Sun at the centre (Earth for Moon trips).
// Direction on the map is the real direction in the sky (ecliptic longitude); distance from the centre
// is on a logarithmic scale, so the planets, the Oort cloud and the destination all fit at once and
// the view never has to jump. Each dashed ring is 10× farther out than the one inside it.

const cE = Math.cos(OBLIQUITY), sE = Math.sin(OBLIQUITY);
const polar = ([x, y, z]) => [Math.hypot(x, y, z), Math.atan2(cE * y + sE * z, x)];
const PLANETS = { mercury: 0.387, venus: 0.723, earth: 1, mars: 1.524, jupiter: 5.203, saturn: 9.537, uranus: 19.19, neptune: 30.07, pluto: 39.48 };
const SCALE = [
  [1e7, '10,000 km'], [1e8, '100,000 km'], [1e9, '1 million km'],
  [10 * AU, '10 AU'], [100 * AU, '100 AU'], [1000 * AU, '1,000 AU'], [10000 * AU, '10,000 AU'],
  [LY, '1 light-year'], [10 * LY, '10 ly'], [100 * LY, '100 ly'], [1000 * LY, '1,000 ly'], [1e4 * LY, '10,000 ly'],
  [1e5 * LY, '100,000 ly'], [1e6 * LY, '1 million ly'],
];
const BANDS = [[2.2 * AU, 3.2 * AU, 'Asteroid belt', '170,150,120'], [30 * AU, 50 * AU, 'Kuiper belt', '150,170,210'], [2000 * AU, 1e5 * AU, 'Oort cloud', '150,190,255']];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export class Radar {
  /** canvas: the map in its panel; big: a large version opened by clicking it. */
  constructor(canvas, big) {
    this.cv = canvas; this.big = big;
    const toggle = () => big.classList.toggle('hidden');
    canvas.addEventListener('click', toggle);
    big.addEventListener('click', toggle);
  }

  setMission(m) {
    this.m = m;
    this.geo = m.dest.id === 'moon';
    const tA = m.t0 + m.tArrive;
    const rDest = v3.len(v3.sub(m.dest.pos(tA), this.center(tA)));
    [this.rMin, this.rMax] = this.geo ? [1.5e7, 4.6e8] : [0.2 * AU, Math.max(rDest * 1.25, 1.8 * AU)];
    // the flight path, as positions relative to the centre
    const N = 300;
    this.straight = m.mode === 'straight' && !this.geo;
    this.path = [];
    if (this.straight) {
      for (let i = 0; i <= N; i++) { const d = i === 0 ? 0 : m.L * Math.pow(1e-9, 1 - i / N); this.path.push(v3.add(m.S, v3.scale(m.dir, d))); }
    } else {
      for (let i = 0; i <= N; i++) { const t = m.t0 + (m.tArrive * i) / N; this.path.push(v3.sub(m.travelState(t).pos, this.center(t))); }
    }
    $('mp-sub').textContent = this.geo ? 'Earth at centre' : 'Sun at centre';
  }

  center(t) { return this.geo ? planetPos('earth', t) : [0, 0, 0]; }

  update(t, st) {
    if (!this.m) return;
    this.draw(this.cv, t, st);
    if (!this.big.classList.contains('hidden')) this.draw(this.big, t, st);
    const r = v3.len(v3.sub(st.pos, this.center(t)));
    $('mp-foot').innerHTML = `You are <b>${fmtDist(r)}</b> from ${this.geo ? 'Earth' : 'the Sun'}<br>each dashed ring is 10× farther out`;
  }

  draw(cv, t, st) {
    const dpr = Math.min(devicePixelRatio, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (W < 24 || H < 24) return; // hidden: nothing to draw, and arc() throws on a negative radius
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const TAU = Math.PI * 2;
    const R = Math.min(W, H) / 2 - 2, cx = W / 2, cy = H / 2;
    const k = Math.min(1.5, Math.max(1, R / 115));
    const lr = Math.log(this.rMax / this.rMin);
    const rho = (r) => R * Math.max(0, Math.min(1, Math.log(Math.max(r, 1) / this.rMin) / lr));
    const c0 = this.center(t);
    const map = (rel) => { const [r, lon] = polar(rel); const p = rho(r); return [cx + p * Math.cos(lon), cy - p * Math.sin(lon)]; };
    const at = (w) => map(v3.sub(w, c0));
    const boxes = [];
    const text = (str, x, y, col, size = 9, align = 'left', weight = 400) => {
      g.font = `${weight} ${size * k}px Inter, sans-serif`;
      const w = g.measureText(str).width, h = size * k;
      const x0 = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
      if (x0 < 2 || x0 + w > W - 2) return false;
      if (boxes.some(([a, b, c, d]) => x0 < c && x0 + w > a && y - h < d && y > b)) return false;
      boxes.push([x0, y - h, x0 + w, y]);
      g.textAlign = align; g.fillStyle = col; g.fillText(str, x, y);
      return true;
    };
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    g.fillStyle = 'rgba(6,10,22,0.92)'; g.fillRect(0, 0, W, H);
    const circle = (r, style, w, dash) => {
      g.setLineDash(dash || []); g.strokeStyle = style; g.lineWidth = w;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); g.setLineDash([]);
    };
    // regions
    if (!this.geo) for (const [r0, r1, , col] of BANDS) {
      const a = rho(r0), b = rho(r1);
      if (b - a < 1 || a >= R) continue;
      g.fillStyle = `rgba(${col},0.1)`; g.beginPath(); g.arc(cx, cy, b, 0, TAU); g.arc(cx, cy, a, TAU, 0, true); g.fill();
    }
    // distance scale: dashed rings at each 10× step
    const scale = SCALE.filter(([r]) => r > this.rMin * 1.5 && r < this.rMax);
    for (const [r] of scale) circle(rho(r), 'rgba(150,170,220,0.2)', 0.7, [2, 3]);
    // orbits
    const orbits = this.geo ? { moon: 3.844e8 } : Object.fromEntries(Object.entries(PLANETS).map(([p, a]) => [p, a * AU]));
    for (const [p, a] of Object.entries(orbits)) {
      const pr = rho(a);
      if (pr > 3 && pr < R) circle(pr, p === 'earth' ? 'rgba(111,168,255,0.45)' : 'rgba(190,200,230,0.28)', 0.9);
    }
    // path: solid behind the ship, dashed ahead
    const rel = Math.min(1, Math.max(0, (t - this.m.t0) / this.m.tArrive));
    const shipRel = v3.sub(st.pos, c0);
    const shipR = v3.len(shipRel);
    const pts = this.path.map(map);
    const passed = this.straight ? this.path.map((p) => v3.len(v3.sub(p, this.m.S)) <= v3.len(v3.sub(st.pos, this.m.S)))
      : this.path.map((_, i) => i / (this.path.length - 1) <= rel);
    g.lineWidth = 1.2;
    g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,191,133,0.6)';
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    g.setLineDash([]); g.strokeStyle = 'rgba(142,197,255,1)'; g.lineWidth = 1.8;
    const shipP = map(shipRel);
    g.beginPath(); let started = false;
    pts.forEach(([x, y], i) => { if (!passed[i]) return; if (started) g.lineTo(x, y); else g.moveTo(x, y); started = true; });
    if (started) { g.lineTo(...shipP); g.stroke(); }
    // ship: an arrow pointing the way it is going (labelled first, so its label always shows)
    const vdir = v3.len(st.vel) > 0 ? v3.norm(st.vel) : this.m.dir || [1, 0, 0];
    const ahead = map(v3.add(shipRel, v3.scale(vdir, Math.max(shipR, this.rMin) * 0.05)));
    let hx = ahead[0] - shipP[0], hy = ahead[1] - shipP[1];
    const hl = Math.hypot(hx, hy) || 1; hx /= hl; hy /= hl;
    const sz = 6 * k;
    g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(80,150,255,1)'; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(shipP[0] + hx * sz, shipP[1] + hy * sz);
    g.lineTo(shipP[0] - hx * sz * 0.7 - hy * sz * 0.65, shipP[1] - hy * sz * 0.7 + hx * sz * 0.65);
    g.lineTo(shipP[0] - hx * sz * 0.7 + hy * sz * 0.65, shipP[1] - hy * sz * 0.7 - hx * sz * 0.65);
    g.closePath(); g.fill(); g.stroke();
    if (!text('You', shipP[0] + 8 * k, shipP[1] + 4 * k, '#ffffff', 10, 'left', 600)) text('You', shipP[0] - 8 * k, shipP[1] + 4 * k, '#ffffff', 10, 'right', 600);
    // destination: always on the map
    const dname = this.m.dest.short || this.m.dest.name;
    const dp = at(this.m.dest.pos(t));
    g.fillStyle = '#ffbf85'; g.beginPath(); g.arc(dp[0], dp[1], 3.6 * k, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,191,133,0.5)'; g.lineWidth = 1; g.beginPath(); g.arc(dp[0], dp[1], 6.5 * k, 0, TAU); g.stroke();
    if (!text(dname, dp[0] + 9 * k, dp[1] + 4 * k, '#ffd2a8', 10, 'left', 600)) text(dname, dp[0] - 9 * k, dp[1] + 4 * k, '#ffd2a8', 10, 'right', 600);
    // centre body, then planets and other landmarks
    g.fillStyle = this.geo ? '#6fa8ff' : '#fff1c8';
    g.beginPath(); g.arc(cx, cy, 4 * k, 0, TAU); g.fill();
    text(this.geo ? 'Earth' : 'Sun', cx + 7 * k, cy + 4 * k, this.geo ? '#9cc2ff' : 'rgba(255,241,200,0.9)', 9.5, 'left', 500);
    if (!this.geo) {
      for (const p of ['earth', ...Object.keys(PLANETS).filter((x) => x !== 'earth' && x !== this.m.dest.body)]) {
        const pr = rho(PLANETS[p] * AU);
        if (pr < 4 || pr >= R) continue;
        const pp = at(planetPos(p, t));
        g.fillStyle = p === 'earth' ? '#6fa8ff' : 'rgba(230,220,200,0.95)';
        g.beginPath(); g.arc(pp[0], pp[1], (p === 'earth' ? 2.8 : 2.2) * k, 0, TAU); g.fill();
        text(cap(p), pp[0] + 5 * k, pp[1] + 3.5 * k, p === 'earth' ? '#9cc2ff' : 'rgba(215,220,235,0.85)', 8.5);
      }
      for (const [w, name] of [[PROXIMA.pos, 'Proxima'], [GAIA_BH1.pos, 'Gaia BH1'], [GALAXIES.milkyway.center, 'Galactic centre'], [GALAXIES.andromeda.center, 'Andromeda']]) {
        if (dname.startsWith(name) || (this.m.dest.id === 'proxima' && name === 'Proxima') || v3.len(w) > this.rMax) continue;
        const pp = at(w);
        g.fillStyle = 'rgba(255,225,195,0.9)'; g.beginPath(); g.arc(pp[0], pp[1], 2 * k, 0, TAU); g.fill();
        text(name, pp[0] + 5 * k, pp[1] + 3.5 * k, 'rgba(230,215,200,0.8)', 8.5);
      }
      // region names, across the top of each band
      for (const [r0, r1, name] of BANDS) {
        const a = rho(r0), b = rho(r1);
        if (b - a < 6 * k || a >= R - 10) continue;
        text(name, cx, cy - (a + b) / 2 + 3 * k, 'rgba(180,195,230,0.6)', 8, 'center');
      }
    }
    // scale labels, down the lower right
    for (const [r, name] of scale) {
      const pr = rho(r);
      if (pr < 14 * k) continue;
      text(name, cx + pr * 0.71 + 2, cy + pr * 0.71 - 2, 'rgba(150,170,220,0.65)', 7.5);
    }
    g.restore();
    g.strokeStyle = 'rgba(140,170,230,0.3)'; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
  }
}
