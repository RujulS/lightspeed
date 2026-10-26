import { C, AU, LY, DAY, YEAR, G0, v3, simToDate, dateToSim } from './constants.js';
import { PROBES, Mission } from './missions.js';
import { DESTINATIONS } from './destinations.js';
import { planetPos } from './astro.js';

export const $ = (id) => document.getElementById(id);
const nf = (x, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

function big(x, unit) {
  if (x >= 1e9) return `${nf(x / 1e9, x < 1e10 ? 2 : 1)} billion ${unit}`;
  if (x >= 1e6) return `${nf(x / 1e6, x < 1e7 ? 2 : 1)} million ${unit}`;
  return `${nf(x, x < 10 ? 2 : x < 100 ? 1 : 0)} ${unit}`;
}

export function fmtDist(m) {
  m = Math.abs(m);
  if (m < 1e3) return `${nf(m, 1)} m`;
  if (m < 0.05 * AU) return `${nf(m / 1e3)} km`;
  if (m < 0.05 * LY) return `${nf(m / AU, m < 10 * AU ? 3 : m < 1000 * AU ? 2 : 0)} AU`;
  return big(m / LY, 'ly');
}

export function fmtTime(s) {
  s = Math.abs(s);
  if (!isFinite(s)) return '∞';
  if (s < 1) return `${nf(s * 1000)} ms`;
  if (s < 120) return `${nf(s, 1)} s`;
  if (s < 2 * 3600) return `${nf(s / 60, 1)} min`;
  if (s < 2 * DAY) return `${nf(s / 3600, 1)} h`;
  if (s < 2 * YEAR) return `${nf(s / DAY, s < 20 * DAY ? 1 : 0)} days`;
  return big(s / YEAR, 'years');
}

export function fmtDate(t) {
  const yr = 2000 + t / YEAR;
  if (yr > 9999 || yr < 0) return `Year ${yr > 1e6 ? big(yr, '').trim() : nf(Math.round(yr))}`;
  const d = simToDate(t);
  return d.toISOString().slice(0, 10);
}

export function fmtWarp(w) {
  if (w < 0.9) return `slow motion ×${w.toFixed(2)}`;
  if (w < 1.5) return 'real time';
  return `1 s = ${fmtTime(w)}`;
}

// ------------------------------------------------------------------------------------------ setup
export class Setup {
  constructor(onLaunch) {
    this.onLaunch = onLaunch;
    this.dest = 'proxima';
    this.probe = 'starshot';
    const today = new Date();
    $('i-date').value = today.toISOString().slice(0, 10);
    $('i-date').addEventListener('change', () => this.refresh());
    $('b-launch').addEventListener('click', () => this.onLaunch(this.dest, this.probe, this.launchT()));
    this.build();
  }
  launchT() { return dateToSim(new Date($('i-date').value + 'T12:00:00Z')); }

  build() {
    const dl = $('dest-list');
    dl.innerHTML = '';
    let group = '';
    const t = this.launchT();
    for (const d of DESTINATIONS) {
      if (d.group !== group) { group = d.group; dl.insertAdjacentHTML('beforeend', `<div class="group-h">${group}</div>`); }
      const dist = v3.len(v3.sub(d.pos(t), planetPos('earth', t)));
      const b = document.createElement('button');
      b.className = 'card' + (d.id === this.dest ? ' on' : '');
      b.innerHTML = `<span class="nm">${d.name}</span><span class="dd">${fmtDist(dist)}</span>`;
      b.onclick = () => { this.dest = d.id; this.build(); };
      dl.appendChild(b);
    }
    const pl = $('probe-list');
    pl.innerHTML = '';
    for (const p of PROBES) {
      const b = document.createElement('button');
      b.className = 'card pcard' + (p.id === this.probe ? ' on' : '');
      const top = p.kind === 'cruise' ? p.v / 1e3 + ' km/s' : p.kind === 'ballistic' ? p.cruise / 1e3 + ' km/s'
        : p.stages[p.stages.length - 1].beta >= 1 ? '→ c' : (p.stages[p.stages.length - 1].beta * 100).toFixed(1) + '% c';
      b.innerHTML = `<div class="row"><span class="nm">${p.name}</span><span class="dd">${top}</span></div><div class="tag">${p.tag}</div><div class="bl">${p.blurb}</div>`;
      b.onclick = () => { this.probe = p.id; this.build(); };
      pl.appendChild(b);
    }
    this.refresh();
  }

  refresh() {
    const t = this.launchT();
    const d = DESTINATIONS.find((x) => x.id === this.dest);
    $('dest-facts').textContent = d.facts;
    const rows = PROBES.map((p) => {
      const m = new Mission(p, d, t, null);
      return { p, te: m.t0 - t + m.tArrive, ts: m.shipTimeAtArrival() };
    });
    const lightT = v3.len(v3.sub(d.pos(t), planetPos('earth', t))) / C;
    const max = Math.log10(Math.max(...rows.map((r) => r.te)) * 3), min = Math.log10(Math.min(lightT, ...rows.map((r) => r.te)) / 3);
    const w = (x) => ((Math.log10(x) - min) / (max - min)) * 100;
    let html = `<div class="bar-row light"><div class="lab"><span>Light</span><span>${fmtTime(lightT)}</span></div><div class="bar"><div style="width:${w(lightT)}%"></div></div></div>`;
    for (const r of rows) {
      const ship = r.ts < r.te * 0.97 ? ` · crew ages ${fmtTime(r.ts)}` : '';
      html += `<div class="bar-row ${r.p.id === this.probe ? 'on' : ''}" data-p="${r.p.id}"><div class="lab"><span>${r.p.name}</span><span>${fmtTime(r.te)}${ship}</span></div><div class="bar"><div style="width:${w(r.te)}%"></div></div></div>`;
    }
    $('cmp').innerHTML = html + '<div class="group-h" style="margin-top:4px">log scale</div>';
    $('cmp').querySelectorAll('.bar-row[data-p]').forEach((el) => el.addEventListener('click', () => { this.probe = el.dataset.p; this.build(); }));
  }
  show(v) { $('setup').classList.toggle('hidden', !v); }
}
