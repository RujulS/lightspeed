# Lightspeed

A 3-D simulation of travelling from Earth to the planets, Pluto, Proxima b, the black hole Gaia BH1 and the Andromeda Galaxy, in real and proposed spacecraft. Voyager 1, Parker Solar Probe, Project Orion, Project Daedalus, Breakthrough Starshot and an ideal antimatter ship are all included. It aims to give a true feel for how long these journeys take and how far they go.

**Live:** https://rujuls.github.io/lightspeed/

Built with [three.js](https://threejs.org) and [Vite](https://vitejs.dev).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5199. `npm run build` writes a static site to `dist/`.

## Music

Put audio files (MP3, M4A or OGG) in `public/music/` and list them in `public/music/tracks.json`:

```json
[{ "file": "deep-field.mp3", "title": "Deep Field" }]
```

Files you only want on your own machine go in `public/music/local/` with their own `tracks.json` (file paths start with `local/`); that folder is git-ignored. They then appear in the music menu (the note icon, top right, during a trip). Sound effects are synthesised in the browser and need no files.

## What it models

- **Trips:** real planet positions (JPL elements). Planet trips by slow ships follow ballistic transfer orbits; the others fly straight relativistic acceleration, coast and braking profiles. Time aboard and on Earth both come out of the same rapidity integration.
- **Time:** one time factor per destination, the same for every ship, so the speed differences are obvious. Liftoff, planet flybys and the final approach run in announced slow motion.
- **Relativity:** aberration and Doppler shift of everything you see. Near light speed the whole sky collapses into a point ahead.
- **Gaia BH1:** a ray-traced spinning (Kerr) black hole, with a Novikov–Thorne disk and Page–Thorne temperature profile. Each part of the disk is coloured by the Doppler shift and gravitational redshift together. The real hole's spin is unmeasured; it is shown at a/M = 0.9.
- **Galaxies:** the Milky Way is built from published structural measurements; Andromeda is a photograph placed at its true position, size and orientation. Arriving at Andromeda shows its halo stars, globular clusters and neighbouring galaxies as a long exposure would.
- **Warp drive:** Alcubierre's bubble at a speed you choose in the menu (1 × c up to a light-year a minute). No time dilation or felt acceleration aboard; the bubble is drawn as a lens that squeezes the view ahead and stretches it behind. Illustrative, and it would need negative energy.
- **Moons and orbits:** major moons at their real distances and periods, planet orbits, the flight path, and illustrative planet flybys.

## Credits

- Planet textures: Solar System Scope (CC BY 4.0).
- Milky Way: NASA/Goddard SVS Deep Star Maps 2020 (the sky from inside); NASA/JPL-Caltech/ESO/R. Hurt illustration eso1339g, CC BY 4.0 (seen from outside).
- Voyager and Parker models: NASA 3D Resources.
- Star catalogue: HYG Database v4.1 (CC BY-SA 4.0).
- Andromeda photo: Adam Evans (CC BY 2.0), with the foreground stars removed.
- The black-hole rendering approach was inspired by [SkyWalkerPS/kerr-black-hole](https://github.com/SkyWalkerPS/kerr-black-hole); the code here is an independent implementation.
- Orion, Daedalus, Starshot and the antimatter ship are reconstructions from their design studies.
