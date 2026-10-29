import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// Every model is built with its nose (direction of travel) along local +Z and real-world size in metres.

const gltf = new GLTFLoader();
gltf.setDRACOLoader(new DRACOLoader().setDecoderPath('draco/'));
const M = {
  gold: () => new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.32 }),
  foil: () => new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 1, roughness: 0.45 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.35 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.55 }),
  white: () => new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.05, roughness: 0.6 }),
  radiator: () => new THREE.MeshStandardMaterial({ color: 0x1b1f2a, metalness: 0.3, roughness: 0.4, emissive: 0x220800, emissiveIntensity: 0.6 }),
  copper: () => new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 1, roughness: 0.3 }),
};

async function loadGLB(url, length, fix) {
  const g = await gltf.loadAsync(url);
  const obj = g.scene;
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m.envMapIntensity !== undefined) m.envMapIntensity = 0.6; });
    }
  });
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  const wrap = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(obj);
  inner.scale.setScalar(length / Math.max(size.x, size.y, size.z));
  if (fix) inner.rotation.set(...fix);
  wrap.add(inner);
  return wrap;
}

function cyl(r1, r2, h, mat, seg = 48) { return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat); }
function along(mesh, z) { mesh.rotation.x = Math.PI / 2; mesh.position.z = z; return mesh; }

// ---- Project Daedalus (BIS 1978): 190 m, two stages, spherical D/He-3 tanks, 32 m beryllium shield
// Detailed procedural model based on the BIS final report: two-stage tandem fusion starship with
// ICF reaction chambers, magnetic field coils, spherical propellant tanks, lattice truss spine,
// propellant feed lines, payload bay, and beryllium erosion shield.
function daedalus() {
  const g = new THREE.Group();
  const steel = M.steel(), gold = M.gold(), dark = M.dark(), white = M.white(), copper = M.copper();
  const radiator = M.radiator();
  // Materials for the molybdenum-alloy engine structure (TZM: Mo-Ti-Zr-C)
  const molyb = new THREE.MeshStandardMaterial({ color: 0x6e7078, metalness: 0.92, roughness: 0.28 });

  // ========== STAGE 1 (rear) — the massive booster ==========
  // Stage 1 reaction chamber: hemispherical bell, 100 m diameter
  const bell1 = new THREE.Mesh(
    new THREE.SphereGeometry(50, 72, 36, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2.2), molyb);
  bell1.rotation.x = -Math.PI / 2; bell1.position.z = -55; g.add(bell1);
  // Inner surface — copper-coloured reflective lining for electron beam injection
  const bell1Inner = new THREE.Mesh(
    new THREE.SphereGeometry(49, 72, 36, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2.2), copper);
  bell1Inner.material.side = THREE.BackSide;
  bell1Inner.rotation.x = -Math.PI / 2; bell1Inner.position.z = -55; g.add(bell1Inner);
  // Nozzle throat / pellet injection collar
  g.add(along(cyl(12, 12, 2, dark, 48), -53));
  // Structural ring at the bell opening
  const bellRim1 = new THREE.Mesh(new THREE.TorusGeometry(50, 1.2, 12, 72), molyb);
  bellRim1.position.z = -55; g.add(bellRim1);

  // Magnetic field coils (superconducting) — 5 coils expanding rearward from the chamber
  for (let i = 0; i < 5; i++) {
    const r = 14 + i * 8.5;
    const coil = new THREE.Mesh(new THREE.TorusGeometry(r, 1.1, 10, 64), copper);
    coil.position.z = -58 - i * 7; g.add(coil);
  }
  // Coil support struts (6 longerons connecting coils)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 36, 6), dark);
    s.position.set(Math.cos(a) * 32, Math.sin(a) * 32, -80);
    s.rotation.x = Math.PI / 2; s.rotation.z = 0; g.add(s);
  }

  // Thrust structure — conical adapter from bell to tank cluster
  g.add(along(cyl(14, 24, 26, dark), -38));
  // Structural ring at thrust structure top
  g.add(along(cyl(24, 24, 1.5, molyb, 64), -24));

  // Stage 1 propellant tanks: 4 × spherical D/He-3 tanks (each ~20 m radius)
  // Arranged symmetrically around the spine, tilted at 45° to give the classic silhouette
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = Math.cos(a) * 28, cy = Math.sin(a) * 28;
    // Tank sphere — white cryogenic insulation
    const tank = new THREE.Mesh(new THREE.SphereGeometry(20, 48, 24), white);
    tank.position.set(cx, cy, -8); g.add(tank);
    // Equatorial reinforcement band
    const band = new THREE.Mesh(new THREE.TorusGeometry(20.2, 0.6, 8, 48), steel);
    band.position.set(cx, cy, -8); g.add(band);
    // Load-bearing struts — upper and lower pairs connecting tank to spine
    for (const dz of [-12, 4]) {
      const strut = cyl(1.0, 1.0, 26, dark, 8);
      strut.rotation.z = a + Math.PI / 2;
      strut.position.set(Math.cos(a) * 14, Math.sin(a) * 14, dz); g.add(strut);
    }
    // Propellant feed line from tank to engine
    const feedPts = [
      new THREE.Vector3(cx, cy, -20),
      new THREE.Vector3(cx * 0.5, cy * 0.5, -30),
      new THREE.Vector3(0, 0, -42),
    ];
    const feedCurve = new THREE.CatmullRomCurve3(feedPts);
    const feedGeo = new THREE.TubeGeometry(feedCurve, 16, 0.8, 8, false);
    g.add(new THREE.Mesh(feedGeo, dark));
  }

  // ========== CENTRAL SPINE (lattice truss) ==========
  // Open-lattice truss spine connecting stage 1 to stage 2 and payload
  // Modelled as 3 longerons with cross-bracing (triangular cross-section)
  const spineLen = 70, spineStart = 0, spineSegments = 10;
  const spineR = 5; // radius of the triangular cross-section
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const x = Math.cos(a) * spineR, y = Math.sin(a) * spineR;
    // Longeron
    const lon = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, spineLen, 6), dark);
    lon.rotation.x = Math.PI / 2;
    lon.position.set(x, y, spineStart + spineLen / 2); g.add(lon);
    // Cross bracing: diagonal members between this longeron and the next
    const a2 = ((k + 1) % 3 / 3) * Math.PI * 2;
    const x2 = Math.cos(a2) * spineR, y2 = Math.sin(a2) * spineR;
    for (let s = 0; s < spineSegments; s++) {
      const z0 = spineStart + (s / spineSegments) * spineLen;
      const z1 = spineStart + ((s + 1) / spineSegments) * spineLen;
      // V-brace from (k, z0) to (k+1, z_mid) and back
      const mid = (z0 + z1) / 2;
      const pts = [new THREE.Vector3(x, y, z0), new THREE.Vector3(x2, y2, mid)];
      const bg = new THREE.BufferGeometry().setFromPoints(pts);
      g.add(new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0x4a4e55 })));
      const pts2 = [new THREE.Vector3(x2, y2, mid), new THREE.Vector3(x, y, z1)];
      const bg2 = new THREE.BufferGeometry().setFromPoints(pts2);
      g.add(new THREE.Line(bg2, new THREE.LineBasicMaterial({ color: 0x4a4e55 })));
    }
  }
  // Structural rings at key truss points
  for (const z of [spineStart, spineStart + spineLen / 2, spineStart + spineLen]) {
    g.add(along(cyl(spineR + 1, spineR + 1, 0.8, molyb, 32), z));
  }

  // ========== STAGE 2 — the interstellar cruiser ==========
  // Stage 2 reaction chamber (40 m diameter bell)
  const bell2 = new THREE.Mesh(
    new THREE.SphereGeometry(20, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2.2), molyb);
  bell2.rotation.x = -Math.PI / 2; bell2.position.z = spineStart - 2; g.add(bell2);
  const bell2Inner = new THREE.Mesh(
    new THREE.SphereGeometry(19, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2.2), copper);
  bell2Inner.material.side = THREE.BackSide;
  bell2Inner.rotation.x = -Math.PI / 2; bell2Inner.position.z = spineStart - 2; g.add(bell2Inner);
  // Bell rim ring
  const bellRim2 = new THREE.Mesh(new THREE.TorusGeometry(20, 0.7, 10, 48), molyb);
  bellRim2.position.z = spineStart - 2; g.add(bellRim2);

  // Stage 2 magnetic coils (smaller, 3 coils)
  for (let i = 0; i < 3; i++) {
    const r = 8 + i * 5;
    const coil = new THREE.Mesh(new THREE.TorusGeometry(r, 0.8, 8, 48), copper);
    coil.position.z = spineStart - 4 - i * 5; g.add(coil);
  }

  // Stage 2 propellant tanks: 4 × smaller spheres (8 m radius each)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const cx = Math.cos(a) * 12, cy = Math.sin(a) * 12;
    const tank2 = new THREE.Mesh(new THREE.SphereGeometry(8, 32, 16), gold);
    tank2.position.set(cx, cy, spineStart + spineLen * 0.55); g.add(tank2);
    // Tank band
    const band2 = new THREE.Mesh(new THREE.TorusGeometry(8.1, 0.35, 8, 32), steel);
    band2.position.set(cx, cy, spineStart + spineLen * 0.55); g.add(band2);
    // Struts
    const strut2 = cyl(0.7, 0.7, 12, dark, 6);
    strut2.rotation.z = a + Math.PI / 2;
    strut2.position.set(Math.cos(a) * 6, Math.sin(a) * 6, spineStart + spineLen * 0.55);
    g.add(strut2);
    // Feed lines
    const fp = [
      new THREE.Vector3(cx, cy, spineStart + spineLen * 0.55 - 6),
      new THREE.Vector3(cx * 0.4, cy * 0.4, spineStart + 5),
      new THREE.Vector3(0, 0, spineStart),
    ];
    const fc = new THREE.CatmullRomCurve3(fp);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(fc, 12, 0.45, 6, false), dark));
  }

  // ========== PAYLOAD SECTION (front) ==========
  // Transition cone from truss to payload bay
  g.add(along(cyl(spineR + 1, 9, 8, dark), spineStart + spineLen + 4));
  // Payload/avionics bay — cylindrical with equipment panels
  g.add(along(cyl(9, 9, 18, gold), spineStart + spineLen + 17));
  // Equipment panel detail bands
  for (const dz of [10, 14, 18]) {
    g.add(along(cyl(9.3, 9.3, 0.5, dark, 48), spineStart + spineLen + dz));
  }
  // Small communications antenna dish (secondary, forward-facing)
  const antennaDish = new THREE.Mesh(
    new THREE.SphereGeometry(4, 32, 16, 0, Math.PI * 2, 0, Math.PI / 4), steel);
  antennaDish.rotation.x = Math.PI / 2;
  antennaDish.position.z = spineStart + spineLen + 27; g.add(antennaDish);
  // Antenna feed
  g.add(along(cyl(0.3, 0.3, 5, dark, 6), spineStart + spineLen + 29));

  // Beryllium erosion shield — 32 m diameter, with support ring
  const shieldZ = spineStart + spineLen + 33;
  const shield = along(cyl(16, 16, 0.7, steel, 96), shieldZ); g.add(shield);
  // Shield rim reinforcement
  const shieldRim = new THREE.Mesh(new THREE.TorusGeometry(16, 0.5, 8, 96), molyb);
  shieldRim.position.z = shieldZ; g.add(shieldRim);
  // Shield support struts from payload bay
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sx = Math.cos(a) * 12, sy = Math.sin(a) * 12;
    const pts = [
      new THREE.Vector3(Math.cos(a) * 9, Math.sin(a) * 9, shieldZ - 8),
      new THREE.Vector3(sx, sy, shieldZ),
    ];
    const bg = new THREE.BufferGeometry().setFromPoints(pts);
    g.add(new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0x8a8e95 })));
  }

  // ========== RADIATOR PANELS (heat rejection from the reactors) ==========
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 18, 32), radiator);
    panel.position.set(Math.cos(a) * 18, Math.sin(a) * 18, spineStart + spineLen * 0.25);
    panel.rotation.z = a; g.add(panel);
  }

  g.userData.exhaust = { z: -90, radius: 22, length: 900, color: [0.75, 0.6, 1.0] };
  g.userData.length = 190;
  return g;
}

// ---- Project Orion: 4,000-ton Interplanetary Exploration Starship (General Atomics concept)
// Heavy pusher plate with ablative coating, 6 two-stage telescoping shock-absorber pistons,
// central pulse-unit ejector barrel, burnished metallic bronze propulsion & primary shock housing
// with dark carbon-moly & gold striping bands, two tiers of gold MLI pulse-unit magazines with copper caps,
// middle cluster of spherical gold volatile/coolant tanks, faceted titanium command module with
// copper-collared observation cupola & docking ports, and a forward docked titanium space-plane lander.
function orion() {
  const g = new THREE.Group();
  const steel = M.steel(), dark = M.dark();

  // Cohesive metallic palette: warm bronze, gleaming gold foil MLI, polished copper, and titanium
  const bronze = new THREE.MeshStandardMaterial({ color: 0x9b5424, metalness: 0.88, roughness: 0.32 }); // burnished bronze/copper-brown
  const darkBronze = new THREE.MeshStandardMaterial({ color: 0x6e3816, metalness: 0.85, roughness: 0.38 }); // deep bronze
  const copper = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.92, roughness: 0.28 }); // polished copper
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a038, metalness: 0.95, roughness: 0.28 });  // brilliant gold
  const foil = new THREE.MeshStandardMaterial({ color: 0xc8982a, metalness: 0.92, roughness: 0.42 });  // gold thermal MLI foil
  const titanium = new THREE.MeshStandardMaterial({ color: 0xb4bac4, metalness: 0.92, roughness: 0.28 }); // brushed aerospace titanium
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x22252c, metalness: 0.85, roughness: 0.45 }); // dark carbon-molybdenum alloy
  const ablative = new THREE.MeshStandardMaterial({ color: 0x181a1e, metalness: 0.5, roughness: 0.85 }); // carbon-carbon ablative heat shield
  const shuttleTile = new THREE.MeshStandardMaterial({ color: 0x16181c, metalness: 0.35, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x112233, metalness: 0.9, roughness: 0.1 });

  // ========== 1. PUSHER PLATE (z = -31.5) ==========
  const plateZ = -31.5;
  // Main brushed titanium disk
  const plate = along(cyl(10.5, 10.5, 2.2, titanium, 96), plateZ);
  g.add(plate);
  // Heavy rear ablative spray coating / graphite plate facing detonation
  const abPlate = along(cyl(10.2, 10.2, 0.4, ablative, 96), plateZ - 1.2);
  g.add(abPlate);
  // Polished copper/bronze beveled rim
  const plateRim = new THREE.Mesh(new THREE.TorusGeometry(10.5, 0.4, 12, 96), copper);
  plateRim.position.z = plateZ;
  g.add(plateRim);
  // Central pulse unit ejection aperture
  g.add(along(cyl(1.4, 1.4, 2.6, darkMetal, 32), plateZ));

  // ========== 2. SHOCK ABSORBERS & PISTONS (z = -30 to -16) ==========
  // 6 radial two-stage telescoping shock absorbers
  const pistonR = 6.8;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const px = Math.cos(a) * pistonR, py = Math.sin(a) * pistonR;
    // Outer sleeve cylinder extending forward from plate to engine cone
    const sleeve = along(cyl(0.85, 0.85, 9, darkMetal, 16), -20);
    sleeve.position.set(px, py, -20);
    g.add(sleeve);
    // Inner polished steel piston extending from pusher plate into sleeve
    const rod = along(cyl(0.55, 0.55, 12, steel, 16), -25);
    rod.position.set(px, py, -25);
    g.add(rod);
    // Piston mounting foot on plate
    const foot = along(cyl(1.1, 1.1, 0.6, copper, 16), plateZ + 1.2);
    foot.position.set(px, py, plateZ + 1.2);
    g.add(foot);
  }
  // Central pulse-unit ejector launch tube / barrel
  g.add(along(cyl(1.2, 1.2, 15, bronze, 24), -23));

  // ========== 3. PRIMARY SHOCK HOUSING (BRONZE SECTION) (z = -17 to +3) ==========
  // Aft flared cone
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 4.2, 6, 48), bronze);
  cone.rotation.x = Math.PI / 2;
  cone.position.z = -14;
  g.add(cone);
  // 6 structural ribs / stiffener fins on flared cone
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 6), darkBronze);
    rib.position.set(Math.cos(a) * 5.7, Math.sin(a) * 5.7, -14);
    rib.rotation.z = a;
    g.add(rib);
  }

  // Main burnished metallic bronze cylinder
  const cylLen = 10;
  const cylZ = -6;
  g.add(along(cyl(7.2, 7.2, cylLen, bronze, 64), cylZ));
  // Copper pinstripe ring near aft
  g.add(along(cyl(7.26, 7.26, 0.4, copper, 64), -10.5));
  // Thick dark carbon-moly band flanked by gleaming gold rings
  g.add(along(cyl(7.26, 7.26, 2.0, darkMetal, 64), -4.5));
  g.add(along(cyl(7.28, 7.28, 0.35, gold, 64), -5.6));
  g.add(along(cyl(7.28, 7.28, 0.35, gold, 64), -3.4));
  // Access hatch plate on side
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 2.4), darkMetal);
  hatch.position.set(7.25, 0, -6.5);
  g.add(hatch);

  // Forward transition collar: titanium cone tapering to the spine with copper fluted rings
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 7.2, 4, 48), titanium);
  collar.rotation.x = Math.PI / 2;
  collar.position.z = 1.0;
  g.add(collar);
  // Fluted ring details on collar
  for (const cz of [-0.2, 0.8, 1.8]) {
    g.add(along(cyl(7.2 - (cz + 1) * 0.75 + 0.1, 7.2 - (cz + 1) * 0.75 + 0.1, 0.25, copper, 48), cz));
  }

  // ========== 4. CENTRAL SPINE CORE (z = +3 to +34) ==========
  g.add(along(cyl(3.8, 3.8, 32, darkMetal, 32), 18));

  // ========== 5. AFT MAGAZINE TIER (6 GOLD FOIL CANISTERS) (z = +3.5 to +15.5) ==========
  const mag1R = 6.0;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const mx = Math.cos(a) * mag1R, my = Math.sin(a) * mag1R;
    const mz = 9.5;
    // Gold thermal MLI canister body (length 11 m, radius 1.8 m)
    const can = along(cyl(1.8, 1.8, 11, foil, 32), mz);
    can.position.set(mx, my, mz);
    g.add(can);
    // Polished copper endcaps on both ends
    for (const dz of [-5.5, 5.5]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), copper);
      cap.rotation.x = dz > 0 ? -Math.PI / 2 : Math.PI / 2;
      cap.position.set(mx, my, mz + dz);
      g.add(cap);
    }
    // Copper circumferential stripes near each end
    for (const dz of [-4.2, 4.2]) {
      const stripe = along(cyl(1.84, 1.84, 0.6, copper, 32), mz + dz);
      stripe.position.set(mx, my, mz + dz);
      g.add(stripe);
    }
    // Mounting saddle brackets to spine
    for (const dz of [-3, 3]) {
      const saddle = cyl(0.4, 0.4, 2.6, darkMetal, 8);
      saddle.rotation.z = a + Math.PI / 2;
      saddle.position.set(Math.cos(a) * (mag1R - 1.2), Math.sin(a) * (mag1R - 1.2), mz + dz);
      g.add(saddle);
    }
  }

  // ========== 6. SPHERICAL GOLD VOLATILE / COOLANT TANKS (z = +16.0) ==========
  // 6 gleaming gold spheres nestled in the valleys between the magazines
  const sphereR = 5.8;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const sx = Math.cos(a) * sphereR, sy = Math.sin(a) * sphereR;
    const sz = 16.0;
    const sp = new THREE.Mesh(new THREE.SphereGeometry(2.3, 32, 16), gold);
    sp.position.set(sx, sy, sz);
    g.add(sp);
    // Copper equatorial seam ring
    const seam = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.1, 8, 32), copper);
    seam.position.set(sx, sy, sz);
    g.add(seam);
  }

  // ========== 7. COMMAND & AVIONICS MODULE (z = +17 to +23) ==========
  const cmdZ = 20.0;
  // Faceted central titanium command body
  g.add(along(cyl(5.6, 5.6, 6, titanium, 8), cmdZ)); // octagonal cylinder
  // Observation cupola / docking port with copper collar
  const cupolaHousing = along(cyl(1.8, 1.8, 2.2, titanium, 24), cmdZ);
  cupolaHousing.position.set(0, 5.6, cmdZ);
  cupolaHousing.rotation.z = Math.PI / 2;
  g.add(cupolaHousing);
  // Polished copper collar ring
  const cupolaRing = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.25, 8, 24), copper);
  cupolaRing.rotation.y = Math.PI / 2;
  cupolaRing.position.set(0, 6.7, cmdZ);
  g.add(cupolaRing);
  // Dark observation glass
  const cupolaGlass = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  cupolaGlass.rotation.z = -Math.PI / 2;
  cupolaGlass.position.set(0, 6.7, cmdZ);
  g.add(cupolaGlass);

  // Lateral docking hatches / square airlock blocks on left, right, and bottom
  for (const a of [-Math.PI / 2, 0, Math.PI]) {
    const hx = Math.cos(a) * 5.6, hy = Math.sin(a) * 5.6;
    const hBox = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 2.4), titanium);
    hBox.position.set(hx, hy, cmdZ);
    hBox.rotation.z = a;
    g.add(hBox);
    // Copper outline hatch ring
    const hRing = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 6, 16), copper);
    hRing.rotation.y = Math.PI / 2;
    hRing.position.set(Math.cos(a) * 6.45, Math.sin(a) * 6.45, cmdZ);
    g.add(hRing);
  }

  // ========== 8. FORWARD MAGAZINE TIER (6 GOLD FOIL CANISTERS) (z = +24 to +34) ==========
  const mag2R = 5.2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const mx = Math.cos(a) * mag2R, my = Math.sin(a) * mag2R;
    const mz = 29.0;
    // Gold thermal MLI canister body (length 9.5 m, radius 1.55 m)
    const can = along(cyl(1.55, 1.55, 9.5, foil, 32), mz);
    can.position.set(mx, my, mz);
    g.add(can);
    // Copper endcaps
    for (const dz of [-4.75, 4.75]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), copper);
      cap.rotation.x = dz > 0 ? -Math.PI / 2 : Math.PI / 2;
      cap.position.set(mx, my, mz + dz);
      g.add(cap);
    }
    // Copper circumferential stripes
    for (const dz of [-3.6, 3.6]) {
      const stripe = along(cyl(1.58, 1.58, 0.5, copper, 32), mz + dz);
      stripe.position.set(mx, my, mz + dz);
      g.add(stripe);
    }
    // Dark carbon alignment markings
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 1.4), darkMetal);
    mark.position.set(Math.cos(a) * (mag2R + 1.56), Math.sin(a) * (mag2R + 1.56), mz);
    mark.rotation.z = a;
    g.add(mark);
  }

  // ========== 9. FORWARD NOSE CONE (z = +34 to +38) ==========
  const noseCone = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 4.6, 4, 32), titanium);
  noseCone.rotation.x = Math.PI / 2;
  noseCone.position.z = 36.0;
  g.add(noseCone);
  // Copper docking collar ring
  g.add(along(cyl(2.5, 2.5, 0.6, copper, 32), 38.0));

  // ========== 10. DOCKED TITANIUM SPACE-PLANE / SHUTTLE LANDER (z = +38 to +47) ==========
  const shutGroup = new THREE.Group();
  shutGroup.position.set(0, 0, 38.5);

  // Shuttle fuselage: brushed titanium lifting body
  const fusLen = 8.5;
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.6, fusLen, 16), titanium);
  fus.rotation.x = Math.PI / 2;
  fus.position.z = fusLen / 2;
  fus.scale.set(1.4, 0.85, 1.0);
  shutGroup.add(fus);

  // Black thermal protection underside (heat shield tiles)
  const tileUnder = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 8.0), shuttleTile);
  tileUnder.position.set(0, -0.72, 4.2);
  shutGroup.add(tileUnder);

  // Black nose cap
  const noseCap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), shuttleTile);
  noseCap.position.z = fusLen;
  shutGroup.add(noseCap);

  // Cockpit canopy windows
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 1.6), glass);
  canopy.position.set(0, 0.65, 6.8);
  canopy.rotation.x = -0.3;
  shutGroup.add(canopy);

  // Cropped delta wings with copper leading-edge accent
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 6.0);
  wingShape.lineTo(3.2, 3.5);
  wingShape.lineTo(3.0, 1.0);
  wingShape.lineTo(0, 0.5);
  wingShape.lineTo(-3.0, 1.0);
  wingShape.lineTo(-3.2, 3.5);
  wingShape.closePath();
  const wings = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.18, bevelEnabled: false }), titanium);
  wings.rotation.x = Math.PI / 2;
  wings.position.set(0, -0.2, 0.5);
  shutGroup.add(wings);

  // Twin canted vertical stabilizers / rudder fins
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 2.0), titanium);
    fin.position.set(s * 1.5, 0.8, 1.5);
    fin.rotation.z = -s * 0.25;
    fin.rotation.x = -0.15;
    shutGroup.add(fin);
  }

  // OMS engine pods at rear with bronze bells
  for (const s of [-1, 1]) {
    const pod = along(cyl(0.35, 0.45, 1.5, bronze, 12), 0.8);
    pod.position.set(s * 0.9, 0.5, 0.8);
    shutGroup.add(pod);
  }

  g.add(shutGroup);

  g.userData.pulse = true;
  g.userData.length = 78;
  return g;
}

// ---- Breakthrough Starshot: 4.1 m dielectric light sail (iridescent multilayer), 1 g StarChip
function starshot() {
  const g = new THREE.Group();
  const sailMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8ecf4, metalness: 0.25, roughness: 0.12, transmission: 0.35, thickness: 0.001, iridescence: 1, iridescenceIOR: 2.0,
    iridescenceThicknessRange: [200, 900], side: THREE.DoubleSide, envMapIntensity: 2.5, sheen: 0.8, sheenColor: 0x9a8cff,
    transparent: true, opacity: 0.92,
  });
  const sail = new THREE.Mesh(new THREE.CircleGeometry(2.05, 128), sailMat);
  g.add(sail); // faces ±Z, so the laser (from behind) hits it square-on
  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.002), new THREE.MeshStandardMaterial({ color: 0x223355, metalness: 0.5, roughness: 0.3, emissive: 0x112244 }));
  chip.position.z = 0.6; g.add(chip);
  const tetherMat = new THREE.LineBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.6 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(a) * 2.0, Math.sin(a) * 2.0, 0), new THREE.Vector3(0, 0, 0.6)]);
    g.add(new THREE.Line(geo, tetherMat));
  }
  g.userData.length = 4.1;
  g.userData.laser = true;
  return g;
}

// ---- Antimatter beam-core photon ship (340 m):
// Conical relativistic Whipple deflector shield, forward sensor array, rotating gravity habitat centrifuge,
// 4-longeroid open-lattice spine truss, cryogenic antimatter Penning traps & LH2 tanks,
// expansive gigawatt radiator arrays, annihilation reactor core, and a multi-coil superconducting
// magnetic nozzle directing relativistic charged pions.
function antimatter() {
  const g = new THREE.Group();
  const steel = M.steel(), dark = M.dark(), white = M.white(), copper = M.copper(), foil = M.foil();

  // Specialized materials for high-energy antimatter starship components
  const shieldMat = new THREE.MeshStandardMaterial({ color: 0x8a929e, metalness: 0.95, roughness: 0.25 });
  const carbonDark = new THREE.MeshStandardMaterial({ color: 0x181a1e, metalness: 0.7, roughness: 0.6 });
  const radMat = new THREE.MeshStandardMaterial({
    color: 0x161820, metalness: 0.4, roughness: 0.45,
    emissive: 0x2b0c03, emissiveIntensity: 0.85,
  });
  const coilMat = new THREE.MeshStandardMaterial({
    color: 0xc87d40, metalness: 0.95, roughness: 0.25,
    emissive: 0x3d1a00, emissiveIntensity: 0.4,
  });

  // ========== 1. FORWARD RELATIVISTIC DEFLECTOR SHIELD & SENSOR SPIKE (z = +140 to +172) ==========
  // Multi-layered parabolic Whipple shield to vaporize interstellar gas and micro-dust at 0.9c
  const shieldZ = 145;
  const shieldProf = [
    [0.1, 26], [4.5, 20], [12, 12], [22, 2], [30, -8], [29, -10], [0, -10],
  ].map(([r, z]) => new THREE.Vector2(r, z));
  const shieldMesh = new THREE.Mesh(new THREE.LatheGeometry(shieldProf, 64), shieldMat);
  shieldMesh.rotation.x = Math.PI / 2;
  shieldMesh.position.z = shieldZ;
  g.add(shieldMesh);

  // Forward particle-sweeper spike / laser emitter needle
  g.add(along(cyl(0.8, 0.2, 28, steel, 16), shieldZ + 28));
  g.add(along(cyl(1.8, 1.8, 3, dark, 24), shieldZ + 15));

  // Shield rim reinforcement & deflector field coils
  const shieldRim = new THREE.Mesh(new THREE.TorusGeometry(30, 0.9, 12, 72), copper);
  shieldRim.position.z = shieldZ - 9;
  g.add(shieldRim);

  // Shadow-cone shield (secondary radiation/debris absorber)
  g.add(along(cyl(16, 22, 10, carbonDark, 32), shieldZ - 16));

  // Forward avionics and optical communications dish array behind shield
  const dish = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3), steel);
  dish.rotation.x = -Math.PI / 2;
  dish.position.set(0, 8, shieldZ - 14);
  g.add(dish);
  const dish2 = dish.clone();
  dish2.position.set(0, -8, shieldZ - 14);
  dish2.scale.setScalar(0.7);
  g.add(dish2);

  // ========== 2. ROTATING HABITAT CENTRIFUGE & HUB (z = +105 to +125) ==========
  // Non-rotating central hub
  g.add(along(cyl(7, 7, 30, white, 32), 115));
  g.add(along(cyl(7.8, 7.8, 4, dark, 32), 115));

  // Rotating centrifuge assembly (saved to userData.spin)
  const habGroup = new THREE.Group();
  habGroup.position.z = 115;

  // Primary torus ring (diameter 56 m)
  const habRing = new THREE.Mesh(new THREE.TorusGeometry(28, 3.2, 24, 96), white);
  habGroup.add(habRing);
  const habStrip = new THREE.Mesh(new THREE.TorusGeometry(28, 3.3, 8, 96), dark);
  habStrip.scale.z = 0.25;
  habGroup.add(habStrip);

  // 6 structural spokes connecting hub to torus
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spoke = cyl(0.9, 0.9, 28, carbonDark, 12);
    spoke.rotation.z = a + Math.PI / 2;
    spoke.position.set(Math.cos(a) * 14, Math.sin(a) * 14, 0);
    habGroup.add(spoke);

    // Habitation module pods on alternating spokes
    if (i % 2 === 0) {
      const pod = along(cyl(2.8, 2.8, 10, white, 16), 0);
      pod.rotation.z = a;
      pod.position.set(Math.cos(a) * 20, Math.sin(a) * 20, 0);
      habGroup.add(pod);
    }
  }
  g.add(habGroup);
  g.userData.spin = habGroup;

  // Counter-rotating balancing ring
  const balanceRing = new THREE.Mesh(new THREE.TorusGeometry(12, 1.1, 16, 64), carbonDark);
  balanceRing.position.z = 103;
  g.add(balanceRing);

  // ========== 3. CENTRAL LATTICE TRUSS SPINE (z = -90 to +100) ==========
  // Four-chord box truss spanning the length of the ship
  const trussLen = 190;
  const trussZ0 = -90;
  const trussR = 4.8;
  const chords = [
    [trussR, trussR],
    [-trussR, trussR],
    [-trussR, -trussR],
    [trussR, -trussR],
  ];
  // 4 main longitudinal longerons
  for (const [cx, cy] of chords) {
    const lon = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, trussLen, 8), carbonDark);
    lon.rotation.x = Math.PI / 2;
    lon.position.set(cx, cy, trussZ0 + trussLen / 2);
    g.add(lon);
  }

  // Cross bulkheads and diagonal X-bracing along the truss
  const nBays = 16;
  const bayLen = trussLen / nBays;
  for (let b = 0; b <= nBays; b++) {
    const bz = trussZ0 + b * bayLen;
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = chords[i];
      const [x2, y2] = chords[(i + 1) % 4];
      const pts = [new THREE.Vector3(x1, y1, bz), new THREE.Vector3(x2, y2, bz)];
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x444955 })));
    }
    if (b < nBays) {
      const bzNext = bz + bayLen;
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = chords[i];
        const [x2, y2] = chords[(i + 1) % 4];
        const pts1 = [new THREE.Vector3(x1, y1, bz), new THREE.Vector3(x2, y2, bzNext)];
        const pts2 = [new THREE.Vector3(x2, y2, bz), new THREE.Vector3(x1, y1, bzNext)];
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts1), new THREE.LineBasicMaterial({ color: 0x333842 })));
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2), new THREE.LineBasicMaterial({ color: 0x333842 })));
      }
    }
  }

  // Central power & cryogenic conduit core through the middle
  g.add(along(cyl(1.8, 1.8, trussLen + 10, dark, 16), trussZ0 + trussLen / 2));

  // ========== 4. ANTIMATTER CONTAINMENT (PENNING TRAP BOTTLES) (z = +50 to +85) ==========
  // 6 magnetic Penning trap pods mounted symmetrically inside the forward truss bay
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const px = Math.cos(a) * 7.5, py = Math.sin(a) * 7.5;
    const pz = 68;
    // Vacuum Dewar flask (insulated with gold MLI)
    const trap = along(cyl(2.2, 2.2, 14, foil, 24), pz);
    trap.position.set(px, py, pz);
    g.add(trap);
    // Superconducting magnetic containment rings
    for (const dz of [-4, 0, 4]) {
      const tring = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.25, 8, 24), copper);
      tring.position.set(px, py, pz + dz);
      g.add(tring);
    }
    // Girdle struts to truss
    const gstrut = cyl(0.3, 0.3, 3, carbonDark, 6);
    gstrut.rotation.z = a + Math.PI / 2;
    gstrut.position.set(px * 0.75, py * 0.75, pz);
    g.add(gstrut);
  }

  // ========== 5. LIQUID HYDROGEN PROPELLANT TANKS (z = +10 to +45) ==========
  // 4 large cylindrical cryogenic hydrogen tanks with hemispherical caps
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const tx = Math.cos(a) * 11, ty = Math.sin(a) * 11;
    const tz = 28;
    // Tank body
    const tMesh = along(cyl(4.2, 4.2, 24, white, 32), tz);
    tMesh.position.set(tx, ty, tz);
    g.add(tMesh);
    // Tank endcaps
    const cap1 = new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), white);
    cap1.rotation.x = -Math.PI / 2;
    cap1.position.set(tx, ty, tz + 12);
    g.add(cap1);
    const cap2 = new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), white);
    cap2.rotation.x = Math.PI / 2;
    cap2.position.set(tx, ty, tz - 12);
    g.add(cap2);
    // Support rings & feed piping
    const tBand = new THREE.Mesh(new THREE.TorusGeometry(4.35, 0.3, 8, 32), steel);
    tBand.position.set(tx, ty, tz);
    g.add(tBand);
  }

  // ========== 6. GIGAWATT THERMAL RADIATOR WINGS (z = -20 to -85) ==========
  // 4 extensive radiator wings mounted in a cross pattern with stepped chevron panels
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    // Main structural radiator spar
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 48, 8), carbonDark);
    spar.rotation.z = a + Math.PI / 2;
    spar.position.set(Math.cos(a) * 28, Math.sin(a) * 28, -50);
    g.add(spar);

    // Multi-segment high-temperature radiator panels with heat pipes
    const pWidths = [18, 28, 36, 42];
    const pLengths = [18, 22, 24, 20];
    const pZ = [-30, -46, -64, -80];
    for (let k = 0; k < 4; k++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.35, pWidths[k], pLengths[k]), radMat);
      panel.position.set(Math.cos(a) * (trussR + pWidths[k] / 2 + 1), Math.sin(a) * (trussR + pWidths[k] / 2 + 1), pZ[k]);
      panel.rotation.z = a;
      g.add(panel);

      // Coolant supply and return manifolds along panels
      const pipe = along(cyl(0.3, 0.3, pLengths[k], steel, 6), pZ[k]);
      pipe.position.set(Math.cos(a) * (trussR + pWidths[k] + 0.8), Math.sin(a) * (trussR + pWidths[k] + 0.8), pZ[k]);
      g.add(pipe);
    }
  }

  // ========== 7. ANNIHILATION REACTION CHAMBER (z = -90 to -115) ==========
  // Heavy spherical pinch chamber encased in radiation shadow shield
  const chamberZ = -100;
  const chamber = new THREE.Mesh(new THREE.SphereGeometry(9, 48, 24), carbonDark);
  chamber.position.z = chamberZ;
  g.add(chamber);
  // Heavy confinement band
  const chBand = new THREE.Mesh(new THREE.TorusGeometry(9.2, 1.2, 12, 48), coilMat);
  chBand.position.z = chamberZ;
  g.add(chBand);
  // Magnetic injector ports (matter/antimatter feed pipes entering chamber)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const inj = cyl(0.9, 0.9, 8, steel, 8);
    inj.rotation.z = a + Math.PI / 2;
    inj.position.set(Math.cos(a) * 7, Math.sin(a) * 7, chamberZ + 4);
    g.add(inj);
  }

  // ========== 8. RELATIVISTIC PION MAGNETIC NOZZLE (z = -115 to -180) ==========
  // Long, tapering conical array of 10 superconducting magnetic coils focusing charged pions
  const nCoils = 10;
  const nozzleZ0 = -112;
  const nozzleZ1 = -178;
  const nozzleR0 = 7.5;
  const nozzleR1 = 26;

  for (let i = 0; i < nCoils; i++) {
    const t = i / (nCoils - 1);
    const cz = nozzleZ0 + (nozzleZ1 - nozzleZ0) * t;
    const cr = nozzleR0 + (nozzleR1 - nozzleR0) * Math.pow(t, 1.2);
    const cThickness = 0.8 + t * 0.4;
    // Superconducting coil ring
    const coil = new THREE.Mesh(new THREE.TorusGeometry(cr, cThickness, 12, 64), coilMat);
    coil.position.z = cz;
    g.add(coil);

    // Inner plasma glow guide ring
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(cr - cThickness, 0.3, 8, 64), copper);
    innerRing.position.z = cz;
    g.add(innerRing);
  }

  // 6 longitudinal magnetic field guide longerons / structural truss holding the coils
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const z = nozzleZ0 + (nozzleZ1 - nozzleZ0) * t;
      const r = nozzleR0 + (nozzleR1 - nozzleR0) * Math.pow(t, 1.2) + 0.5;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const spar = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.6, 6, false), carbonDark);
    g.add(spar);
  }

  // Reaction mass injection collar at nozzle throat
  g.add(along(cyl(nozzleR0 - 0.5, nozzleR0 - 0.5, 6, dark, 32), nozzleZ0 + 3));

  g.userData.exhaust = { z: -182, radius: 28, length: 1600, color: [0.55, 0.75, 1.0] };
  g.userData.length = 340;
  return g;
}

// ---- Alcubierre warp ship, after NASA's IXS Enterprise concept (Harold White & Mark Rademaker, 2014):
// a slender 120 m hull inside two flat rings that would shape the bubble; the rings glow while it is up
function warpShip() {
  const g = new THREE.Group();
  const white = M.white(), dark = M.dark(), steel = M.steel();
  // hull: a lathe profile, pointed bow (+Z) to a squared stern
  const prof = [[0, 62], [2.2, 58], [4.6, 50], [6.4, 38], [7.2, 20], [7.2, -30], [6.6, -46], [5.6, -55], [0, -55]].map(([r, z]) => new THREE.Vector2(r, z));
  const hull = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), white);
  hull.rotation.x = Math.PI / 2; g.add(hull);
  g.add(along(cyl(7.4, 7.4, 6, dark), 22));          // bridge band
  g.add(along(cyl(5.8, 4.6, 8, steel), -58));        // conventional engine bell for in-system moves
  // the two rings: flat bands, perpendicular to the hull, on four spokes each
  const glow = new THREE.MeshStandardMaterial({ color: 0x3a4a66, metalness: 0.7, roughness: 0.35, emissive: 0x4fa8ff, emissiveIntensity: 0 });
  const rings = [];
  for (const [z, r] of [[18, 46], [-26, 46]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 1.4, 16, 160), glow);
    ring.scale.z = 3.2; // flattened into a band along the hull
    ring.position.z = z; g.add(ring); rings.push(ring);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const s = new THREE.Mesh(new THREE.BoxGeometry(r - 7, 1.2, 3), steel);
      s.position.set(Math.cos(a) * (r + 7) / 2, Math.sin(a) * (r + 7) / 2, z);
      s.rotation.z = a; g.add(s);
    }
  }
  g.userData.rings = glow;
  g.userData.length = 120;
  return g;
}

// ------------------------------------------------------------------------------- engine effects
// Exhaust as a column of soft camera-facing glows: smooth from every angle, hot white at the nozzle,
// fading into the engine's plasma colour downstream.
let GLOW_TEX = null;
function glowTex() {
  if (GLOW_TEX) return GLOW_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  GLOW_TEX = new THREE.CanvasTexture(c);
  return GLOW_TEX;
}

function plume(spec) {
  const g = new THREE.Group();
  const N = 48, base = new THREE.Color(...spec.color);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const col = new THREE.Color(1, 1, 1).lerp(base, Math.min(1, t * 2.2)).multiplyScalar(1.3 * Math.pow(1 - t, 1.8) + 0.03);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.position.z = spec.z - Math.pow(t, 1.3) * spec.length * 0.5;
    s.scale.setScalar(spec.radius * (1.1 + t * 3.2));
    s.userData.k = 1 - t * 0.6;
    g.add(s);
  }
  g.userData.power = 0;
  return g;
}

export class ProbeModel {
  constructor(id) { this.id = id; this.group = new THREE.Group(); this.ready = this.build(); this.flash = 0; }

  async build() {
    let m;
    if (id2glb[this.id]) {
      const { url, length, fix } = id2glb[this.id];
      m = await loadGLB(url, length, fix);
      m.userData.length = length;
    } else m = { orion, daedalus, starshot, antimatter, warp: warpShip }[this.id]();
    this.model = m;
    this.length = m.userData.length;
    this.group.add(m);
    if (m.userData.exhaust) { this.plume = plume(m.userData.exhaust); this.group.add(this.plume); }
    if (m.userData.pulse) {
      this.pulseLight = new THREE.PointLight(0xfff1dd, 0, 400, 1.5);
      this.pulseLight.position.z = -42;
      this.group.add(this.pulseLight);
      this.pulseFlash = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 26, 20), transparent: true, opacity: 0 }));
      this.pulseFlash.position.z = -46;
      this.group.add(this.pulseFlash);
    }
    return this;
  }

  /** thrusting: proper acceleration (m/s²) or 0; t: wall time seconds; warp: sim seconds per real second;
   *  bubble: 0…1, how far the warp bubble is up (the warp ship's rings glow with it) */
  update(accel, t, warp, bubble = 0) {
    const rings = this.model?.userData.rings;
    if (rings) rings.emissiveIntensity += (bubble * (2.2 + 0.3 * Math.sin(t * 5)) - rings.emissiveIntensity) * 0.15;
    if (this.plume) {
      const P = this.plume.userData;
      P.power += ((accel > 0 ? 1 : 0) - P.power) * 0.1;
      this.plume.visible = P.power > 0.01;
      this.plume.children.forEach((sp, i) => { sp.material.opacity = P.power * sp.userData.k * (0.85 + 0.15 * Math.sin(t * 23 + i * 1.7)); });
    }
    if (this.pulseLight) {
      // Orion detonates a pulse unit about once per second; at high time-warp the flashes merge
      const firing = accel > 0;
      const rate = Math.min(warp * 1.0, 30);
      if (firing && Math.random() < rate / 60) this.flash = 1;
      this.flash *= 0.82;
      this.pulseLight.intensity = this.flash * 2e5;
      this.pulseFlash.material.opacity = this.flash;
      this.pulseFlash.scale.setScalar(1 + (1 - this.flash) * 3);
    }
    if (this.model?.userData.spin) this.model.userData.spin.rotation.z = t * 0.21; // ~2 rpm → ~0.1 g at 28 m... shown sped up
  }
}

// NASA 3D Resources models (public domain). `fix` rotates the model so its natural forward is +Z.
const id2glb = {
  voyager: { url: 'models/voyager.glb', length: 13.0, fix: [Math.PI / 2, 0, 0] },
  parker: { url: 'models/parker.glb', length: 3.0, fix: [0, Math.PI, 0] },
};
