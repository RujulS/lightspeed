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

// ---- Alcubierre warp starship — NASA IXS Enterprise (Dr. Harold White & Mark Rademaker, 2014)
// Based on the White-Juday warp field interferometer design:
// 1. Two thick toroidal negative-energy warp rings (fore & aft) with segmented interior field coils and equatorial seams.
// 2. Streamlined aerofoil bridge/pylon wings structurally locking the central hull into both warp rings.
// 3. Sleek forward command module with upper flight deck canopy and needle-like sensor/particle deflector spire.
// 4. Midship service module wrapped in champagne-gold MLI thermal blankets and utility conduit channels.
// 5. Radial cluster of 8 high-pressure cryogenic reactant tanks with structural tension rings and saddles.
// 6. Aft tapering engineering hull with flush radiator panels, RCS thruster quads, and sub-light multi-engine propulsion bells.
// 7. Dynamic warp field glow: inner coil cassettes and emitter conduits pulse with electric blue energy when bubble is up.
function warpShip() {
  const g = new THREE.Group();

  // Aerospace materials
  const hullWhite = new THREE.MeshStandardMaterial({ color: 0xdee4ea, metalness: 0.28, roughness: 0.38 });
  const hullDark = new THREE.MeshStandardMaterial({ color: 0x22262e, metalness: 0.65, roughness: 0.45 });
  const titanium = new THREE.MeshStandardMaterial({ color: 0xa4acb8, metalness: 0.9, roughness: 0.26 });
  const goldMLI = new THREE.MeshStandardMaterial({ color: 0xb8924a, metalness: 0.85, roughness: 0.42 });
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xd6dce2, metalness: 0.35, roughness: 0.32 });
  const tankStrap = new THREE.MeshStandardMaterial({ color: 0x68707c, metalness: 0.88, roughness: 0.25 });
  const engineMat = new THREE.MeshStandardMaterial({ color: 0x24272e, metalness: 0.85, roughness: 0.38 });
  const engineNozzle = new THREE.MeshStandardMaterial({ color: 0x6e7684, metalness: 0.92, roughness: 0.22 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1218, metalness: 0.95, roughness: 0.08 });
  const glow = new THREE.MeshStandardMaterial({
    color: 0x1b3b5a, metalness: 0.5, roughness: 0.35,
    emissive: 0x3898ff, emissiveIntensity: 0.0,
  });

  // ========== 1. TWO THICK TOROIDAL WARP RINGS (z = +16.0 & z = -22.0) ==========
  const ringZPositions = [16.0, -22.0];
  const ringR = 30.0;
  const tubeR = 4.2;

  for (const rz of ringZPositions) {
    const ringGroup = new THREE.Group();
    ringGroup.position.z = rz;

    // Main thick aerodynamic torus ring body
    const mainTorus = new THREE.Mesh(new THREE.TorusGeometry(ringR, tubeR, 32, 96), hullWhite);
    ringGroup.add(mainTorus);

    // Dark equatorial panel separation seam around outer perimeter
    const seam = new THREE.Mesh(new THREE.TorusGeometry(ringR + tubeR + 0.02, 0.12, 8, 96), hullDark);
    ringGroup.add(seam);

    // Inner rim conduit channel
    const innerRim = new THREE.Mesh(new THREE.TorusGeometry(ringR - tubeR + 0.3, 0.4, 12, 96), hullDark);
    ringGroup.add(innerRim);

    // Segmented negative-energy warp field coils (24 units lining inner perimeter)
    const nCoils = 24;
    const innerR = ringR - tubeR + 0.6; // ~26.4
    for (let i = 0; i < nCoils; i++) {
      const a = (i / nCoils) * Math.PI * 2;
      // Structural bracket/heatsink
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.85, 4.4), titanium);
      bracket.position.set(Math.cos(a) * innerR, Math.sin(a) * innerR, 0);
      bracket.rotation.z = a;
      ringGroup.add(bracket);

      // Inner emissive warp emitter cassette pad
      const pad = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 3.6), glow);
      pad.position.set(Math.cos(a) * (innerR + 0.4), Math.sin(a) * (innerR + 0.4), 0);
      pad.rotation.z = a;
      ringGroup.add(pad);

      // Flanking power conduit clamps
      for (const dz of [-1.6, 1.6]) {
        const clamp = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.95, 0.35), hullDark);
        clamp.position.set(Math.cos(a) * innerR, Math.sin(a) * innerR, dz);
        clamp.rotation.z = a;
        ringGroup.add(clamp);
      }
    }

    g.add(ringGroup);
  }

  // ========== 2. PYLONS / WING AEROFOILS BRIDGING HULL & RINGS ==========
  // Fore Ring Horizontal Pylons (z = +16.0)
  for (const s of [-1, 1]) {
    const pylonLen = 22.0;
    const pylonX = s * (4.2 + pylonLen / 2);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(pylonLen, 1.4, 7.5), hullWhite);
    pylon.position.set(pylonX, 0, 16.0);
    g.add(pylon);

    // Tapered leading/trailing edge trim
    const leadEdge = new THREE.Mesh(new THREE.BoxGeometry(pylonLen, 0.45, 1.0), hullDark);
    leadEdge.position.set(pylonX, 0, 16.0 + 3.8);
    g.add(leadEdge);

    // Root fairings where pylon blends into ring inner rim
    const fairing = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4.5, 3.5, 16), hullWhite);
    fairing.rotation.z = s * Math.PI / 2;
    fairing.position.set(s * 25.5, 0, 16.0);
    g.add(fairing);
  }

  // Aft Ring Horizontal & Diagonal Bracing Pylons (z = -22.0)
  for (const s of [-1, 1]) {
    const pylonLen = 22.2;
    const pylonX = s * (4.0 + pylonLen / 2);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(pylonLen, 1.5, 6.8), hullWhite);
    pylon.position.set(pylonX, 0, -22.0);
    g.add(pylon);

    const leadEdge = new THREE.Mesh(new THREE.BoxGeometry(pylonLen, 0.45, 0.9), hullDark);
    leadEdge.position.set(pylonX, 0, -22.0 + 3.5);
    g.add(leadEdge);

    const fairing = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 4.2, 3.5, 16), hullWhite);
    fairing.rotation.z = s * Math.PI / 2;
    fairing.position.set(s * 25.5, 0, -22.0);
    g.add(fairing);

    // Vertical structural tension struts inside the aft ring
    for (const vy of [-1, 1]) {
      const strutLen = 21.0;
      const strutY = vy * (4.2 + strutLen / 2);
      const vStrut = cyl(0.8, 0.8, strutLen, titanium, 16);
      vStrut.position.set(0, strutY, -22.0);
      g.add(vStrut);
    }
  }

  // ========== 3. FORWARD COMMAND MODULE & BRIDGE DECK (z = +12 to +38) ==========
  const bowProf = [
    [0.1, 38], [1.8, 37], [3.2, 34], [4.4, 28], [4.8, 20], [4.6, 12]
  ].map(([r, z]) => new THREE.Vector2(r, z));
  const bowHull = new THREE.Mesh(new THREE.LatheGeometry(bowProf, 48), hullWhite);
  bowHull.rotation.x = Math.PI / 2;
  bowHull.scale.set(1.15, 0.85, 1.0);
  g.add(bowHull);

  // Upper bridge superstructure & cockpit canopy
  const bridgeDeck = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 11, 24), hullWhite);
  bridgeDeck.rotation.x = Math.PI / 2;
  bridgeDeck.position.set(0, 2.4, 26);
  bridgeDeck.scale.set(1.4, 0.65, 1.0);
  g.add(bridgeDeck);

  // Flight deck cockpit windows (dark glass)
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 4.5, 16), glass);
  canopy.rotation.x = Math.PI / 2;
  canopy.position.set(0, 2.7, 29);
  canopy.scale.set(1.35, 0.55, 1.0);
  g.add(canopy);

  // Dorsal sensor spine & comms blister
  const dorsalSpine = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 14), hullDark);
  dorsalSpine.position.set(0, 3.4, 20);
  g.add(dorsalSpine);

  // Ventral sensor blister / chin deflector
  const chinDeflector = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hullDark);
  chinDeflector.rotation.x = Math.PI;
  chinDeflector.position.set(0, -2.4, 28);
  g.add(chinDeflector);

  // ========== 4. FORWARD SENSOR MAST & PARTICLE DEFLECTOR NEEDLE (z = +38 to +66) ==========
  const mastZ0 = 38.0;
  const mastZ1 = 65.0;
  const mastLen = mastZ1 - mastZ0;

  // Central tapering sensor probe needle
  g.add(along(cyl(0.55, 0.12, mastLen, titanium, 24), (mastZ0 + mastZ1) / 2));

  // 4 longitudinal sensor guide rods surrounding the needle
  const rodR = 1.15;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rod = along(cyl(0.08, 0.08, mastLen - 5, titanium, 8), (mastZ0 + mastZ1 - 3) / 2);
    rod.position.set(Math.cos(a) * rodR, Math.sin(a) * rodR, (mastZ0 + mastZ1 - 3) / 2);
    g.add(rod);
  }

  // 3 transverse support spider rings along the needle boom
  for (const sz of [44.0, 52.0, 60.0]) {
    const spider = new THREE.Mesh(new THREE.TorusGeometry(rodR, 0.09, 8, 24), hullDark);
    spider.position.z = sz;
    g.add(spider);
  }

  // Spherical collector node at tip
  const tipSphere = new THREE.Mesh(new THREE.SphereGeometry(0.65, 24, 16), titanium);
  tipSphere.position.z = mastZ1;
  g.add(tipSphere);

  // Forward warp guide emitter tip (glows with warp energy)
  const tipGlow = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), glow);
  tipGlow.position.z = mastZ1 + 0.45;
  g.add(tipGlow);

  // ========== 5. MIDSHIP HABITATION & REACTION MASS TANKS (z = -18 to +12) ==========
  // Habitation & service module (z = +2 to +12)
  const habLen = 10.0;
  const habZ = 7.0;
  // Champagne-gold thermal MLI blanket cylinder
  g.add(along(cyl(4.5, 4.5, habLen, goldMLI, 48), habZ));
  // Titanium end rings & service collar
  g.add(along(cyl(4.58, 4.58, 0.8, titanium, 48), 12.0));
  g.add(along(cyl(4.58, 4.58, 0.8, titanium, 48), 2.0));
  // Longitudinal utility conduit raceways (4 quadrants)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const raceway = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, habLen), hullDark);
    raceway.position.set(Math.cos(a) * 4.6, Math.sin(a) * 4.6, habZ);
    raceway.rotation.z = a;
    g.add(raceway);
  }

  // Central spine core inside tank bay (z = -18 to +2)
  const spineZ = -8.0;
  const spineLen = 20.0;
  g.add(along(cyl(2.6, 2.6, spineLen, hullDark, 32), spineZ));

  // Radial cluster of 8 Cryogenic Reactant / Propellant Tanks
  const nTanks = 8;
  const tankClusterR = 4.3;
  const tankR = 1.45;
  const tankBodyLen = 14.0;
  const tankZ = -8.0;

  for (let i = 0; i < nTanks; i++) {
    const a = (i / nTanks) * Math.PI * 2;
    const tx = Math.cos(a) * tankClusterR;
    const ty = Math.sin(a) * tankClusterR;

    // Tank cylindrical body
    const tBody = along(cyl(tankR, tankR, tankBodyLen, tankMat, 32), tankZ);
    tBody.position.set(tx, ty, tankZ);
    g.add(tBody);

    // Domed hemispherical end caps
    for (const dz of [-tankBodyLen / 2, tankBodyLen / 2]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(tankR, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), tankMat);
      cap.rotation.x = dz > 0 ? -Math.PI / 2 : Math.PI / 2;
      cap.position.set(tx, ty, tankZ + dz);
      g.add(cap);
    }

    // High pressure cryogenic feed line into central spine at front
    const feed = along(cyl(0.18, 0.18, 2.2, titanium, 12), tankZ + tankBodyLen / 2 + 0.8);
    feed.position.set(tx * 0.75, ty * 0.75, tankZ + tankBodyLen / 2 + 0.8);
    g.add(feed);
  }

  // 2 Heavy structural clamping girdles / retention cradles locking all 8 tanks
  for (const gz of [-13.0, -3.0]) {
    // Outer circular girdle ring
    const girdle = new THREE.Mesh(new THREE.TorusGeometry(tankClusterR + tankR + 0.08, 0.35, 12, 48), tankStrap);
    girdle.position.z = gz;
    g.add(girdle);

    // Radial spokes locking girdle to the spine
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.35, tankClusterR + tankR + 0.1, 0.6), titanium);
      spoke.position.set(Math.cos(a) * (tankClusterR / 2), Math.sin(a) * (tankClusterR / 2), gz);
      spoke.rotation.z = a;
      g.add(spoke);
    }
  }

  // ========== 6. AFT ENGINEERING & SUB-LIGHT PROPULSION (z = -18 to -58) ==========
  // Tapering engineering fuselage (z = -18 to -48)
  const engProf = [
    [4.6, -18], [4.6, -24], [4.2, -32], [3.6, -40], [3.0, -48]
  ].map(([r, z]) => new THREE.Vector2(r, z));
  const engHull = new THREE.Mesh(new THREE.LatheGeometry(engProf, 48), hullWhite);
  engHull.rotation.x = Math.PI / 2;
  g.add(engHull);

  // Longitudinal cooling radiator / thermal panels flush with hull
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rad = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.2, 16.0), hullDark);
    rad.position.set(Math.cos(a) * 3.8, Math.sin(a) * 3.8, -34.0);
    rad.rotation.z = a;
    g.add(rad);
  }

  // 4 Reaction Control System (RCS) thruster quads
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const rcsBase = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 1.2), titanium);
    rcsBase.position.set(Math.cos(a) * 4.3, Math.sin(a) * 4.3, -28.0);
    rcsBase.rotation.z = a;
    g.add(rcsBase);

    // Micro nozzles per quad
    for (const nozAng of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      const noz = cyl(0.18, 0.08, 0.45, engineMat, 8);
      noz.position.set(Math.cos(a) * 4.75, Math.sin(a) * 4.75, -28.0);
      noz.rotation.z = a + nozAng;
      g.add(noz);
    }
  }

  // Aft thrust structure bulkhead (z = -48.0)
  g.add(along(cyl(3.05, 3.05, 1.2, hullDark, 32), -48.0));

  // Main central sub-light rocket engine
  const mainNozzle = along(cyl(2.2, 1.2, 5.5, engineMat, 32), -51.5);
  g.add(mainNozzle);
  const mainThroat = along(cyl(2.05, 1.05, 5.2, engineNozzle, 32), -51.5);
  g.add(mainThroat);

  // 4 auxiliary vernier rocket engines arranged radially around main engine
  const vRadius = 2.0;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const vx = Math.cos(a) * vRadius;
    const vy = Math.sin(a) * vRadius;

    const vNoz = along(cyl(0.85, 0.45, 3.8, engineMat, 24), -50.5);
    vNoz.position.set(vx, vy, -50.5);
    g.add(vNoz);

    const vThroat = along(cyl(0.78, 0.38, 3.6, engineNozzle, 24), -50.5);
    vThroat.position.set(vx, vy, -50.5);
    g.add(vThroat);

    // Turbopump feed line to each vernier
    const pipe = along(cyl(0.14, 0.14, 2.8, titanium, 8), -48.8);
    pipe.position.set(vx * 1.25, vy * 1.25, -48.8);
    g.add(pipe);
  }

  // Spherical high-pressure helium pressurant tanks nestled around engine thrust frame
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const sph = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), titanium);
    sph.position.set(Math.cos(a) * 2.2, Math.sin(a) * 2.2, -47.0);
    g.add(sph);
  }

  g.userData.rings = glow;
  g.userData.length = 124;
  return g;
}

// ---- USS Enterprise NCC-1701-A (Constitution-class Refit Starship)
// Starfleet flagship commanded by Captain James T. Kirk.
// Features: Primary saucer section with registration decals and bridge module, impulse engines,
// forward-raked connecting neck with photon torpedo launchers, secondary stardrive hull with
// navigational deflector dish, aft shuttlebay, swept warp pylons, and dual Constitution-refit warp nacelles
// with illuminated inboard warp field coils and forward Bussard ramscoops.
function enterprise() {
  const g = new THREE.Group();
  const ship = new THREE.Group();
  g.add(ship);

  // Materials
  const hullWhite = new THREE.MeshStandardMaterial({ color: 0xedf0f5, metalness: 0.35, roughness: 0.38 }); // Federation aztec pearl-white
  const hullDark = new THREE.MeshStandardMaterial({ color: 0x3d4452, metalness: 0.55, roughness: 0.42 });  // Engineering dark slate
  const deflectorCopper = new THREE.MeshStandardMaterial({ color: 0xc87a2e, metalness: 0.9, roughness: 0.28 }); // Navigational deflector dish
  const warpBlue = new THREE.MeshStandardMaterial({ color: 0x0088ff, emissive: 0x0099ff, emissiveIntensity: 1.8, roughness: 0.2 }); // Inboard warp grilles & deflector core
  const impulseRed = new THREE.MeshStandardMaterial({ color: 0xff3311, emissive: 0xff2200, emissiveIntensity: 2.2, roughness: 0.25 }); // Impulse engine crystals & Bussards
  const warpJetMat = new THREE.MeshStandardMaterial({ color: 0x00d4ff, emissive: 0x00c4ff, emissiveIntensity: 2.5, roughness: 0.2 }); // Nacelle aft exhaust jet emitters
  const sensorGold = new THREE.MeshStandardMaterial({ color: 0xd4a038, metalness: 0.85, roughness: 0.35 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x16181d, metalness: 0.8, roughness: 0.45 });

  g.userData.enterpriseGlow = [warpBlue, impulseRed, warpJetMat];

  // ========== 1. PRIMARY HULL (SAUCER SECTION) ==========
  // Centered at Z = +68, Y = +11 (diameter ~140m)
  const saucerZ = 68, saucerY = 11;
  const saucerGroup = new THREE.Group();
  saucerGroup.position.set(0, saucerY, saucerZ);

  // Upper saucer hull: outer beveled rim
  const outerRim = new THREE.Mesh(new THREE.CylinderGeometry(63, 70, 3.2, 72), hullWhite);
  saucerGroup.add(outerRim);

  // Upper saucer inward slope
  const upperSlope = new THREE.Mesh(new THREE.CylinderGeometry(44, 63, 3.6, 72), hullWhite);
  upperSlope.position.y = 1.8;
  saucerGroup.add(upperSlope);

  // Upper superstructure terrace (Decks 2 & 3)
  const midTerrace = new THREE.Mesh(new THREE.CylinderGeometry(24, 44, 2.6, 64), hullWhite);
  midTerrace.position.y = 3.6;
  saucerGroup.add(midTerrace);

  // Bridge module housing (Deck 1 teardrop structure)
  const bridgeBase = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 13.5, 2.0, 48), hullWhite);
  bridgeBase.position.set(0, 5.0, -3.0);
  bridgeBase.scale.set(1.0, 1.0, 1.45);
  saucerGroup.add(bridgeBase);

  // Bridge Dome (Main Bridge skylight)
  const bridgeDome = new THREE.Mesh(new THREE.SphereGeometry(3.8, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), hullWhite);
  bridgeDome.position.set(0, 5.9, -1.5);
  saucerGroup.add(bridgeDome);

  // Lower saucer hull: inward slope to lower decks
  const lowerSlope = new THREE.Mesh(new THREE.CylinderGeometry(70, 42, 6.5, 72), hullWhite);
  lowerSlope.position.y = -3.8;
  saucerGroup.add(lowerSlope);

  // Lower sensor platform (Decks 10 & 11)
  const lowerPlat = new THREE.Mesh(new THREE.CylinderGeometry(42, 15, 3.8, 64), hullWhite);
  lowerPlat.position.y = -7.4;
  saucerGroup.add(lowerPlat);

  // Ventral Planetary Sensor Dome
  const ventralDome = new THREE.Mesh(new THREE.SphereGeometry(7.0, 32, 16, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), sensorGold);
  ventralDome.position.y = -8.5;
  saucerGroup.add(ventralDome);

  // Sensor dome center glow
  const sensorCore = new THREE.Mesh(new THREE.SphereGeometry(2.5, 24, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), warpBlue);
  sensorCore.position.y = -9.2;
  saucerGroup.add(sensorCore);

  // Saucer Registration Decal Disc (Sitting on upper hull)
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ebf0f5';
    ctx.fillRect(0, 0, 1024, 1024);

    // Subtle aztec panel lines
    ctx.strokeStyle = '#d5dce4'; ctx.lineWidth = 4;
    for (let r = 80; r < 480; r += 75) {
      ctx.beginPath(); ctx.arc(512, 512, r, 0, Math.PI * 2); ctx.stroke();
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      ctx.beginPath(); ctx.moveTo(512, 512); ctx.lineTo(512 + Math.cos(a) * 490, 512 + Math.sin(a) * 490); ctx.stroke();
    }

    // Starfleet Red Pennant stripes
    ctx.fillStyle = '#cc2211';
    ctx.fillRect(180, 500, 140, 14);
    ctx.fillRect(704, 500, 140, 14);

    // Bold registration text
    ctx.fillStyle = '#111318';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 54px Arial, Helvetica, sans-serif';
    ctx.letterSpacing = '6px';
    ctx.fillText('U.S.S. ENTERPRISE', 512, 195);
    ctx.font = 'bold 74px Arial, Helvetica, sans-serif';
    ctx.letterSpacing = '8px';
    ctx.fillText('NCC - 1701 - A', 512, 280);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const decalMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.25 });
    const decalDisc = new THREE.Mesh(new THREE.CircleGeometry(63, 64), decalMat);
    decalDisc.rotation.x = -Math.PI / 2;
    decalDisc.rotation.z = Math.PI; // orient forward
    decalDisc.position.y = 1.62;
    saucerGroup.add(decalDisc);
  } catch (e) {}

  ship.add(saucerGroup);

  // ========== 2. IMPULSE ENGINES (Aft of Saucer, Deck 7) ==========
  const impulseGroup = new THREE.Group();
  impulseGroup.position.set(0, saucerY + 2.5, saucerZ - 36);

  // Aerodynamic housing
  const impulseHousing = new THREE.Mesh(new THREE.BoxGeometry(16, 4.5, 18), hullWhite);
  impulseGroup.add(impulseHousing);

  // Dual glowing red impulse crystals
  for (const sx of [-4.2, 4.2]) {
    const crystal = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, 1.2), impulseRed);
    crystal.position.set(sx, 0.2, -9.1);
    impulseGroup.add(crystal);
  }
  ship.add(impulseGroup);

  // ========== 3. CONNECTING DORSAL (THE NECK) ==========
  // Swept-forward aerofoil pylon from saucer underside to engineering hull
  const neckGroup = new THREE.Group();
  neckGroup.position.set(0, saucerY - 14, saucerZ - 34);

  const neckShape = new THREE.Shape();
  neckShape.moveTo(0, 18);
  neckShape.lineTo(-12, 0);
  neckShape.lineTo(-32, 0);
  neckShape.lineTo(-16, 18);
  neckShape.closePath();

  const neckGeo = new THREE.ExtrudeGeometry(neckShape, {
    depth: 5.5,
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize: 0.6,
    bevelThickness: 0.6,
  });
  neckGeo.center();
  const neckMesh = new THREE.Mesh(neckGeo, hullWhite);
  neckMesh.rotation.y = Math.PI / 2;
  neckMesh.position.set(0, 0, 0);
  neckGroup.add(neckMesh);

  // Photon Torpedo Launcher housing (base of the neck)
  const torpedoBay = new THREE.Mesh(new THREE.BoxGeometry(6.2, 4.2, 9), hullDark);
  torpedoBay.position.set(0, -6.5, 10);
  neckGroup.add(torpedoBay);

  // Twin black launch tubes
  for (const tx of [-1.5, 1.5]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.8, 16), darkMetal);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(tx, -6.5, 14.6);
    neckGroup.add(tube);
  }
  ship.add(neckGroup);

  // ========== 4. SECONDARY HULL (ENGINEERING SECTION) ==========
  const engY = -15, engZ = -30;
  const engGroup = new THREE.Group();
  engGroup.position.set(0, engY, engZ);

  // Forward cylindrical section
  const fwdHull = new THREE.Mesh(new THREE.CylinderGeometry(11.2, 13.8, 32, 48), hullWhite);
  fwdHull.rotation.x = Math.PI / 2;
  fwdHull.position.z = 24;
  engGroup.add(fwdHull);

  // Navigational Deflector Housing
  const deflectorCollar = new THREE.Mesh(new THREE.CylinderGeometry(13.8, 11.5, 4.5, 48), hullDark);
  deflectorCollar.rotation.x = Math.PI / 2;
  deflectorCollar.position.z = 41;
  engGroup.add(deflectorCollar);

  // Parabolic Copper Deflector Dish
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 4.0, 4.8, 48, 1, true), deflectorCopper);
  dish.rotation.x = -Math.PI / 2;
  dish.position.z = 42;
  engGroup.add(dish);

  // Central glowing blue deflector emitter crystal
  const deflectorEmitter = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.4, 3.6, 24), warpBlue);
  deflectorEmitter.rotation.x = Math.PI / 2;
  deflectorEmitter.position.z = 43.5;
  engGroup.add(deflectorEmitter);

  // Mid engineering hull
  const midHull = new THREE.Mesh(new THREE.CylinderGeometry(13.8, 11.0, 48, 48), hullWhite);
  midHull.rotation.x = Math.PI / 2;
  midHull.position.z = -14;
  engGroup.add(midHull);

  // Aft tapered hull & undercut counter
  const aftHull = new THREE.Mesh(new THREE.CylinderGeometry(11.0, 7.2, 42, 48), hullWhite);
  aftHull.rotation.x = Math.PI / 2;
  aftHull.position.z = -56;
  engGroup.add(aftHull);

  // Aft Shuttlebay Hangar (Z = -74)
  const shuttleBay = new THREE.Mesh(new THREE.CylinderGeometry(7.0, 7.0, 8.0, 32, 1, false, 0, Math.PI), hullWhite);
  shuttleBay.rotation.z = Math.PI / 2;
  shuttleBay.position.set(0, 4.2, -73);
  engGroup.add(shuttleBay);

  // Clamshell hangar doors
  const hangarDoor = new THREE.Mesh(new THREE.BoxGeometry(8.5, 6.0, 1.2), hullDark);
  hangarDoor.position.set(0, 4.2, -77.2);
  engGroup.add(hangarDoor);

  ship.add(engGroup);

  // ========== 5. WARP NACELLE PYLONS ==========
  // Swept-back, upward-angled cantilever wings from secondary hull
  const pylonGroup = new THREE.Group();
  pylonGroup.position.set(0, engY + 5, engZ - 18);

  for (const sign of [-1, 1]) {
    const pylon = new THREE.Group();
    // Swept pylon blade
    const wing = new THREE.Mesh(new THREE.BoxGeometry(36, 2.4, 18), hullWhite);
    wing.position.set(sign * 21, 10.5, -4);
    wing.rotation.z = sign * 0.52; // angled upwards ~30°
    wing.rotation.y = -sign * 0.22; // swept backwards
    pylon.add(wing);

    // Dark trim accent on pylon
    const pylonTrim = new THREE.Mesh(new THREE.BoxGeometry(36, 0.4, 4.5), hullDark);
    pylonTrim.position.set(sign * 21, 11.2, -4);
    pylonTrim.rotation.z = sign * 0.52;
    pylonTrim.rotation.y = -sign * 0.22;
    pylon.add(pylonTrim);

    pylonGroup.add(pylon);
  }
  ship.add(pylonGroup);

  // ========== 6. DUAL WARP NACELLES (PORT & STARBOARD) ==========
  // Mounted at X = ±40, Y = +6, extending from Z = -155 to Z = +5
  const nacelleSpan = 40.0;
  const nacelleY = 7.5;
  const nacelleZ = -45;

  for (const sign of [-1, 1]) {
    const nacelle = new THREE.Group();
    nacelle.position.set(sign * nacelleSpan, nacelleY, nacelleZ);

    // Main elongated nacelle body (length ~125m)
    const nacelleBody = new THREE.Mesh(new THREE.BoxGeometry(7.8, 9.8, 120), hullWhite);
    nacelle.add(nacelleBody);

    // Beveled upper & lower curves
    const upperCyl = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 118, 32), hullWhite);
    upperCyl.rotation.x = Math.PI / 2;
    upperCyl.position.y = 4.8;
    nacelle.add(upperCyl);

    const lowerCyl = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 118, 32), hullWhite);
    lowerCyl.rotation.x = Math.PI / 2;
    lowerCyl.position.y = -4.8;
    nacelle.add(lowerCyl);

    // Forward Bussard Ramscoop (glowing red dome at front of nacelle, Z = +62)
    const bussard = new THREE.Mesh(new THREE.SphereGeometry(3.8, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), impulseRed);
    bussard.rotation.x = Math.PI / 2;
    bussard.position.z = 60.5;
    nacelle.add(bussard);

    // Inboard Warp Field Grille (the iconic Star Trek blue warp glow, facing inwards)
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4.2, 85), warpBlue);
    grille.position.set(-sign * 3.9, 0, -2);
    nacelle.add(grille);

    // Aft Chiller Fin & Cap (Z = -63)
    const aftFin = new THREE.Mesh(new THREE.BoxGeometry(6.5, 8.5, 8), darkMetal);
    aftFin.position.z = -63;
    nacelle.add(aftFin);

    const aftExhaust = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 4, 24), darkMetal);
    aftExhaust.rotation.x = Math.PI / 2;
    aftExhaust.position.z = -67.5;
    nacelle.add(aftExhaust);

    // Interior glowing warp jet nozzle emitter disc
    const nozEmitter = new THREE.Mesh(new THREE.CircleGeometry(2.35, 24), warpJetMat);
    nozEmitter.position.z = -69.2;
    nacelle.add(nozEmitter);

    // Outer flank dark accent band
    const outerStripe = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 90), hullDark);
    outerStripe.position.set(sign * 3.92, 0, -2);
    nacelle.add(outerStripe);

    ship.add(nacelle);
  }

  // Scale internal geometry to true 305m Constitution-refit specifications, centered at origin
  const SCALE_305 = 305.0 / 252.5;
  ship.scale.setScalar(SCALE_305);
  ship.position.z = -15.5 * SCALE_305;

  // Warp effects (see createWarpDrive): nacelle jets from the aft nozzles, a nested field around the ship.
  g.userData.warpDrive = {
    nozzles: [[-40 * SCALE_305, 7.5 * SCALE_305, (-114.5 - 15.5) * SCALE_305], [40 * SCALE_305, 7.5 * SCALE_305, (-114.5 - 15.5) * SCALE_305]],
    grilles: [[-36 * SCALE_305, 7.5 * SCALE_305, (-4.5 - 15.5) * SCALE_305], [36 * SCALE_305, 7.5 * SCALE_305, (-4.5 - 15.5) * SCALE_305]],
    grilleLength: 85 * SCALE_305,
    bussards: [[-40 * SCALE_305, 7.5 * SCALE_305, (17 - 15.5) * SCALE_305], [40 * SCALE_305, 7.5 * SCALE_305, (17 - 15.5) * SCALE_305]],
    impulse: [0, 13.5 * SCALE_305, (-23 - 15.5) * SCALE_305],
    field: { front: 260, R: 125, tail: 1800, wake: 45 },
  };

  g.userData.length = 305;
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

let ORB_TEX = null;
function orbTex() {
  if (ORB_TEX) return ORB_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1.0)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  grd.addColorStop(0.85, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  ORB_TEX = new THREE.CanvasTexture(c);
  return ORB_TEX;
}

// ------------------------------------------------------------------------------- Star Trek warp drive
// Not physics: the look of the films. Two unbroken jets stream from the nacelles and draw together
// far behind the ship, nested shells of warp field ripple from nose to tail, and the ship stretches and
// flashes as it jumps to warp and drops out of it. The long distorted wake itself is drawn in postfx.js.
const WARP_NOISE = /* glsl */ `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;

// A tube around the Z axis as (cos a, sin a, v): the vertex shaders below give it its real shape.
function axialGrid(around, along) {
  const pos = [], idx = [];
  for (let j = 0; j <= along; j++) for (let i = 0; i <= around; i++) {
    const a = (i / around) * Math.PI * 2;
    pos.push(Math.cos(a), Math.sin(a), j / along);
  }
  for (let j = 0; j < along; j++) for (let i = 0; i < around; i++) {
    const p = j * (around + 1) + i, q = p + around + 1;
    idx.push(p, p + 1, q, p + 1, q + 1, q);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// One continuous beam: soft across its width (bright where the sight line crosses most of it), so it has
// no visible surface and no beads along it, only strands of plasma slowly streaming aft.
function beam({ origin, length, r0, r1, color, core = color, gain = 1, soft = 2, fade = 1.5, flow = 1, strands = 0.5, converge = 0, wobble = 0, phase = 0 }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uOrigin: { value: new THREE.Vector3(...origin) }, uL: { value: length }, uR0: { value: r0 }, uR1: { value: r1 },
      uColor: { value: new THREE.Color(...color) }, uCore: { value: new THREE.Color(...core) }, uGain: { value: gain }, uSoft: { value: soft }, uFade: { value: fade },
      uFlow: { value: flow }, uStrands: { value: strands }, uConverge: { value: converge }, uWobble: { value: wobble }, uPhase: { value: phase },
      uTime: { value: 0 }, uPower: { value: 0 }, uReach: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uOrigin; uniform float uL, uR0, uR1, uConverge, uWobble, uPhase, uTime;
      varying vec3 vN, vV, vDir; varying float vU;
      void main() {
        float u = pow(position.z, 1.7);
        float s = u * u * (3.0 - 2.0 * u);
        vec2 c = uOrigin.xy * (1.0 - uConverge * s);
        c += uWobble * u * u * vec2(sin(u * 13.0 - uTime * 1.7 + uPhase), cos(u * 10.0 - uTime * 1.3 + uPhase * 1.7));
        float r = mix(uR0, uR1, pow(u, 0.7)) * (1.0 + 0.07 * u * sin(u * 55.0 - uTime * 7.0 + uPhase));
        vec4 mv = modelViewMatrix * vec4(c + r * position.xy, uOrigin.z - u * uL, 1.0);
        vN = normalMatrix * vec3(position.xy, 0.0); vV = -mv.xyz; vDir = vec3(position.xy, 0.0); vU = u;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uCore; uniform float uL, uGain, uSoft, uFade, uFlow, uStrands, uPower, uReach, uTime, uPhase;
      varying vec3 vN, vV, vDir; varying float vU;
      ${WARP_NOISE}
      void main() {
        float ndv = min(abs(dot(normalize(vN), normalize(vV))), 1.0);
        float body = pow(ndv, uSoft);
        float end = pow(max(1.0 - vU, 0.0), uFade) * (1.0 - smoothstep(uReach * 0.55, uReach, vU));
        float n = noise3(vec3(vDir.xy * 2.2 + uPhase, vU * uL * 0.009 - uTime * uFlow));
        float strand = mix(1.0, 0.5 + n, uStrands * smoothstep(0.0, 0.2, vU));
        vec3 col = mix(uCore, uColor, smoothstep(0.0, 0.3, vU) * 0.7 + (1.0 - ndv) * 0.3);
        gl_FragColor = vec4(col * body * end * strand * uPower * uGain, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(axialGrid(24, 96), mat);
  mesh.frustumCulled = false;
  return mesh;
}

// One shell of the warp field: an egg around the ship drawn out into a long tapering tail. Glass-like: clear
// where it is seen face-on and lit along its edge, with rings of field rippling aft across it.
function fieldShell({ front, R, tail, gain, phase, speed }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uFront: { value: front }, uR: { value: R }, uTail: { value: tail }, uGain: { value: gain }, uPhase: { value: phase }, uSpeed: { value: speed },
      uTime: { value: 0 }, uForm: { value: 0 }, uReach: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uFront, uR, uTail, uForm, uReach;
      varying vec3 vN, vV, vDir; varying float vZ, vT;
      float zOf(float v, float tail) { return v < 0.3 ? uFront * cos(v / 0.3 * 1.5708) : -tail * pow((v - 0.3) / 0.7, 1.5); }
      float rOf(float z, float tail) {
        if (z > 0.0) { float f = z / uFront; return uR * sqrt(max(0.0, 1.0 - f * f)); }
        float t = clamp(-z / tail, 0.0, 1.0);
        return uR * pow(max(1.0 - t * t * (3.0 - 2.0 * t), 0.0), 1.25);
      }
      void main() {
        float tail = uTail * (0.1 + 0.9 * uReach), form = mix(0.55, 1.0, uForm), v = position.z;
        float z = zOf(v, tail), r = rOf(z, tail);
        float z0 = zOf(max(v - 0.002, 0.0), tail), z1 = zOf(min(v + 0.002, 1.0), tail);
        float dr = rOf(z1, tail) - rOf(z0, tail), dz = z1 - z0;
        vec2 rz = normalize(vec2(-dz, dr));
        vec4 mv = modelViewMatrix * vec4(position.xy * r * form, z * form, 1.0);
        vN = normalMatrix * vec3(position.xy * rz.x, rz.y); vV = -mv.xyz; vDir = vec3(position.xy, 0.0); vZ = z;
        vT = z < 0.0 ? -z / tail : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFront, uGain, uPhase, uSpeed, uTime, uForm;
      varying vec3 vN, vV, vDir; varying float vZ, vT;
      ${WARP_NOISE}
      void main() {
        float ndv = min(abs(dot(normalize(vN), normalize(vV))), 1.0);
        float rim = pow(1.0 - ndv, 7.0);
        float rings = pow(0.5 + 0.5 * sin(vZ * 0.035 + uTime * uSpeed + uPhase), 5.0);
        float streams = noise3(vec3(vDir.xy * 2.6 + uPhase, vZ * 0.005 + uTime * 0.9));
        streams = smoothstep(0.5, 0.85, streams);
        float bow = vZ > 0.0 ? pow(vZ / uFront, 3.0) : 0.0;
        float a = rim * (0.55 + 0.9 * bow) + rings * (0.012 + 0.2 * rim) + streams * (0.014 + 0.2 * rim);
        a *= 1.0 - smoothstep(0.45, 1.0, vT);
        vec3 col = mix(vec3(0.22, 0.56, 1.0), vec3(0.1, 0.24, 1.0), smoothstep(0.0, 0.7, vT));
        col = mix(col, vec3(0.42, 0.26, 1.0), rim * 0.3);
        gl_FragColor = vec4(col * a * uGain * uForm, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(axialGrid(64, 110), mat);
  mesh.frustumCulled = false;
  return mesh;
}

function glowSprite(color, depthTest = true) {
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: orbTex(), color: new THREE.Color(...color), blending: THREE.AdditiveBlending, depthWrite: false, depthTest, transparent: true, opacity: 0 }));
}

function createWarpDrive(spec) {
  const root = new THREE.Group(), stretched = new THREE.Group(), { field } = spec;
  root.add(stretched);

  // the jets: a hot core inside a blue sheath inside a wide faint halo, all stretching out with speed
  const jets = [];
  spec.nozzles.forEach((origin, i) => {
    const phase = i * 2.4;
    const common = { origin, converge: 0.92, phase };
    jets.push(
      beam({ ...common, length: 1000, r0: 2.4, r1: 1.6, color: [0.4, 0.78, 1.0], core: [1, 1, 1], gain: 1.9, soft: 1.8, fade: 1.8, flow: 2.2, strands: 0.2, wobble: 3 }),
      beam({ ...common, length: 3000, r0: 5.5, r1: 11, color: [0.1, 0.48, 1.0], core: [0.3, 0.72, 1.0], gain: 1.15, soft: 2.2, fade: 1.5, flow: 1.6, strands: 0.8, wobble: 12 }),
      beam({ ...common, length: 3600, r0: 14, r1: 42, color: [0.16, 0.2, 0.95], core: [0.15, 0.42, 1.0], gain: 0.42, soft: 2.8, fade: 1.7, flow: 1.0, strands: 0.9, wobble: 26 }),
    );
  });
  // plasma running aft along the glowing inboard grilles of the nacelles
  const grilles = spec.grilles.map((origin, i) => beam({ origin, length: spec.grilleLength, r0: 4.2, r1: 4.2, color: [0.2, 0.62, 1.0], core: [0.5, 0.85, 1.0], gain: 0.9, soft: 2.4, fade: 0.25, flow: 5, strands: 1, phase: i }));
  // the impulse engines only push the ship up to the moment of the jump, then fall quiet
  const impulse = beam({ origin: spec.impulse, length: 200, r0: 3, r1: 6, color: [1.0, 0.28, 0.05], core: [1.0, 0.75, 0.4], gain: 1.2, soft: 2, fade: 1.6, flow: 2, strands: 0.6 });
  stretched.add(...jets, ...grilles, impulse);

  const nozzleGlow = spec.nozzles.map((o) => { const s = glowSprite([0.55, 0.85, 1.0]); s.position.set(o[0], o[1], o[2] - 2); s.scale.setScalar(26); return s; });
  const bussardGlow = spec.bussards.map((o) => { const s = glowSprite([1.0, 0.26, 0.1]); s.position.set(...o); s.scale.setScalar(36); return s; });
  stretched.add(...nozzleGlow, ...bussardGlow);

  // the nested field, outermost brightest
  const shells = [
    fieldShell({ ...field, gain: 0.55, phase: 0, speed: 3.2 }),
    fieldShell({ ...field, front: field.front * 0.88, R: field.R * 0.82, tail: field.tail * 0.72, gain: 0.24, phase: 2.1, speed: 4.3 }),
    fieldShell({ ...field, front: field.front * 0.76, R: field.R * 0.64, tail: field.tail * 0.48, gain: 0.14, phase: 4.2, speed: 5.5 }),
  ];
  stretched.add(...shells);

  // the flash of the jump: a burst, a flare drawn out sideways, and a ring running out through space
  const flashCore = glowSprite([0.75, 0.9, 1.0], false), flashStreak = glowSprite([0.45, 0.72, 1.0], false);
  flashCore.position.z = flashStreak.position.z = -40;
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uAge: { value: 0 } },
    vertexShader: 'varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uAge; varying vec2 vP;
      void main() {
        float r = length(vP), w = 0.03 + 0.04 * uAge;
        float a = exp(-pow((r - 0.86) / w, 2.0)) * (1.0 - smoothstep(0.92, 1.0, r)) * pow(1.0 - uAge, 2.0);
        gl_FragColor = vec4(mix(vec3(0.75, 0.92, 1.0), vec3(0.3, 0.45, 1.0), uAge) * a * 2.2, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  ring.position.z = -60;
  ring.visible = flashCore.visible = flashStreak.visible = false;
  root.add(flashCore, flashStreak, ring);

  let power = 0, reach = 0, lastMotion = 0, flash = 1;
  const FLASH_TIME = 1.3;
  root.userData.field = field;

  /** t: wall time; bubble, motion: 0…1 (wall up, speed of top speed); boost: extra power at the moment of launch */
  root.userData.update = (t, dt, bubble, motion, boost) => {
    if ((lastMotion < 0.002) !== (motion < 0.002) && dt < 0.5) flash = 0;
    lastMotion = motion;
    const k = 1 - Math.exp(-dt * 7);
    power += (bubble * boost - power) * k;
    reach += (motion - reach) * (1 - Math.exp(-dt * 3.5)); // the jets and tail shoot out behind the ship, and draw back in
    root.visible = power > 0.004 || flash < 1;
    if (!root.visible) return 1;

    const pulse = 0.94 + 0.06 * Math.sin(t * 13);
    for (const b of jets) {
      const u = b.material.uniforms;
      u.uTime.value = t; u.uPower.value = power * pulse; u.uReach.value = 0.05 + 0.95 * reach;
    }
    for (const b of grilles) { const u = b.material.uniforms; u.uTime.value = t; u.uPower.value = power; }
    const iu = impulse.material.uniforms;
    iu.uTime.value = t; iu.uPower.value = bubble * Math.max(0, 1 - motion * 4);
    for (const s of nozzleGlow) s.material.opacity = Math.min(1, power) * pulse;
    for (const s of bussardGlow) s.material.opacity = Math.min(1, power) * (0.72 + 0.1 * Math.sin(t * 9));
    for (const s of shells) { const u = s.material.uniforms; u.uTime.value = t; u.uForm.value = bubble; u.uReach.value = reach; }

    flash = Math.min(1, flash + dt / FLASH_TIME);
    const live = flash < 1, e = Math.pow(1 - flash, 3);
    flashCore.visible = flashStreak.visible = ring.visible = live;
    if (live) {
      flashCore.material.opacity = e; flashCore.scale.setScalar(260 + 520 * flash);
      flashStreak.material.opacity = e; flashStreak.scale.set(1500 + 2200 * flash, 34, 1);
      ring.scale.setScalar(60 + 1300 * Math.pow(flash, 0.6));
      ring.material.uniforms.uAge.value = flash;
    }
    // the ship and its field seem to stretch away for the instant it goes to warp, and again as it drops out
    const bell = 4 * motion * (1 - motion), stretch = 1 + 0.9 * bell * bell;
    stretched.scale.z = stretch;
    return stretch;
  };
  return root;
}

export class ProbeModel {
  constructor(id) { this.id = id; this.group = new THREE.Group(); this.ready = this.build(); this.flash = 0; this.warpBlastTimer = 0; }

  async build() {
    let m;
    if (id2glb[this.id]) {
      const { url, length, fix } = id2glb[this.id];
      m = await loadGLB(url, length, fix);
      m.userData.length = length;
    } else m = { orion, daedalus, starshot, antimatter, warp: warpShip, enterprise }[this.id]();
    this.model = m;
    this.length = m.userData.length;
    this.group.add(m);
    if (m.userData.exhaust) { this.plume = plume(m.userData.exhaust); this.group.add(this.plume); }
    if (m.userData.warpDrive) { this.warpDrive = createWarpDrive(m.userData.warpDrive); this.warpField = m.userData.warpDrive.field; this.group.add(this.warpDrive); }
    if (m.userData.pulse) {
      this.pulseLight = new THREE.PointLight(0xffeedd, 0, 500, 1.4);
      this.pulseLight.position.z = -42;
      this.group.add(this.pulseLight);
      this.pulseFlash = new THREE.Mesh(
        new THREE.SphereGeometry(6.5, 32, 16),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(25, 20, 15),
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      this.pulseFlash.position.z = -46;
      this.group.add(this.pulseFlash);
      this.pulseTimer = 0.95;
    }
    return this;
  }

  /** thrusting: proper acceleration (m/s²) or 0; t: wall time seconds; warp: sim seconds per real second;
   *  bubble: 0…1, how far the warp bubble is up (the warp ship's rings glow with it); dt: frame delta;
   *  motion: 0…1, the bubble's speed, of its top speed */
  update(accel, t, warp, bubble = 0, dt = 0.016, motion = 0) {
    if (this.warpBlastTimer > 0) {
      this.warpBlastTimer = Math.max(0, this.warpBlastTimer - dt);
    }
    const rings = this.model?.userData.rings;
    if (rings) rings.emissiveIntensity += (bubble * (2.2 + 0.3 * Math.sin(t * 5)) - rings.emissiveIntensity) * 0.15;
    const enterpriseGlow = this.model?.userData.enterpriseGlow;
    if (enterpriseGlow) {
      const warpOn = bubble > 0.01 || (warp && warp > 1);
      const flare = (this.warpBlastTimer > 0) ? 2.6 : 1.0;
      const targetIntensity = warpOn ? (3.4 * flare + 0.6 * Math.sin(t * 12)) : 0.8;
      enterpriseGlow.forEach((mat) => {
        mat.emissiveIntensity += (targetIntensity - mat.emissiveIntensity) * 0.18;
      });
    }
    if (this.warpDrive) {
      const boost = this.warpBlastTimer > 0 ? 1 + 0.5 * Math.min(1, this.warpBlastTimer) : 1;
      this.model.scale.z = this.warpDrive.userData.update(t, dt, bubble, motion, boost);
    }
    if (this.plume) {
      const P = this.plume.userData;
      P.power += ((accel > 0 ? 1 : 0) - P.power) * 0.1;
      this.plume.visible = P.power > 0.01;
      this.plume.children.forEach((sp, i) => { sp.material.opacity = P.power * sp.userData.k * (0.85 + 0.15 * Math.sin(t * 23 + i * 1.7)); });
    }
    if (this.pulseLight) {
      // Orion detonates a pulse unit about once per second (~0.95 s)
      const firing = accel > 0;
      if (firing) {
        if (this.pulseTimer === undefined) this.pulseTimer = 0.95;
        this.pulseTimer += (dt || 0.016);
        const PULSE_INTERVAL = 0.95;
        if (this.pulseTimer >= PULSE_INTERVAL) {
          this.pulseTimer = 0;
          this.flash = 1.0;
          this.onPulse?.();
        }
      } else {
        this.pulseTimer = 0.95; // reset so next burn starts with an immediate blast
      }
      this.flash = (this.flash || 0) * 0.86;
      if (this.flash < 0.005) this.flash = 0;
      this.pulseLight.intensity = this.flash * 2.5e5;
      this.pulseFlash.material.opacity = this.flash;
      this.pulseFlash.scale.setScalar(1 + (1 - this.flash) * 3.5);
    }
    if (this.model?.userData.spin) this.model.userData.spin.rotation.z = t * 0.21; // ~2 rpm → ~0.1 g at 28 m... shown sped up
  }
}

// NASA 3D Resources models (public domain). `fix` rotates the model so its natural forward is +Z.
const id2glb = {
  voyager: { url: 'models/voyager.glb', length: 13.0, fix: [Math.PI / 2, 0, 0] },
  parker: { url: 'models/parker.glb', length: 3.0, fix: [0, Math.PI, 0] },
};
