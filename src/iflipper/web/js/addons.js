// Cases and GPIO modules that dress up the Flipper.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { DIM, GPIO } from './flipper.js';
import { annularSector, bodyRadii, extrudeUp, roundedRectPath, roundedRectPoints, roundedRectShape, wallRing } from './geometry.js';
import { labelTexture, pcbTexture } from './textures.js';

const { L, W, H } = DIM;

// -- materials --------------------------------------------------------------

export function caseMaterial(kind, color) {
  if (kind === 'clear') {
    return new THREE.MeshPhysicalMaterial({
      color, transmission: 0.95, roughness: 0.14, thickness: 1.6, ior: 1.5,
      attenuationColor: new THREE.Color(color), attenuationDistance: 25, clearcoat: 0.6, side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.78, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.4),
    side: THREE.DoubleSide,
  });
}

// -- cases ----------------------------------------------------------------------

const T = 1.6; // wall thickness
const BOTTOM = 1.4;

// Openings in the side walls: [test(point), y0, y1]
const OPENINGS = [
  [(p) => p.y > W / 2 - 1 && Math.abs(p.x - GPIO.x) < 26, GPIO.y - 3.4, GPIO.y + 3.4], // GPIO
  [(p) => p.x < -L / 2 + 1 && Math.abs(p.y + 6) < 6.5, H * 0.33 - 2.8, H * 0.33 + 2.8], // USB-C
];

function walls(outer, inner, y0, y1) {
  // Slice the wall into height bands so each opening only cuts where it is.
  const cuts = new Set([y0, y1]);
  for (const [, a, b] of OPENINGS) {
    if (a > y0 && a < y1) cuts.add(a);
    if (b > y0 && b < y1) cuts.add(b);
  }
  const ys = [...cuts].sort((a, b) => a - b);
  const bands = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const mid = (ys[i] + ys[i + 1]) / 2;
    const active = OPENINGS.filter(([, a, b]) => mid > a && mid < b).map(([t]) => t);
    bands.push(active.length ? (p) => active.some((t) => t(p)) : () => false);
  }
  // Caps only where the wall really ends: the outer edges, or next to an opening's cut.
  return bands.map((skip, i) => wallRing(outer, inner, ys[i], ys[i + 1], skip, {
    bottom: i === 0 ? true : bands[i - 1],
    top: i === bands.length - 1 ? true : bands[i + 1],
  }));
}

export function buildCase(opts, flipper) {
  const g = new THREE.Group();
  g.name = 'case';
  if (!opts || opts.type === 'none') return g;
  const mat = caseMaterial(opts.material, opts.color);
  const n = 220;
  const outer = roundedRectPoints(L + 2 * T + 0.6, W + 2 * T + 0.6, bodyRadii(T + 0.3), n);
  const inner = roundedRectPoints(L + 0.6, W + 0.6, bodyRadii(0.3), n);
  const top = opts.type === 'full' ? H + 1.3 : H * 0.56;
  for (const geo of walls(outer, inner, 0, top)) g.add(new THREE.Mesh(geo, mat));
  // Bottom plate with a soft rounded edge
  const plate = new THREE.Mesh(extrudeUp(roundedRectShape(L + 2 * T + 0.6, W + 2 * T + 0.6, bodyRadii(T + 0.3)), BOTTOM, { bevel: 0.6 }), mat);
  plate.position.y = -BOTTOM;
  g.add(plate);
  // Rounded lip on the open edge
  const lip = new THREE.Mesh(extrudeUp(ringShape(L + 2 * T + 0.6, W + 2 * T + 0.6, L + 0.6, W + 0.6), 0.8, { bevel: 0.35 }), mat);
  lip.position.y = top - 0.4;
  if (opts.type === 'half') g.add(lip);

  if (opts.type === 'full') {
    // Top plate: only the screen stays open; buttons get moulded silicone pillows.
    const plateShape = roundedRectShape(L + 2 * T + 0.6, W + 2 * T + 0.6, bodyRadii(T + 0.3));
    plateShape.holes.push(roundedRectPath(49.5, 29.5, 5, -19, 1.8));
    plateShape.holes.push(circlePath(27, 0, 15.8));
    plateShape.holes.push(circlePath(42.2, -12.6, 5.7));
    const topPlate = new THREE.Mesh(extrudeUp(plateShape, 1.3, { bevel: 0.5 }), mat);
    topPlate.position.y = H + 0.05;
    g.add(topPlate);
    const pillow = (shape, key, x, z, h) => {
      const m = new THREE.Mesh(extrudeUp(shape, h, { bevel: 1.1, segments: 6 }), mat);
      m.position.set(x, H - 0.3, z);
      m.userData.key = key;
      m.userData.baseY = m.position.y;
      g.add(m);
      flipper.keys[key].extra.push(m);
      flipper.hitTargets.push(m);
      return m;
    };
    const span = THREE.MathUtils.degToRad(40);
    const dirs = { right: 0, up: Math.PI / 2, left: Math.PI, down: Math.PI * 1.5 };
    for (const [k, a] of Object.entries(dirs)) {
      pillow(annularSector(6.6, 15.2, a - span, a + span), k, 27, 0, 3.6);
      const tri = new THREE.Shape();
      tri.moveTo(2, 0); tri.lineTo(-1.2, 1.9); tri.lineTo(-1.2, -1.9); tri.closePath();
      const gl = new THREE.Mesh(extrudeUp(tri, 0.4, { bevel: 0.2 }), mat);
      const rm = 10.9;
      gl.position.set(27 + Math.cos(a) * rm, H + 3.25, -Math.sin(a) * rm);
      gl.userData.baseY = gl.position.y;
      gl.rotation.y = a;
      g.add(gl);
      flipper.keys[k].extra.push(gl);
    }
    pillow(new THREE.Shape().absarc(0, 0, 6.1, 0, Math.PI * 2), 'ok', 27, 0, 4.2);
    pillow(new THREE.Shape().absarc(0, 0, 5.2, 0, Math.PI * 2), 'back', 42.2, 12.6, 3.4);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function circlePath(x, y, r) {
  const p = new THREE.Path();
  p.absarc(x, y, r, 0, Math.PI * 2, true);
  return p;
}

function ringShape(ow, oh, iw, ih) {
  const s = roundedRectShape(ow, oh, bodyRadii(T + 0.3));
  s.holes.push(roundedRectPath(iw, ih, bodyRadii(0.3)));
  return s;
}

// -- GPIO modules -------------------------------------------------------------------

export const MODULES = {
  none: { name: 'Без модуля' },
  wifi: { name: 'Wi-Fi Devboard', sub: 'ESP32-S2', antenna: true, board: [44, 30], mask: '#202226', label: 'WIFI DEVBOARD' },
  cc1101: { name: 'CC1101 Sub-GHz', sub: 'внешний радиомодуль', antenna: true, board: [34, 22], mask: '#1f5c3a', label: 'CC1101 433/868' },
  nrf24: { name: 'NRF24 + PA/LNA', sub: '2.4 ГГц', antenna: true, board: [32, 17], mask: '#16181b', label: 'NRF24L01+PA' },
  game: { name: 'Game Module', sub: 'RP2040 + IMU', antenna: false, board: [50, 34], mask: '#2a1f4d', label: 'GAME MODULE' },
};

const Z0 = -W / 2 - 1; // where the module's socket meets the Flipper

export function buildModule(id, opts) {
  const g = new THREE.Group();
  g.name = 'module';
  const def = MODULES[id];
  if (!def || id === 'none') return g;
  const [bw, bd] = def.board;
  const y = GPIO.y;
  const dark = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xcfd1d4, metalness: 1, roughness: 0.25 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b45c, metalness: 1, roughness: 0.22 });

  // Female socket over the Flipper's pins
  const sockLen = GPIO.pins * GPIO.pitch + 1;
  const sock = new THREE.Mesh(new RoundedBoxGeometry(sockLen, 2.8, 8.5, 2, 0.4), dark);
  sock.position.set(GPIO.x, y, Z0 - 4.25);
  g.add(sock);

  // Board
  const boardZ = Z0 - 7.5 - bd / 2;
  const pcbMat = new THREE.MeshStandardMaterial({ map: pcbTexture(bw, bd, { mask: def.mask, label: def.label, seed: bw }), roughness: 0.45 });
  const edge = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.mask).multiplyScalar(0.7), roughness: 0.6 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(bw, 1.2, bd), [edge, edge, pcbMat, edge, edge, edge]);
  board.position.set(GPIO.x, y - 1.6, boardZ);
  g.add(board);
  const top = y - 1.0;
  const part = (w, h, d, x, z, mat = dark) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 1, Math.min(0.3, h / 2.2)), mat);
    m.position.set(GPIO.x + x, top + h / 2, boardZ + z);
    g.add(m);
    return m;
  };
  const far = -bd / 2; // far edge (away from the Flipper), in board-local z
  let antennaAt = null;

  if (id === 'wifi') {
    part(15.4, 2.6, 18, -6, -1, metal); // ESP32-S2 module can
    const ant = part(15.4, 0.4, 6, -6, far + 3.4, new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.4 }));
    ant.position.y = top + 0.2;
    part(9, 3.2, 7.2, 11, far + 3, metal); // USB-C
    part(3.2, 1.6, 3.2, 9, 5);
    part(3.2, 1.6, 3.2, 14, 5);
    part(1.6, 0.8, 1, 4, 9, new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 1.2 }));
    antennaAt = [-17, far + 1.5];
  } else if (id === 'cc1101' || id === 'nrf24') {
    part(id === 'cc1101' ? 11 : 9, 1.1, id === 'cc1101' ? 11 : 6, -3, 2);
    if (id === 'nrf24') part(10, 2, 9, 4, -1, metal); // PA shield
    part(4, 1.1, 2.5, 7, 6, new THREE.MeshStandardMaterial({ color: 0xb8b8b8, metalness: 0.6, roughness: 0.3 })); // crystal
    antennaAt = [0, far];
  } else if (id === 'game') {
    part(7, 1, 7, -8, 2);   // RP2040
    part(3, 0.9, 3, 4, 6);  // IMU
    part(9, 3.2, 7.2, 14, far + 3, metal);
    part(12, 2, 4, -12, far + 3); // video out
  }

  // SMA connector on the far edge for the external radios
  if (def.antenna && id !== 'wifi') {
    const [ax, az] = antennaAt;
    const sma = new THREE.Group();
    const hex = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 3, 6), gold);
    hex.rotation.x = Math.PI / 2;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 7, 24), gold);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -4.5;
    sma.add(hex, barrel);
    sma.position.set(GPIO.x + ax, top + 2.6, boardZ + az - 1.5);
    g.add(sma);
    antennaAt = [ax, az - 9];
  }

  if (def.antenna && opts.antenna) g.add(buildAntenna(id, GPIO.x + antennaAt[0], top + 2.6, boardZ + antennaAt[1]));

  if (opts.cover) {
    const coverMat = opts.coverClear ? caseMaterial('clear', opts.coverColor) : new THREE.MeshPhysicalMaterial({
      color: opts.coverColor, roughness: 0.55, clearcoat: 0.2,
    });
    const depth = 7.5 + bd + 2;
    const shell = new THREE.Mesh(new RoundedBoxGeometry(Math.max(bw, sockLen) + 3.5, 9.5, depth, 4, 2.4), coverMat);
    shell.position.set(GPIO.x, y - 0.4, Z0 - depth / 2 + 0.5);
    g.add(shell);
    if (!opts.coverClear) {
      const lbl = labelTexture(def.name.toUpperCase(), { color: 'rgba(0,0,0,0.5)', px: 56, weight: 700 });
      const w = Math.min(bw - 6, 26);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, w / lbl.userData.aspect),
        new THREE.MeshStandardMaterial({ map: lbl, transparent: true, roughness: 0.6, depthWrite: false }));
      p.rotation.x = -Math.PI / 2;
      p.position.set(GPIO.x, y + 4.36, Z0 - depth / 2);
      g.add(p);
    }
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// Rubber-duck antenna (or a slim whip for the Wi-Fi board), hinged and tilted up.
function buildAntenna(id, x, y, z) {
  const rubber = new THREE.MeshPhysicalMaterial({ color: 0x17181b, roughness: 0.62, sheen: 0.4 });
  const g = new THREE.Group();
  const len = id === 'cc1101' ? 105 : id === 'nrf24' ? 72 : 48;
  const r = id === 'wifi' ? 2.4 : 3.6;
  const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.05, r * 2.8, 24), rubber);
  knuckle.rotation.z = Math.PI / 2;
  g.add(knuckle);
  const arm = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r, len, 28, 1), rubber);
  body.position.y = len / 2 + r;
  arm.add(body);
  for (let i = 1; i < 6; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(r * (1 - i * 0.045), 0.25, 6, 28), rubber);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = r + len * (i / 6.5);
    arm.add(rib);
  }
  const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.72, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), rubber);
  tip.position.y = len + r;
  arm.add(tip);
  arm.rotation.x = -THREE.MathUtils.degToRad(id === 'wifi' ? 50 : id === 'cc1101' ? 62 : 52); // folded back over the mat
  const hinge = new THREE.Group(); // swung sideways so it reads well from the default camera
  hinge.rotation.y = THREE.MathUtils.degToRad(-38);
  hinge.add(arm);
  g.add(hinge);
  g.position.set(x, y, z);
  return g;
}
