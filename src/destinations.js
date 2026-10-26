import { AU, PC, KPC, DAY, v3 } from './constants.js';
import { planetPos, moonGeo, radecToVec } from './astro.js';

// Radii in metres (IAU / NASA fact sheets)
export const RADIUS = {
  sun: 6.957e8, mercury: 2.4397e6, venus: 6.0518e6, earth: 6.371e6, moon: 1.7374e6, mars: 3.3895e6,
  jupiter: 6.9911e7, saturn: 5.8232e7, uranus: 2.5362e7, neptune: 2.4622e7, pluto: 1.1883e6,
};

// Gravitational parameters GM (m³/s²) for arrival orbits
export const GM = {
  mercury: 2.2032e13, venus: 3.24859e14, moon: 4.9048695e12, mars: 4.282837e13, jupiter: 1.26686534e17,
  saturn: 3.7931187e16, uranus: 5.793939e15, neptune: 6.836529e15, pluto: 8.71e11,
};

// ---- interstellar objects (positions fixed relative to the Sun; proper motion ignored)
export const PROXIMA_PC = [-0.472264, -0.361451, -1.151219]; // HYG v4.1 (Gaia distance 1.301 pc)
export const PROXIMA = {
  pos: v3.scale(PROXIMA_PC, PC), radius: 0.1542 * 6.957e8, teff: 3042, absMag: 15.6,
};
// Proxima b: m sin i = 1.07 M⊕, a = 0.04856 AU, P = 11.186 d. Orbit orientation unknown → chosen arbitrarily.
export const PROXIMA_B = { a: 0.04856 * AU, period: 11.1868 * DAY, radius: 1.07 * 6.371e6 };
export function proximaBPos(t) {
  const th = (2 * Math.PI * t) / PROXIMA_B.period;
  const u = v3.norm(v3.cross(PROXIMA_PC, [0, 0, 1])), w = v3.norm(v3.cross(PROXIMA_PC, u));
  // tilt the orbit 30° toward the line of sight so it is not perfectly face-on
  return v3.add(PROXIMA.pos, v3.add(v3.scale(u, Math.cos(th) * PROXIMA_B.a), v3.scale(v3.add(v3.scale(w, 0.87), v3.scale(v3.norm(PROXIMA_PC), 0.5)), Math.sin(th) * PROXIMA_B.a)));
}

// Gaia BH1 (El-Badry et al. 2023): 9.62 M☉ dormant black hole, 480 pc, Sun-like companion,
// P = 185.59 d, e = 0.451, a = 1.40 AU.
const BH1_DIR = radecToVec(262.17121, -0.58109);
export const GAIA_BH1 = {
  pos: v3.scale(BH1_DIR, 480 * PC), mass: 9.62, rs: (2 * 6.6743e-11 * 9.62 * 1.98847e30) / 299792458 ** 2,
  companion: { teff: 5850, radius: 0.78 * 6.957e8, absMag: 5.4, a: 1.40 * AU, e: 0.451, period: 185.59 * DAY },
};
export function bh1CompanionPos(t) {
  const c = GAIA_BH1.companion;
  const M = (2 * Math.PI * t) / c.period;
  let E = M;
  for (let i = 0; i < 20; i++) E -= (E - c.e * Math.sin(E) - M) / (1 - c.e * Math.cos(E));
  const x = c.a * (Math.cos(E) - c.e), y = c.a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
  // Inclination 126.6°, orientation otherwise illustrative
  const u = v3.norm(v3.cross(BH1_DIR, [0, 0, 1])), w = v3.norm(v3.cross(BH1_DIR, u));
  const ci = Math.cos(126.6 * Math.PI / 180), si = Math.sin(126.6 * Math.PI / 180);
  const wy = v3.add(v3.scale(w, ci), v3.scale(BH1_DIR, si));
  return v3.add(GAIA_BH1.pos, v3.add(v3.scale(u, x), v3.scale(wy, y)));
}

// Galaxies (centre directions/distances)
export const GALAXIES = {
  milkyway: { center: v3.scale(radecToVec(266.40499, -28.93617), 8.178 * KPC), pole: radecToVec(192.85948, 27.12825) },
  lmc: { center: v3.scale(radecToVec(80.894, -69.756), 49.59 * KPC), incl: 34.7, pa: 129.9 },
  smc: { center: v3.scale(radecToVec(13.187, -72.829), 62.4 * KPC), incl: 64, pa: 45 },
  andromeda: { center: v3.scale(radecToVec(10.68471, 41.26875), 765 * KPC), incl: 77.0, pa: 38.0 },
};

const planet = (id, name, facts) => ({
  id, name, kind: 'planet', body: id, group: 'Solar System',
  pos: (t) => planetPos(id, t), radius: RADIUS[id], standoff: RADIUS[id] * (id === 'saturn' ? 6 : 3.2), gm: GM[id], facts,
});

export const DESTINATIONS = [
  { id: 'moon', name: 'Moon', kind: 'planet', body: 'moon', group: 'Solar System',
    pos: (t) => v3.add(planetPos('earth', t), moonGeo(t)), radius: RADIUS.moon, standoff: RADIUS.moon * 3.2, gm: GM.moon,
    facts: 'Apollo crews took ~3 days. New Horizons crossed the Moon\'s orbit in under 9 hours.' },
  planet('mercury', 'Mercury', 'Hardest planet to reach: probes must shed speed falling toward the Sun.'),
  planet('venus', 'Venus', 'Thick CO₂ atmosphere; surface 465 °C. Shown by its cloud tops.'),
  planet('mars', 'Mars', 'Typical transfers take 6–9 months and only open every 26 months.'),
  planet('jupiter', 'Jupiter', 'Largest planet; its gravity slingshot sent Voyager on to Saturn.'),
  planet('saturn', 'Saturn', 'Rings span 280,000 km but are mostly only ~10 m thick.'),
  planet('uranus', 'Uranus', 'Rolls on its side: axial tilt of 98°. Only Voyager 2 has visited.'),
  planet('neptune', 'Neptune', 'Winds reach 2,100 km/h. Voyager 2 took 12 years to get here.'),
  planet('pluto', 'Pluto', 'New Horizons flew past in July 2015 after 9.5 years.'),
  { id: 'proxima', name: 'Proxima Centauri b', kind: 'star', group: 'Nearest star', short: 'Proxima b',
    pos: (t) => proximaBPos(t), radius: PROXIMA_B.radius, standoff: PROXIMA_B.radius * 3.5, gm: 1.07 * 3.986004e14,
    facts: 'Nearest star to the Sun (4.24 ly), a red dwarf with an Earth-mass planet in its habitable zone. The planet\'s surface has never been seen; it is shown as an artist\'s impression.' },
  { id: 'gaiabh1', name: 'Gaia BH1', kind: 'blackhole', group: 'Nearest black hole',
    pos: () => GAIA_BH1.pos, radius: GAIA_BH1.rs, standoff: 24 * GAIA_BH1.rs, // ~680 km: just outside the (illustrative) disk gm: 9.62 * 1.32712440018e20,
    facts: 'Nearest known black hole (1,560 ly): 9.6 Suns packed inside an event horizon just 57 km across. Found by the Gaia spacecraft in 2022 from the wobble of its Sun-like companion star.' },
  { id: 'andromeda', name: 'Andromeda Galaxy', kind: 'galaxy', group: 'Nearest large galaxy',
    pos: () => GALAXIES.andromeda.center, radius: 30 * KPC, standoff: 62 * KPC,
    facts: 'Nearest large spiral (2.5 million ly), ~1 trillion stars. It is approaching us at 110 km/s and will merge with the Milky Way in ~4.5 billion years.' },
];
export const destById = (id) => DESTINATIONS.find((d) => d.id === id);
