import { $, fmtTime } from './ui.js';
import { YEAR } from './constants.js';

// Mission updates shown at the top of the screen: stage changes, landmarks passed, time gone by on
// Earth and time-flow changes. Everything shown is about the trip in progress.
const speed = (phi) => {
  const b = Math.tanh(phi);
  if (b > 0.999) return `${(b * 100).toFixed(4)}% of light speed`;
  return b >= 0.1 ? `${(b * 100).toFixed(b > 0.99 ? 1 : 0)}% of light speed` : `${(b * 100).toFixed(1)}% of light speed (${Math.round(b * 299792).toLocaleString()} km/s)`;
};
const LANDMARK = {
  'Moon distance': (T) => `Now farther from Earth than the Moon, after ${T}. Apollo took about 3 days.`,
  'Jupiter orbit': (T) => `Crossed Jupiter's orbit after ${T}.`,
  'Pluto orbit': (T) => `Crossed Pluto's orbit after ${T}: every planet is behind you now.`,
  'Voyager 1 today': (T) => `Passed Voyager 1's distance after ${T}. Voyager needed 49 years to get this far.`,
  'Oort cloud': (T) => `Entering the Oort cloud after ${T}. The Sun is now just a dazzling point of light.`,
  Proxima: (T) => `As far from home as the nearest star, after ${T}.`,
  'Gaia BH1': (T) => `As far as Gaia BH1, the nearest known black hole, after ${T}.`,
  'Galactic centre': (T) => `As far from home as the centre of the Milky Way, after ${T}.`,
};

/** Mission updates as [{t (s after launch), tag, text: () => string}], from the tracker's real crossings and stages. */
function missionEvents(m, tracker) {
  const ev = [];
  const dest = m.dest.short || m.dest.name;
  for (const s of tracker.stages) {
    if (s.t0 >= m.tArrive) continue;
    const dur = fmtTime(s.t1 - s.t0), p = s.phase;
    if (p?.type === 'warp') {
      const x = `${Math.round(m.probe.speed).toLocaleString('en-US')} × light speed`;
      if (s.kind === 'accel') ev.push({ t: s.t0, tag: 'Warp', text: () => `The warp bubble forms: space ahead of it starts to contract and space behind to expand. Nothing aboard feels it.` });
      else if (s.kind === 'cruise') ev.push({ t: s.t0 + 1, tag: 'Warp', text: () => `At warp: ${x} for the next ${dur}. Inside the bubble the ship is at rest, so its clock keeps Earth's time.` });
      else ev.push({ t: s.t0, tag: 'Warp', text: () => `The bubble collapses to stop at ${dest}.` });
      continue;
    }
    if (s.kind === 'coast') ev.push({ t: s.t0, tag: 'Stage', text: () => `Engines off. Coasting on a curved transfer orbit for ${dur}, steered only by ${m.dest.id === 'moon' ? 'Earth\'s' : 'the Sun\'s'} gravity.` });
    else if (s.kind === 'accel') ev.push({ t: s.t0, tag: 'Stage', text: () => `${s.name} begins: ${dur} of thrust, up to ${speed(p.p1)}.` });
    else if (s.kind === 'cruise') ev.push({ t: s.t0 + 1, tag: 'Stage', text: () => `Engines off. Cruising at ${speed(p.phi)} for the next ${dur}.` });
    else if (s.kind === 'brake') ev.push({ t: s.t0 + 2, tag: 'Stage', text: () => `Braking for ${dur} to stop at ${dest}.` });
    else if (s.name.startsWith('Flip')) ev.push({ t: s.t0 + 1, tag: 'Stage', text: () => `Turnaround: the ship flips so its engines face ${dest}.` });
  }
  for (const nd of tracker.nodes.slice(1, -1)) {
    const f = LANDMARK[nd.name] || ((T) => `Crossed ${nd.name.replace(' orbit', '')}'s orbit after ${T}.`);
    ev.push({ t: nd.t, tag: 'Milestone', text: () => f(fmtTime(nd.t)) });
  }
  if (tracker.tHalf > 0) ev.push({ t: tracker.tHalf, tag: 'Milestone', text: () => `Halfway there, after ${fmtTime(tracker.tHalf)}.` });
  if (m.tArrive > 2 * YEAR) {
    for (let y = 1; y * YEAR < m.tArrive * 0.97; y *= 10) {
      ev.push({
        t: y * YEAR, tag: 'Back home', text: () => {
          const tau = m.stateAt(m.t0 + y * YEAR).tau, cal = Math.floor(2000 + (m.t0 + y * YEAR) / YEAR);
          const when = cal < 10000 ? ` It is now ${cal} there.` : '';
          const ship = tau < 0.9 * y * YEAR ? ` Aboard, only ${fmtTime(tau)}.` : '';
          return `${y.toLocaleString()} year${y > 1 ? 's have' : ' has'} passed on Earth since launch.${when}${ship}`;
        },
      });
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}

export class FactTicker {
  constructor() { this.el = $('fact'); this.text = $('fact-text'); this.tag = $('fact-tag'); this.events = []; this.pending = []; this.t = 0; }

  setMission(m, tracker) {
    this.events = missionEvents(m, tracker);
    this.nextEv = 0; this.pending = []; this.t = 0;
    this.hide();
  }

  hide() { this.el.classList.remove('show'); this.visible = false; }

  show(tag, text) {
    this.tag.textContent = tag;
    this.text.textContent = text;
    this.el.classList.remove('hidden');
    requestAnimationFrame(() => this.el.classList.add('show'));
    this.visible = true; this.t = 0;
  }

  /** A mission update that is not tied to a time in the schedule (e.g. a time-flow change). */
  announce(tag, text) {
    // a newer update with the same tag (e.g. repeated time-flow clicks) replaces the queued one
    this.pending = this.pending.filter((e) => e.tag !== tag);
    this.pending.push({ tag, text: () => text, t: null });
  }

  /** rel: seconds since launch. */
  update(dt, active, rel) {
    if (!active) { if (this.visible) this.hide(); return; }
    this.t += dt;
    // each update stays up for at least 4 s; if time runs so fast that they pile up, only the latest
    // three are kept
    while (this.nextEv < this.events.length && rel > 0 && this.events[this.nextEv].t <= rel) this.pending.push(this.events[this.nextEv++]);
    if (this.pending.length > 3) this.pending.splice(0, this.pending.length - 3);
    if (this.pending.length && (!this.visible || this.t > 4)) {
      const e = this.pending.shift();
      this.show(e.t == null ? e.tag : `${e.tag} · T+${fmtTime(Math.max(e.t, 0))}`, e.text());
      return;
    }
    if (this.visible && this.t > 7) this.hide();
  }
}
