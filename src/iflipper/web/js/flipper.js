// The Flipper Zero model: an original procedural rendition (no scanned or copied assets).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { annularSector, bodyRadii, extrudeUp, place, roundedRectPath, roundedRectShape } from './geometry.js';
import { labelTexture, pcbTexture } from './textures.js';

export const DIM = { L: 100, W: 40, H: 25.6 };
const { L, W, H } = DIM;
export const GPIO = { x: 13, pins: 18, pitch: 2.54, y: H * 0.47 };
const SCREEN = { x: -19, z: -1.2, w: 36, h: 18 };
const DPAD = { x: 27, z: 0, r0: 6.9, r1: 14.2 };
const BACK = { x: 42.2, z: 12.6, r: 4.4 };
const KEY_TRAVEL = 0.8;

const DEFAULT_LOOK = {
  body: { color: '#f3f3f0', finish: 'gloss' },
  accent: '#b9bcc2',
  buttons: { dpad: '#e9e9e6', ok: '#ff8200', back: '#e9e9e6' },
  screen: { backlight: '#ff8a1c' },
};

export class Flipper {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'flipper';
    this.keys = {}; // key -> {meshes, offset, target}
    this.hitTargets = [];
    this.mats = this.makeMaterials();
    this.buildScreen();
    this.buildBody();
    this.buildFace();
    this.buildEdges();
    this.buildInternals();
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.lcdMesh.castShadow = false;
    this.glass.castShadow = false;
    this.apply(DEFAULT_LOOK);
  }

  makeMaterials() {
    const m = {
      shell: new THREE.MeshPhysicalMaterial({ color: 0xf3f3f0, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
      accent: new THREE.MeshPhysicalMaterial({ color: 0xb9bcc2, roughness: 0.5, metalness: 0.0 }),
      bezel: new THREE.MeshPhysicalMaterial({ color: 0x0b0c0e, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.12,
        clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false,
      }),
      cavity: new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.85 }),
      dpad: new THREE.MeshPhysicalMaterial({ color: 0xe9e9e6, roughness: 0.38, clearcoat: 0.4 }),
      ok: new THREE.MeshPhysicalMaterial({ color: 0xff8200, roughness: 0.32, clearcoat: 0.6 }),
      back: new THREE.MeshPhysicalMaterial({ color: 0xe9e9e6, roughness: 0.38, clearcoat: 0.4 }),
      glyph: new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.55 }),
      ir: new THREE.MeshPhysicalMaterial({ color: 0x1a0d10, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.92 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xc8c9cc, roughness: 0.28, metalness: 1 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd7b25a, roughness: 0.25, metalness: 1 }),
      led: new THREE.MeshStandardMaterial({ color: 0x113311, emissive: 0x00ff66, emissiveIntensity: 0 }),
    };
    return m;
  }

  // -- screen ---------------------------------------------------------------

  buildScreen() {
    this.lcdCanvas = document.createElement('canvas');
    this.lcdCanvas.width = 128;
    this.lcdCanvas.height = 64;
    this.lcdCtx = this.lcdCanvas.getContext('2d');
    this.lcdImage = this.lcdCtx.createImageData(128, 64);
    this.lcdTex = new THREE.CanvasTexture(this.lcdCanvas);
    this.lcdTex.colorSpace = THREE.SRGBColorSpace;
    this.lcdTex.magFilter = THREE.NearestFilter;
    this.lcdTex.minFilter = THREE.LinearFilter;
    this.lcdTex.generateMipmaps = false;
    this.lcdMat = new THREE.MeshStandardMaterial({
      map: this.lcdTex, emissiveMap: this.lcdTex, emissive: 0xffffff, emissiveIntensity: 0.42, roughness: 0.55,
    });
    this.backlight = new THREE.Color('#ff8a1c');
    this.ink = new THREE.Color('#1c0f02');
    this.lit = true;
    this.frame = null;
  }

  setBacklight(on) {
    this.lit = on;
    this.redraw();
  }

  // 1024 bytes, u8g2 page layout (8 rows per byte, LSB on top).
  setFrame(bytes) {
    this.frame = bytes;
    this.message = null;
    this.redraw();
  }

  setMessage(lines) {
    this.message = lines;
    this.frame = null;
    this.redraw();
  }

  redraw() {
    const bl = this.lit ? this.backlight : this.backlight.clone().multiplyScalar(0.18);
    const bg = [bl.r * 255, bl.g * 255, bl.b * 255];
    const fg = this.lit ? [this.ink.r * 255, this.ink.g * 255, this.ink.b * 255] : [12, 8, 4];
    const d = this.lcdImage.data;
    let on;
    if (this.frame) {
      const f = this.frame;
      on = (x, y) => (f[(y >> 3) * 128 + x] >> (y & 7)) & 1;
    } else {
      const bits = this.message ? textBits(this.message) : null;
      on = (x, y) => (bits ? bits[y * 128 + x] : 0);
    }
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 128; x++) {
        const i = (y * 128 + x) * 4;
        const c = on(x, y) ? fg : bg;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    this.lcdCtx.putImageData(this.lcdImage, 0, 0);
    this.lcdTex.needsUpdate = true;
    this.lcdMat.emissiveIntensity = this.lit ? 0.42 : 0.04;
  }

  // -- shell ----------------------------------------------------------------

  buildBody() {
    const bevel = 4.2;
    const shape = roundedRectShape(L - 2 * bevel, W - 2 * bevel, bodyRadii(-bevel));
    this.shellGeo = extrudeUp(shape, H, { bevel, segments: 10, curveSegments: 40 });
    this.shell = new THREE.Mesh(this.shellGeo, this.mats.shell);
    this.shell.name = 'shell';
    this.group.add(this.shell);
    // Seam rail between top and bottom halves
    const rail = new THREE.Mesh(extrudeUp(roundedRectShape(L + 0.5, W + 0.5, bodyRadii(0.25)), 1.4, { bevel: 0.35 }), this.mats.accent);
    rail.position.y = H * 0.4;
    this.group.add(rail);
    // Left end cap in the accent colour (houses the IR window)
    const cap = new THREE.Mesh(extrudeUp(roundedRectShape(9, W - 9, 3.5), H - 9, { bevel: 1.2 }), this.mats.accent);
    cap.position.set(-L / 2 + 2.6, 4.5, 0);
    cap.scale.x = 0.6;
    this.group.add(cap);
  }

  buildFace() {
    const top = H;
    const add = (geo, mat, x, y, z) => {
      const m = place(new THREE.Mesh(geo, mat), x, y, z);
      this.group.add(m);
      return m;
    };
    // Screen: black glass bezel with the LCD inside and a clear cover on top
    const bezelShape = roundedRectShape(47, 27, 4);
    bezelShape.holes.push(roundedRectPath(SCREEN.w + 1, SCREEN.h + 1, 0.8, 0, 0.6));
    add(extrudeUp(bezelShape, 0.9, { bevel: 0.3 }), this.mats.bezel, SCREEN.x, top - 0.1, SCREEN.z - 0.6);
    this.lcdMesh = add(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), this.lcdMat, SCREEN.x, top + 0.25, SCREEN.z - 1.2);
    this.lcdMesh.rotation.x = -Math.PI / 2;
    this.glass = add(extrudeUp(roundedRectShape(46.6, 26.6, 3.8), 0.15), this.mats.glass, SCREEN.x, top + 0.82, SCREEN.z - 0.6);
    this.glass.renderOrder = 2;
    // Tiny printed label under the screen and the status LED
    const lbl = labelTexture('iFlipper', { color: 'rgba(60,62,68,0.85)', px: 48, weight: 700 });
    const lblMesh = add(new THREE.PlaneGeometry(10 * lbl.userData.aspect / 1.3, 10 / 1.3 * 0.55),
      new THREE.MeshStandardMaterial({ map: lbl, transparent: true, roughness: 0.6 }), -31, top + 0.02, 15.6);
    lblMesh.scale.setScalar(0.42);
    lblMesh.rotation.x = -Math.PI / 2;
    this.led = add(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 20), this.mats.led, 1.6, top + 0.15, -14.5);

    // D-pad cavity and four arrow keys
    add(new THREE.CylinderGeometry(DPAD.r1 + 1.3, DPAD.r1 + 1.3, 0.2, 64), this.mats.cavity, DPAD.x, top + 0.02, DPAD.z);
    const dirs = { right: 0, up: Math.PI / 2, left: Math.PI, down: Math.PI * 1.5 };
    const span = THREE.MathUtils.degToRad(39);
    for (const [key, a] of Object.entries(dirs)) {
      const g = new THREE.Group();
      const btn = new THREE.Mesh(extrudeUp(annularSector(DPAD.r0, DPAD.r1, a - span, a + span), 2.2, { bevel: 0.6 }), this.mats.dpad);
      g.add(btn);
      const tri = new THREE.Shape();
      const s = 2.1;
      tri.moveTo(s, 0); tri.lineTo(-s * 0.6, s * 0.95); tri.lineTo(-s * 0.6, -s * 0.95); tri.closePath();
      const glyph = new THREE.Mesh(extrudeUp(tri, 0.25), this.mats.glyph);
      const rm = (DPAD.r0 + DPAD.r1) / 2;
      glyph.position.set(Math.cos(a) * rm, 2.2, -Math.sin(a) * rm);
      glyph.rotation.y = a;
      g.add(glyph);
      place(g, DPAD.x, top, DPAD.z);
      this.group.add(g);
      this.registerKey(key, g, [btn, glyph]);
    }
    const ok = new THREE.Group();
    const okBtn = new THREE.Mesh(extrudeUp(new THREE.Shape().absarc(0, 0, 5.6, 0, Math.PI * 2), 2.6, { bevel: 0.9, segments: 6 }), this.mats.ok);
    ok.add(okBtn);
    place(ok, DPAD.x, top, DPAD.z);
    this.group.add(ok);
    this.registerKey('ok', ok, [okBtn]);

    // Back button with a curved-arrow glyph
    add(new THREE.CylinderGeometry(BACK.r + 0.9, BACK.r + 0.9, 0.2, 48), this.mats.cavity, BACK.x, top + 0.02, BACK.z);
    const back = new THREE.Group();
    const backBtn = new THREE.Mesh(extrudeUp(new THREE.Shape().absarc(0, 0, BACK.r, 0, Math.PI * 2), 1.9, { bevel: 0.6 }), this.mats.back);
    back.add(backBtn);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.32, 8, 24, Math.PI * 1.25), this.mats.glyph);
    arc.rotation.x = -Math.PI / 2;
    arc.rotation.z = -Math.PI * 0.15;
    arc.position.y = 1.95;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.3, 12), this.mats.glyph);
    tip.rotation.z = Math.PI / 2;
    tip.position.set(-1.0, 1.95, -1.3);
    back.add(arc, tip);
    place(back, BACK.x, top, BACK.z);
    this.group.add(back);
    this.registerKey('back', back, [backBtn]);
  }

  registerKey(key, group, meshes) {
    meshes.forEach((m) => { m.userData.key = key; this.hitTargets.push(m); });
    this.keys[key] = { group, baseY: group.position.y, offset: 0, target: 0, extra: [] };
  }

  buildEdges() {
    const g = this.group;
    // IR window on the top edge (left), flush with the flat part of the side
    const ir = new THREE.Mesh(new RoundedBoxGeometry(15, 7.5, 1.2, 3, 1), this.mats.ir);
    ir.position.set(-33, H * 0.62, -W / 2 + 0.25);
    g.add(ir);
    // GPIO header: recessed slot with 18 gold pins sticking out
    const slotLen = GPIO.pins * GPIO.pitch + 2;
    const slot = new THREE.Mesh(new RoundedBoxGeometry(slotLen, 4.2, 1.4, 2, 0.5), this.mats.dark);
    slot.position.set(GPIO.x, GPIO.y, -W / 2 + 0.4);
    g.add(slot);
    const pin = new THREE.BoxGeometry(0.64, 0.64, 6.5);
    this.pins = new THREE.InstancedMesh(pin, this.mats.gold, GPIO.pins);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < GPIO.pins; i++) {
      mtx.makeTranslation(GPIO.x + (i - (GPIO.pins - 1) / 2) * GPIO.pitch, GPIO.y, -W / 2 - 1.5);
      this.pins.setMatrixAt(i, mtx);
    }
    g.add(this.pins);
    // USB-C on the left end
    const usb = new THREE.Mesh(new RoundedBoxGeometry(1.4, 3.4, 9.2, 3, 1.5), this.mats.dark);
    usb.position.set(-L / 2 + 0.3, H * 0.33, 6);
    g.add(usb);
    const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 6.6), this.mats.metal);
    tongue.position.set(-L / 2, H * 0.33, 6);
    g.add(tongue);
    // microSD slot on the bottom edge
    const sd = new THREE.Mesh(new RoundedBoxGeometry(13, 1.4, 1, 2, 0.4), this.mats.dark);
    sd.position.set(-30, H * 0.25, W / 2 - 0.1);
    g.add(sd);
    // Lanyard post on the right end
    const lan = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.7, 10, 28), this.mats.dark);
    lan.position.set(L / 2 - 0.4, H * 0.62, -10);
    lan.rotation.y = Math.PI / 2;
    g.add(lan);
  }

  // Board, battery and chips: only drawn when the shell is see-through.
  buildInternals() {
    const it = new THREE.Group();
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(90, 1.2, 32),
      [this.mats.dark, this.mats.dark, new THREE.MeshStandardMaterial({ map: pcbTexture(90, 32, { label: 'iF-ZERO  REV 1.2' }), roughness: 0.5 }),
        this.mats.dark, this.mats.dark, this.mats.dark]);
    pcb.position.y = H * 0.55;
    it.add(pcb);
    const chip = (w, d, h, x, z, mat = this.mats.dark) => {
      const c = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 1, 0.3), mat);
      c.position.set(x, H * 0.55 + 0.6 + h / 2, z);
      it.add(c);
    };
    chip(9, 9, 1.2, 8, -4);          // MCU
    chip(11, 11, 2.2, -2, 9, this.mats.metal); // radio shield can
    chip(5, 5, 1, 20, 10);
    chip(6, 3, 1, -8, -10);
    chip(4, 4, 0.9, 33, -10);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(10, 0.5, 8, 48), new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 1, roughness: 0.35 }));
    coil.rotation.x = Math.PI / 2;
    coil.scale.set(2.2, 1, 1);
    coil.position.y = H * 0.55 - 1.2;
    it.add(coil);
    const battery = new THREE.Mesh(new RoundedBoxGeometry(52, 6, 30, 3, 2.5),
      new THREE.MeshStandardMaterial({ color: 0xbfc3c9, metalness: 0.85, roughness: 0.38 }));
    battery.position.set(-4, 6, 0);
    it.add(battery);
    it.visible = false;
    this.internals = it;
    this.group.add(it);
  }

  // -- customisation -------------------------------------------------------

  apply(look) {
    const b = look.body || DEFAULT_LOOK.body;
    const m = this.mats;
    m.shell.color.set(b.color);
    const clear = b.finish === 'clear';
    m.shell.transmission = clear ? 0.96 : 0;
    m.shell.thickness = clear ? 2.5 : 0;
    m.shell.ior = 1.49;
    m.shell.roughness = clear ? 0.08 : b.finish === 'matte' ? 0.75 : 0.32;
    m.shell.clearcoat = b.finish === 'gloss' || clear ? 0.8 : 0.05;
    m.shell.attenuationColor = new THREE.Color(b.color);
    m.shell.attenuationDistance = clear ? 60 : Infinity;
    m.shell.needsUpdate = true;
    this.internals.visible = clear;
    m.accent.color.set(look.accent || DEFAULT_LOOK.accent);
    m.accent.transmission = clear ? 0.9 : 0;
    m.accent.thickness = clear ? 1.5 : 0;
    m.accent.roughness = clear ? 0.12 : 0.5;
    m.accent.needsUpdate = true;
    const bt = look.buttons || DEFAULT_LOOK.buttons;
    m.dpad.color.set(bt.dpad);
    m.ok.color.set(bt.ok);
    m.back.color.set(bt.back);
    this.backlight.set((look.screen || DEFAULT_LOOK.screen).backlight);
    this.redraw();
  }

  // -- input feedback --------------------------------------------------------

  pressVisual(key, down) {
    const k = this.keys[key];
    if (k) k.target = down ? -KEY_TRAVEL : 0;
    if (this.onKeyVisual) this.onKeyVisual(key, down);
  }

  // Returns true while any key is still moving.
  animateKeys(dt) {
    let moving = false;
    for (const k of Object.values(this.keys)) {
      const d = k.target - k.offset;
      if (Math.abs(d) > 0.005) {
        k.offset += d * Math.min(1, dt * 30);
        moving = true;
      } else k.offset = k.target;
      k.group.position.y = k.baseY + k.offset;
      for (const e of k.extra) e.position.y = e.userData.baseY + k.offset * 0.6;
    }
    return moving;
  }

  setLed(color, intensity) {
    this.mats.led.emissive.set(color);
    this.mats.led.emissiveIntensity = intensity;
  }
}

// Render text lines to a crisp 1-bit 128x64 bitmap.
const textCache = new Map();
function textBits(lines) {
  const key = lines.join('\n');
  if (textCache.has(key)) return textCache.get(key);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = 64 / (lines.length + 1);
  lines.forEach((t, i) => {
    g.font = i === 0 ? 'bold 12px "Segoe UI", Arial, sans-serif' : '10px "Segoe UI", Arial, sans-serif';
    g.fillText(t, 64, lh * (i + 1));
  });
  const a = g.getImageData(0, 0, 128, 64).data;
  const bits = new Uint8Array(128 * 64);
  for (let i = 0; i < bits.length; i++) bits[i] = a[i * 4 + 3] > 110 ? 1 : 0;
  textCache.set(key, bits);
  return bits;
}
