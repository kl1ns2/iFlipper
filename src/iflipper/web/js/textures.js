// Procedural canvas textures for the desk: nothing to download, rendered once at start.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Small deterministic PRNG so the desk looks the same on every launch.
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

export function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Seamless-ish wooden desk tile (planks run horizontally).
export function woodCanvas() {
  const W = 1024, H = 1024, r = rng(7);
  const [c, g] = canvas(W, H);
  const base = g.createLinearGradient(0, 0, W, 0);
  base.addColorStop(0, '#5a3a22');
  base.addColorStop(0.5, '#6b4529');
  base.addColorStop(1, '#5a3a22');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const planks = 4;
  for (let p = 0; p < planks; p++) {
    const y0 = (p * H) / planks;
    g.fillStyle = `rgba(${40 + r() * 30},${22 + r() * 18},${10 + r() * 10},${0.15 + r() * 0.15})`;
    g.fillRect(0, y0, W, H / planks);
    for (let i = 0; i < 140; i++) {
      const y = y0 + r() * (H / planks);
      const amp = 2 + r() * 6, freq = (2 * Math.PI * (1 + Math.floor(r() * 4))) / W, ph = r() * 10;
      g.strokeStyle = `rgba(${r() < 0.5 ? '30,16,6' : '120,80,48'},${0.08 + r() * 0.18})`;
      g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const yy = y + Math.sin(x * freq + ph) * amp;
        x ? g.lineTo(x, yy) : g.moveTo(x, yy);
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(20,10,4,0.75)';
    g.fillRect(0, y0, W, 3);
  }
  return c;
}

// A silicone soldering / repair mat seen from straight above.
export const MAT = { w: 360, h: 240 };
export const WORK = { x: 24, y: 22, w: 230, h: 196 }; // gridded work area, mm

export function matCanvas(S = 6, color = '#2f5262') {
  const W = Math.round(MAT.w * S), H = Math.round(MAT.h * S);
  const [c, g] = canvas(W, H);
  const r = rng(3);
  g.fillStyle = color;
  rr(g, 0, 0, W, H, 4 * S);
  g.fill();
  g.save();
  rr(g, 0, 0, W, H, 4 * S);
  g.clip();
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.035})`;
    g.fillRect(r() * W, r() * H, 1.5, 1.5);
  }
  const mm = (v) => v * S;
  const ink = 'rgba(232,240,245,0.55)', inkSoft = 'rgba(232,240,245,0.16)';
  const gx0 = mm(WORK.x), gy0 = mm(WORK.y), gx1 = mm(WORK.x + WORK.w), gy1 = mm(WORK.y + WORK.h);
  g.strokeStyle = inkSoft;
  g.lineWidth = 1;
  for (let x = gx0; x <= gx1 + 0.5; x += mm(10)) { g.beginPath(); g.moveTo(x, gy0); g.lineTo(x, gy1); g.stroke(); }
  for (let y = gy0; y <= gy1 + 0.5; y += mm(10)) { g.beginPath(); g.moveTo(gx0, y); g.lineTo(gx1, y); g.stroke(); }
  g.strokeStyle = ink;
  g.lineWidth = 2;
  g.strokeRect(gx0, gy0, gx1 - gx0, gy1 - gy0);

  // Rulers
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.font = `${mm(3.2)}px "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'center';
  for (let i = 0; i <= WORK.w; i++) {
    const x = gx0 + mm(i), len = i % 10 === 0 ? 5 : i % 5 === 0 ? 3.5 : 2;
    g.lineWidth = i % 10 === 0 ? 1.6 : 1;
    g.beginPath(); g.moveTo(x, gy1 + mm(2)); g.lineTo(x, gy1 + mm(2 + len)); g.stroke();
    if (i % 10 === 0) g.fillText(String(i / 10), x, gy1 + mm(11.5));
  }
  g.textAlign = 'right';
  for (let i = 0; i <= WORK.h; i++) {
    const y = gy1 - mm(i), len = i % 10 === 0 ? 5 : i % 5 === 0 ? 3.5 : 2;
    g.lineWidth = i % 10 === 0 ? 1.6 : 1;
    g.beginPath(); g.moveTo(gx0 - mm(2), y); g.lineTo(gx0 - mm(2 + len), y); g.stroke();
    if (i % 10 === 0 && i) g.fillText(String(i / 10), gx0 - mm(8.5), y + mm(1.2));
  }
  g.textAlign = 'left';
  g.font = `600 ${mm(4.2)}px "Segoe UI", Arial, sans-serif`;
  g.fillText('iFLIPPER  LAB', gx0, gy0 - mm(8));
  g.font = `${mm(3)}px "Segoe UI", Arial, sans-serif`;
  g.fillStyle = 'rgba(232,240,245,0.4)';
  g.fillText('SILICONE REPAIR MAT  ·  500°C  ·  ANTI-STATIC', gx0 + mm(42), gy0 - mm(8));

  // Recessed screw trays: light from the top-left, so the top-left inner edge is in shadow
  const recess = (x, y, w, h, rad, label) => {
    const grad = g.createLinearGradient(x, y, x + w * 0.4, y + h);
    grad.addColorStop(0, 'rgba(0,0,0,0.45)');
    grad.addColorStop(0.3, 'rgba(0,0,0,0.2)');
    grad.addColorStop(1, 'rgba(255,255,255,0.06)');
    g.fillStyle = grad;
    rr(g, x, y, w, h, rad); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 1.5;
    rr(g, x + 1, y + 1, w, h, rad); g.stroke();
    if (label) {
      g.fillStyle = 'rgba(232,240,245,0.45)';
      g.font = `${mm(2.6)}px "Segoe UI", Arial, sans-serif`;
      g.fillText(label, x + mm(1.5), y - mm(1.3));
    }
  };
  let n = 1;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) recess(mm(270 + col * 28), mm(26 + row * 28), mm(22), mm(18), mm(3), String(n++).padStart(2, '0'));
  }
  recess(mm(270), mm(144), mm(78), mm(30), mm(5), 'PARTS');
  recess(mm(270), mm(188), mm(78), mm(30), mm(5), 'SCREWS');
  g.restore();
  return c;
}
