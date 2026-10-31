import { DAY, YEAR } from './constants.js';
import { Mission, probeById } from './missions.js';
import { fmtTime } from './ui.js';

// Time flow: one round factor (1 s = 3 months, 1 s = 100 years …) for the cruise of a trip, the same
// for most ships going to the same destination, so faster ships visibly get there faster. Three
// announced moments run slower: liftoff, planet flybys and arrival. Together they make the trip's
// timeline; the user's speed (½×, 2× …) scales all of it evenly, so the proportions never change.

const MONTH = YEAR / 12;
const STEPS = [
  [1, 'Real time'], [2, '2 seconds'], [5, '5 seconds'], [10, '10 seconds'], [30, '30 seconds'],
  [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes'], [1800, '30 minutes'],
  [3600, '1 hour'], [3 * 3600, '3 hours'], [6 * 3600, '6 hours'], [12 * 3600, '12 hours'],
  [DAY, '1 day'], [2 * DAY, '2 days'], [7 * DAY, '1 week'], [14 * DAY, '2 weeks'],
  [MONTH, '1 month'], [3 * MONTH, '3 months'], [6 * MONTH, '6 months'],
];
for (let e = 0; e <= 9; e++) for (const k of [1, 2, 5]) {
  const y = k * 10 ** e;
  const txt = y >= 1e6 ? `${y / 1e6} million years` : `${y.toLocaleString('en-US')} year${y > 1 ? 's' : ''}`;
  STEPS.push([y * YEAR, txt]);
}
export const RATES = STEPS.map((s) => s[0]);

/** Nearest readable rate (in log terms), never below real time. */
export function niceRate(r) {
  let best = 0;
  for (let i = 0; i < RATES.length; i++) if (Math.abs(Math.log(RATES[i] / r)) < Math.abs(Math.log(RATES[best] / r))) best = i;
  return RATES[best];
}
/** Smallest readable rate at or above r. */
export function niceUp(r) { return RATES.find((x) => x >= r) ?? RATES[RATES.length - 1]; }

export function rateText(r) {
  const s = STEPS.find((x) => Math.abs(x[0] / r - 1) < 1e-6);
  return r === 1 ? 'Real time' : `1 s = ${s ? s[1] : fmtTime(r)}`;
}

// The user's speed: a plain multiplier on the whole timeline. Real time is no limit here: at ½× a
// flyby already at real time plays in slow motion.
export const SPEEDS = [1 / 8, 1 / 4, 1 / 2, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
export function stepSpeed(v, dir) {
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(v) + dir))];
}
export function speedText(v) {
  return `${{ 0.125: '⅛', 0.25: '¼', 0.5: '½' }[v] ?? v.toLocaleString('en-US')}×`;
}
/** The rate as a settled, readable step (ramps sweep through every value between them). */
export function roundRate(r) { return r < 1 ? r : niceRate(r); }

/**
 * Default factor for a destination: a mid-range ship (Project Daedalus) makes the trip in about two
 * minutes of screen time. Slower ships then take visibly longer, faster ones visibly less.
 */
const DEFAULT_SCREEN = 120;
const cache = {};
export function defaultFactor(dest, launchT) {
  if (!cache[dest.id]) cache[dest.id] = niceRate(Math.max(1, new Mission(probeById('daedalus'), dest, launchT, null).tArrive / DEFAULT_SCREEN));
  return cache[dest.id];
}

/** A one-line, human-scale sense of a long stretch of time. */
export function humanScale(s) {
  const y = s / YEAR;
  if (y < 2) return '';
  if (y < 80) return `about ${Math.round(y / 80 * 100)}% of a human lifetime`;
  if (y < 5000) return `about ${Math.round(y / 25).toLocaleString('en-US')} human generations`;
  if (y < 300000) return `${Math.round(y / 5000) > 1 ? Math.round(y / 5000) + '× ' : ''}longer than all of recorded history`;
  return `longer than our species has existed`;
}
