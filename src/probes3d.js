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
function daedalus() {
  const g = new THREE.Group();
  const steel = M.steel(), gold = M.gold(), dark = M.dark(), white = M.white();
  // stage 1 reaction chamber (hemispherical, 100 m bell) + thrust structure
  const bell = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2.4), steel);
  bell.rotation.x = -Math.PI / 2; bell.position.z = -55; g.add(bell);
  const bellInner = new THREE.Mesh(new THREE.SphereGeometry(49, 64, 32, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2.4), M.copper());
  bellInner.material.side = THREE.BackSide; bellInner.rotation.x = -Math.PI / 2; bellInner.position.z = -55; g.add(bellInner);
  g.add(along(cyl(14, 22, 30, dark), -40));
  // stage 1 tanks: 4 × 40 m spheres
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const t = new THREE.Mesh(new THREE.SphereGeometry(20, 48, 24), white);
    t.position.set(Math.cos(a) * 28, Math.sin(a) * 28, -8); g.add(t);
    const strut = cyl(1.2, 1.2, 30, dark, 8); strut.rotation.z = a + Math.PI / 2; strut.position.set(Math.cos(a) * 14, Math.sin(a) * 14, -8); g.add(strut);
  }
  g.add(along(cyl(6, 6, 90, dark, 16), 10)); // spine
  // interstage + stage 2 chamber (40 m)
  const bell2 = new THREE.Mesh(new THREE.SphereGeometry(20, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2.4), steel);
  bell2.rotation.x = -Math.PI / 2; bell2.position.z = 30; g.add(bell2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.SphereGeometry(8, 32, 16), gold);
    t.position.set(Math.cos(a) * 12, Math.sin(a) * 12, 52); g.add(t);
  }
  g.add(along(cyl(5, 8, 20, dark), 62));
  // payload bay and beryllium erosion shield
  g.add(along(cyl(9, 9, 18, gold), 80));
  const shield = along(cyl(16, 16, 0.6, M.steel(), 96), 96); g.add(shield);
  g.userData.exhaust = { z: -60, radius: 22, length: 900, color: [0.75, 0.6, 1.0] };
  g.userData.length = 190;
  return g;
}

// ---- Project Orion: pusher plate, two-stage shock absorbers, pulse-unit magazine, crew stack
function orion() {
  const g = new THREE.Group();
  const steel = M.steel(), dark = M.dark(), white = M.white();
  const plate = along(cyl(20, 20, 1.5, steel, 96), -20); g.add(plate);
  const ablative = along(cyl(19.6, 19.6, 0.4, new THREE.MeshStandardMaterial({ color: 0x3b2e25, roughness: 0.9 }), 96), -20.9); g.add(ablative);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = along(cyl(1.4, 1.4, 12, dark, 16), -13); s.position.x = Math.cos(a) * 9; s.position.y = Math.sin(a) * 9; g.add(s);
    const p = along(cyl(0.7, 0.7, 12, steel, 12), -9); p.position.x = Math.cos(a) * 9; p.position.y = Math.sin(a) * 9; g.add(p);
  }
  g.add(along(cyl(11, 11, 3, dark), -6));
  g.add(along(cyl(6, 6, 22, white), 8)); // magazine of pulse units
  for (let i = 0; i < 3; i++) g.add(along(cyl(9, 9, 6, i % 2 ? white : M.foil()), 22 + i * 7));
  g.add(along(cyl(4, 9, 6, white), 45));
  g.userData.pulse = true;
  g.userData.length = 70;
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

// ---- Antimatter photon/beam-core ship (conceptual): shield, rotating habitat, spine, radiators,
//      magnetic nozzle coils
function antimatter() {
  const g = new THREE.Group();
  const steel = M.steel(), dark = M.dark(), white = M.white();
  g.add(along(cyl(3, 3, 340, dark, 16), 0)); // spine
  const shield = new THREE.Mesh(new THREE.SphereGeometry(30, 64, 16, 0, Math.PI * 2, 0, 0.5), steel);
  shield.rotation.x = Math.PI / 2; shield.position.z = 145; g.add(shield);
  const hab = new THREE.Mesh(new THREE.TorusGeometry(28, 3.5, 24, 96), white);
  hab.position.z = 110; g.add(hab); g.userData.spin = hab;
  for (let i = 0; i < 6; i++) { const s = cyl(0.8, 0.8, 28, dark, 8); s.rotation.z = (i / 6) * Math.PI; s.position.z = 110; hab.add(s); s.position.set(0, 0, 0); }
  g.add(along(cyl(8, 8, 30, white), 110));
  // antimatter storage (Penning traps)
  for (let i = 0; i < 3; i++) g.add(along(cyl(7, 7, 14, M.foil()), 60 - i * 18));
  // radiator panels
  const rad = M.radiator();
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 40, 110), rad);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    p.position.set(Math.cos(a) * 23, Math.sin(a) * 23, -40);
    p.rotation.z = a; g.add(p);
  }
  // magnetic nozzle: superconducting coils in a cone
  for (let i = 0; i < 7; i++) {
    const r = 6 + i * 4.2;
    const coil = new THREE.Mesh(new THREE.TorusGeometry(r, 0.9, 12, 64), M.copper());
    coil.position.z = -120 - i * 9; g.add(coil);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 62, 8), dark);
    s.position.set(Math.cos(a) * 18, Math.sin(a) * 18, -147);
    s.rotation.x = Math.PI / 2; s.rotation.z = 0; g.add(s);
  }
  g.userData.exhaust = { z: -180, radius: 30, length: 1600, color: [0.55, 0.75, 1.0] };
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
      this.pulseLight.position.z = -40;
      this.group.add(this.pulseLight);
      this.pulseFlash = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 26, 20), transparent: true, opacity: 0 }));
      this.pulseFlash.position.z = -45;
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
