// Procedural canvas textures: nothing to download, everything stays crisp.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Small deterministic PRNG so the scene looks the same on every launch.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tex(c, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

export function woodTextures() {
  const W = 1024, H = 1024, r = rng(7);
  const [c, g] = canvas(W, H);
  const [rc, rg] = canvas(W, H);
  const base = g.createLinearGradient(0, 0, W, 0);
  base.addColorStop(0, '#5a3a22');
  base.addColorStop(0.5, '#6b4529');
  base.addColorStop(1, '#583820');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  rg.fillStyle = '#9a9a9a';
  rg.fillRect(0, 0, W, H);
  // Planks
  const planks = 4;
  for (let p = 0; p < planks; p++) {
    const y0 = (p * H) / planks;
    g.fillStyle = `rgba(${40 + r() * 30},${22 + r() * 18},${10 + r() * 10},${0.15 + r() * 0.15})`;
    g.fillRect(0, y0, W, H / planks);
    // grain
    for (let i = 0; i < 140; i++) {
      const y = y0 + r() * (H / planks);
      const amp = 2 + r() * 6, freq = 0.002 + r() * 0.01, ph = r() * 10;
      g.strokeStyle = `rgba(${r() < 0.5 ? '30,16,6' : '120,80,48'},${0.08 + r() * 0.18})`;
      g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const yy = y + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph) * amp * 0.3;
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
    }
    // knot
    if (r() < 0.7) {
      const kx = r() * W, ky = y0 + (0.3 + r() * 0.4) * (H / planks);
      for (let k = 0; k < 12; k++) {
        g.strokeStyle = `rgba(35,18,8,${0.25 - k * 0.018})`;
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(kx, ky, 6 + k * 7, 3 + k * 2.2, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // seam between planks
    g.fillStyle = 'rgba(20,10,4,0.75)';
    g.fillRect(0, y0, W, 3);
    rg.fillStyle = '#d0d0d0';
    rg.fillRect(0, y0, W, 3);
  }
  return { map: tex(c, { repeat: [3, 3] }), roughnessMap: tex(rc, { srgb: false, repeat: [3, 3] }) };
}

// A silicone soldering / repair mat, 450 x 300 mm.
export const MAT = { w: 450, h: 300 };

export function matTextures(color = '#35596b') {
  const S = 4.4; // px per mm
  const W = Math.round(MAT.w * S), H = Math.round(MAT.h * S);
  const [c, g] = canvas(W, H);
  const [bc, bg] = canvas(W, H); // bump: white = high
  const r = rng(3);
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  bg.fillStyle = '#fff';
  bg.fillRect(0, 0, W, H);
  // subtle silicone speckle
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.035})`;
    g.fillRect(r() * W, r() * H, 1.5, 1.5);
  }
  const mm = (v) => v * S;
  const ink = 'rgba(232,240,245,0.55)', inkSoft = 'rgba(232,240,245,0.18)';

  // Work area grid (left part)
  const gx0 = mm(28), gy0 = mm(26), gx1 = mm(300), gy1 = mm(274);
  g.strokeStyle = inkSoft;
  g.lineWidth = 1;
  for (let x = gx0; x <= gx1 + 0.5; x += mm(10)) { g.beginPath(); g.moveTo(x, gy0); g.lineTo(x, gy1); g.stroke(); }
  for (let y = gy0; y <= gy1 + 0.5; y += mm(10)) { g.beginPath(); g.moveTo(gx0, y); g.lineTo(gx1, y); g.stroke(); }
  g.strokeStyle = ink;
  g.lineWidth = 2;
  g.strokeRect(gx0, gy0, gx1 - gx0, gy1 - gy0);

  // Rulers along the bottom and left edge
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.font = `${mm(3.2)}px "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'center';
  for (let i = 0; i <= 270; i++) {
    const x = gx0 + mm(i);
    const len = i % 10 === 0 ? 5 : i % 5 === 0 ? 3.5 : 2;
    g.lineWidth = i % 10 === 0 ? 1.6 : 1;
    g.beginPath(); g.moveTo(x, gy1 + mm(2)); g.lineTo(x, gy1 + mm(2 + len)); g.stroke();
    if (i % 10 === 0) g.fillText(String(i / 10), x, gy1 + mm(11.5));
  }
  g.textAlign = 'right';
  for (let i = 0; i <= 240; i++) {
    const y = gy1 - mm(i);
    if (y < gy0) break;
    const len = i % 10 === 0 ? 5 : i % 5 === 0 ? 3.5 : 2;
    g.lineWidth = i % 10 === 0 ? 1.6 : 1;
    g.beginPath(); g.moveTo(gx0 - mm(2), y); g.lineTo(gx0 - mm(2 + len), y); g.stroke();
    if (i % 10 === 0 && i) g.fillText(String(i / 10), gx0 - mm(8.5), y + mm(1.2));
  }
  g.save();
  g.textAlign = 'left';
  g.font = `600 ${mm(4.2)}px "Segoe UI", Arial, sans-serif`;
  g.fillStyle = ink;
  g.fillText('iFLIPPER  LAB', gx0, gy0 - mm(8));
  g.font = `${mm(3)}px "Segoe UI", Arial, sans-serif`;
  g.fillStyle = 'rgba(232,240,245,0.4)';
  g.fillText('SILICONE REPAIR MAT  ·  HEAT RESISTANT 500°C  ·  ANTI-STATIC', gx0 + mm(42), gy0 - mm(8));
  g.restore();

  // Screw trays (right part): rows of recessed numbered pockets
  const recess = (x, y, w, h, rad, label) => {
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(0.25, 'rgba(0,0,0,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0.05)');
    g.fillStyle = grad;
    rr(g, x, y, w, h, rad); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1.5;
    rr(g, x, y, w, h, rad); g.stroke();
    bg.fillStyle = '#6a6a6a';
    rr(bg, x, y, w, h, rad); bg.fill();
    if (label) {
      g.fillStyle = 'rgba(232,240,245,0.45)';
      g.textAlign = 'left';
      g.font = `${mm(2.6)}px "Segoe UI", Arial, sans-serif`;
      g.fillText(label, x + mm(1.5), y - mm(1.3));
    }
  };
  let n = 1;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 4; col++) {
      recess(mm(318 + col * 30), mm(30 + row * 30), mm(24), mm(20), mm(3), String(n++).padStart(2, '0'));
    }
  }
  recess(mm(318), mm(186), mm(114), mm(36), mm(5), 'PARTS');
  recess(mm(318), mm(236), mm(54), mm(38), mm(5), 'SCREWS');
  recess(mm(378), mm(236), mm(54), mm(38), mm(5), 'CABLES');
  // Magnet area hint
  g.strokeStyle = 'rgba(232,240,245,0.3)';
  g.setLineDash([mm(2), mm(2)]);
  g.lineWidth = 1.5;
  rr(g, mm(150), mm(196), mm(140), mm(68), mm(6)); g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(232,240,245,0.35)';
  g.font = `${mm(2.8)}px "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'left';
  g.fillText('MAGNETIC ZONE', mm(154), mm(260));

  const map = tex(c);
  const bumpMap = tex(bc, { srgb: false });
  return { map, bumpMap, pxPerMm: S };
}

export function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Printed circuit board: solder mask colour, traces, pads and silkscreen text.
export function pcbTexture(w, h, { mask = '#1b1d1f', silk = '#e8e8e8', label = '', seed = 5 } = {}) {
  const S = 10, W = Math.round(w * S), H = Math.round(h * S), r = rng(seed);
  const [c, g] = canvas(W, H);
  g.fillStyle = mask;
  g.fillRect(0, 0, W, H);
  // copper traces under the mask: slightly lighter
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    g.lineWidth = 2 + r() * 4;
    let x = r() * W, y = r() * H;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      if (r() < 0.5) x += (r() - 0.5) * W * 0.6; else y += (r() - 0.5) * H * 0.6;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // vias & pads
  for (let i = 0; i < 120; i++) {
    g.fillStyle = r() < 0.5 ? '#c9a24a' : 'rgba(0,0,0,0.5)';
    g.beginPath(); g.arc(r() * W, r() * H, 3 + r() * 3, 0, Math.PI * 2); g.fill();
  }
  if (label) {
    g.fillStyle = silk;
    g.font = `bold ${Math.round(H * 0.09)}px "Segoe UI", Arial, sans-serif`;
    g.textAlign = 'left';
    g.fillText(label, W * 0.06, H * 0.93);
  }
  g.strokeStyle = silk;
  g.lineWidth = 3;
  g.strokeRect(6, 6, W - 12, H - 12);
  return tex(c);
}

// Silkscreen-style label as a transparent texture.
export function labelTexture(text, { color = '#fff', px = 64, weight = 600, font = '"Segoe UI", Arial' } = {}) {
  const [m] = canvas(1, 1);
  const mg = m.getContext('2d');
  mg.font = `${weight} ${px}px ${font}`;
  const w = Math.ceil(mg.measureText(text).width) + 8;
  const [c, g] = canvas(w, Math.ceil(px * 1.3));
  g.font = `${weight} ${px}px ${font}`;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 4, c.height / 2);
  const t = tex(c);
  t.userData = { aspect: c.width / c.height };
  return t;
}
