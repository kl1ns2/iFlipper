// The Flipper Zero seen from straight above, drawn as SVG in millimetres (100 × 40).
// Proportions follow the real device; the artwork itself is our own.

export const L = 100, W = 40;

// Outline, clockwise from the top-left of the top (GPIO) edge. Per-vertex corner radii.
const OUTLINE = [[14, 0], [85, 0], [100, 15], [100, 40], [8, 40], [0, 31], [0, 23]];
const RADII = [3, 3.5, 3.5, 6, 3, 2.5, 2.5];
export const SCREEN = { x: 19, y: 5.4, w: 38.4, h: 23.2, r: 3.2 };
export const LCD = { x: 21.6, y: 8.6, w: 33.2, h: 16.6 }; // the 128×64 pixel area
const DPAD = { x: 72, y: 16, r: 11.8, ok: 3.9 };
const BACK = { x: 88.2, y: 23.4, r: 3.5 };
const LED = { x: 60.6, y: 26.6 };
const GPIO = { x0: 22, x1: 80 };

export const MODULES = {
  none: { name: 'Без модуля' },
  wifi: { name: 'Wi-Fi Devboard', sub: 'ESP32-S2', antenna: true },
  cc1101: { name: 'CC1101 Sub-GHz', sub: 'внешний радиомодуль', antenna: true },
  nrf24: { name: 'NRF24 + PA/LNA', sub: '2.4 ГГц', antenna: true },
  game: { name: 'Game Module', sub: 'RP2040 + IMU', antenna: false },
};

// -- geometry ----------------------------------------------------------------

function inset(pts, d) {
  const n = pts.length;
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len; // inward for a clockwise outline (y down)
    return [[p[0] + nx * d, p[1] + ny * d], [dx, dy]];
  });
  return lines.map((l, i) => intersect(lines[(i - 1 + n) % n], l));
}

function intersect([p, r], [q, s]) {
  const cross = r[0] * s[1] - r[1] * s[0];
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / cross;
  return [p[0] + r[0] * t, p[1] + r[1] * t];
}

function rounded(pts, radii) {
  const n = pts.length;
  let d = '';
  pts.forEach((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const r = Array.isArray(radii) ? radii[i] : radii;
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, da / 2), rb = Math.min(r, db / 2);
    const p1 = [p[0] + ((a[0] - p[0]) * ra) / da, p[1] + ((a[1] - p[1]) * ra) / da];
    const p2 = [p[0] + ((b[0] - p[0]) * rb) / db, p[1] + ((b[1] - p[1]) * rb) / db];
    d += `${i ? 'L' : 'M'}${f(p1[0])} ${f(p1[1])}Q${f(p[0])} ${f(p[1])} ${f(p2[0])} ${f(p2[1])}`;
  });
  return d + 'Z';
}

// Convex hull of two circles: the recessed pocket around the d-pad and Back button.
function hull2(c1, c2) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y, d = Math.hypot(dx, dy);
  const th = Math.atan2(dy, dx), ph = Math.acos((c1.r - c2.r) / d);
  const pt = (c, a) => `${f(c.x + c.r * Math.cos(a))} ${f(c.y + c.r * Math.sin(a))}`;
  return `M${pt(c1, th + ph)}A${c1.r} ${c1.r} 0 1 1 ${pt(c1, th - ph)}L${pt(c2, th - ph)}A${c2.r} ${c2.r} 0 0 1 ${pt(c2, th + ph)}Z`;
}

function sector(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  return `M${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

const f = (v) => Math.round(v * 100) / 100;
const rrect = (x, y, w, h, r) => `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;

export const BODY_PATH = rounded(OUTLINE, RADII);

// USB-C cable plugged into the right end, running off the mat.
const USB_CABLE = `
  <path d="M120 31.2C150 31 168 44 182 78S214 170 300 210" fill="none" stroke="#141518" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M120 30.4C149 30.2 166 43 180.6 77.4S212 168 300 208.6" fill="none" stroke="#3b3e45" stroke-width=".7" stroke-linecap="round" opacity=".8"/>
  <rect x="99" y="28.7" width="12.5" height="5" rx="1.2" fill="#c9cdd2"/>
  <rect x="99" y="28.7" width="12.5" height="1.4" rx=".7" fill="#eef0f2" opacity=".8"/>
  <rect x="110" y="27.6" width="12" height="7.2" rx="2.2" fill="#1d1e22"/>
  <rect x="110.6" y="28.1" width="10.8" height="2" rx="1" fill="#3b3e45" opacity=".7"/>`;
const TOP_PATH = rounded(inset(OUTLINE, 1.9), RADII.map((r) => Math.max(r - 1.4, 1.2)));
const POCKET = hull2({ x: DPAD.x, y: DPAD.y, r: DPAD.r + 2.6 }, { x: BACK.x, y: BACK.y, r: BACK.r + 2.1 });
const DIRS = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

// -- colour helpers ------------------------------------------------------------

function mix(hex, other, t) {
  const a = parse(hex), b = parse(other);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function parse(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const dark = (c, t) => mix(c, '#000000', t);
const light = (c, t) => mix(c, '#ffffff', t);
const luma = (c) => { const [r, g, b] = parse(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

// -- SVG ------------------------------------------------------------------------

let uid = 0;

export function deviceSVG(look, { cable = false } = {}) {
  const id = `d${++uid}`;
  const b = look.body, bt = look.buttons;
  const clear = b.finish === 'clear';
  const body = b.color;
  const ink = look.accent;
  const gloss = b.finish === 'matte' ? 0.18 : 0.42;
  const keyPad = (key, shape, color, extra = '') =>
    `<g class="key" data-key="${key}">${shape(color)}${extra}</g>`;

  const dpadDisc = (c) => `
    <circle cx="${DPAD.x}" cy="${DPAD.y}" r="${DPAD.r}" fill="url(#${id}-dpad)"/>
    <circle cx="${DPAD.x}" cy="${DPAD.y}" r="${DPAD.r - 0.25}" fill="none" stroke="${light(c, 0.35)}" stroke-opacity=".5" stroke-width=".35"/>`;
  const arrows = Object.entries(DIRS).map(([k, a]) => {
    const r = 8.4, cx = DPAD.x + Math.cos(a) * r, cy = DPAD.y + Math.sin(a) * r;
    const t = (rr, aa) => `${f(cx + rr * Math.cos(a + aa))} ${f(cy + rr * Math.sin(a + aa))}`;
    return `<path d="M${t(1.1, 0)}L${t(1.1, 2.3)}L${t(1.1, -2.3)}Z" fill="${dark(bt.dpad, 0.3)}" opacity=".75"/>`;
  }).join('');
  const sectors = Object.entries(DIRS).map(([k, a]) =>
    `<path class="hit" data-key="${k}" d="${sector(DPAD.x, DPAD.y, DPAD.ok + 0.9, DPAD.r, a - Math.PI / 4, a + Math.PI / 4)}"/>`).join('');

  return `
<svg class="fz" viewBox="0 0 ${L} ${W}" xmlns="http://www.w3.org/2000/svg" overflow="visible">
  <defs>
    <linearGradient id="${id}-shell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${light(body, 0.18)}"/>
      <stop offset="1" stop-color="${dark(body, 0.06)}"/>
    </linearGradient>
    <linearGradient id="${id}-side" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="${light(body, 0.3)}"/>
      <stop offset="1" stop-color="${dark(body, 0.2)}"/>
    </linearGradient>
    <radialGradient id="${id}-gloss" cx=".25" cy=".1" r=".9">
      <stop offset="0" stop-color="#fff" stop-opacity="${gloss}"/>
      <stop offset=".6" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-dpad" cx=".38" cy=".32" r=".8">
      <stop offset="0" stop-color="${light(bt.dpad, 0.22)}"/>
      <stop offset=".75" stop-color="${bt.dpad}"/>
      <stop offset="1" stop-color="${dark(bt.dpad, 0.18)}"/>
    </radialGradient>
    <radialGradient id="${id}-ok" cx=".38" cy=".32" r=".8">
      <stop offset="0" stop-color="${light(bt.ok, 0.25)}"/>
      <stop offset="1" stop-color="${dark(bt.ok, 0.12)}"/>
    </radialGradient>
    <radialGradient id="${id}-back" cx=".38" cy=".32" r=".8">
      <stop offset="0" stop-color="${light(bt.back, 0.25)}"/>
      <stop offset="1" stop-color="${dark(bt.back, 0.15)}"/>
    </radialGradient>
    <linearGradient id="${id}-pocket" x1="0" y1="0" x2=".4" y2="1">
      <stop offset="0" stop-color="${dark(body, 0.16)}"/>
      <stop offset=".5" stop-color="${dark(body, 0.04)}"/>
      <stop offset="1" stop-color="${light(body, 0.25)}"/>
    </linearGradient>
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".16"/>
      <stop offset=".45" stop-color="#fff" stop-opacity=".03"/>
      <stop offset=".46" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="${id}-clip"><path d="${BODY_PATH}"/></clipPath>
  </defs>
  ${moduleSVG(look)}
  ${cable ? USB_CABLE : ''}
  ${clear ? internals(id) : ''}
  <g opacity="${clear ? 0.5 : 1}">
    <path d="${BODY_PATH}" fill="url(#${id}-side)"/>
    <path d="${TOP_PATH}" fill="url(#${id}-shell)"/>
    <path d="${TOP_PATH}" fill="none" stroke="${light(body, 0.55)}" stroke-width=".35" stroke-opacity=".8"/>
  </g>
  <path d="${BODY_PATH}" fill="none" stroke="${dark(body, 0.35)}" stroke-width=".3" stroke-opacity=".6"/>
  <path d="${POCKET}" fill="url(#${id}-pocket)" opacity="${clear ? 0.55 : 1}"/>
  <path d="${POCKET}" fill="none" stroke="${dark(body, 0.25)}" stroke-width=".25" stroke-opacity=".5"/>
  <circle cx="${DPAD.x}" cy="${DPAD.y}" r="${DPAD.r + 0.7}" fill="${dark(body, 0.3)}" opacity=".35"/>
  <path d="${rrect(SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h, SCREEN.r)}" fill="#151516"/>
  <path d="${rrect(SCREEN.x + 0.35, SCREEN.y + 0.35, SCREEN.w - 0.7, SCREEN.h - 0.7, SCREEN.r - 0.3)}" fill="none" stroke="#3a3b3e" stroke-width=".3"/>
  <rect class="backlight" x="${LCD.x - 1.2}" y="${LCD.y - 1.6}" width="${LCD.w + 2.4}" height="${LCD.h + 3.2}" rx=".8" fill="${look.screen.backlight}"/>
  <g class="pad-group" data-pad="dpad">${dpadDisc(bt.dpad)}${arrows}</g>
  <g class="key-ok">
    <circle cx="${DPAD.x}" cy="${DPAD.y}" r="${DPAD.ok + 0.75}" fill="${dark(bt.dpad, 0.28)}" opacity=".55"/>
    <circle class="okcap" cx="${DPAD.x}" cy="${DPAD.y}" r="${DPAD.ok}" fill="url(#${id}-ok)"/>
  </g>
  <g class="key-back">
    <circle cx="${BACK.x}" cy="${BACK.y}" r="${BACK.r + 0.6}" fill="${dark(body, 0.3)}" opacity=".35"/>
    <circle class="backcap" cx="${BACK.x}" cy="${BACK.y}" r="${BACK.r}" fill="url(#${id}-back)"/>
    <path d="M${BACK.x - 1.4} ${BACK.y - 0.7}h1.6a1.25 1.25 0 0 1 0 2.5h-1.2" fill="none" stroke="${dark(bt.back, 0.42)}" stroke-width=".42" stroke-linecap="round"/>
    <path d="M${BACK.x - 0.5} ${BACK.y - 1.55}l-1.05 .85l1.05 .85" fill="none" stroke="${dark(bt.back, 0.42)}" stroke-width=".42" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <circle class="led" cx="${LED.x}" cy="${LED.y}" r=".62" fill="#2a2b2e"/>
  <text x="${31}" y="${37.3}" font-family="'Segoe UI', Arial, sans-serif" font-weight="800" font-style="italic" font-size="4.6" letter-spacing=".9" fill="${ink}" opacity=".95">iFlipper</text>
  <rect x="55" y="39.15" width="9" height=".5" rx=".25" fill="${dark(body, 0.55)}"/>
  <rect x="99.45" y="28" width=".55" height="6.5" rx=".25" fill="${dark(body, 0.6)}"/>
  <path d="M96.6 40.2q1.6 .9 3.2 -.2" fill="none" stroke="${ink}" stroke-width=".9" stroke-linecap="round"/>
  <g class="hits">
    ${sectors}
    <circle class="hit" data-key="ok" cx="${DPAD.x}" cy="${DPAD.y}" r="${DPAD.ok + 0.8}"/>
    <circle class="hit" data-key="back" cx="${BACK.x}" cy="${BACK.y}" r="${BACK.r + 0.8}"/>
  </g>
</svg>`;
}

// Glass glare over the screen and the case, drawn above the LCD canvas.
export function overlaySVG(look) {
  const id = `o${++uid}`;
  const c = look.case;
  return `
<svg class="fz-over" viewBox="0 0 ${L} ${W}" xmlns="http://www.w3.org/2000/svg" overflow="visible">
  <defs>
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".18"/>
      <stop offset=".42" stop-color="#fff" stop-opacity=".04"/>
      <stop offset=".43" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="${rrect(SCREEN.x + 0.5, SCREEN.y + 0.5, SCREEN.w - 1, SCREEN.h - 1, SCREEN.r - 0.4)}" fill="url(#${id}-glass)" pointer-events="none"/>
  ${c && c.type !== 'none' ? caseSVG(c, look, id) : ''}
</svg>`;
}

// -- cases ------------------------------------------------------------------------

const CASE_OUT = rounded(inset(OUTLINE, -2.2), RADII.map((r) => r + 2));

function caseSVG(c, look, id) {
  const clear = c.material === 'clear';
  const col = c.color;
  const op = clear ? 0.42 : 1;
  const edge = `<path d="${CASE_OUT}" fill="none" stroke="${light(col, 0.4)}" stroke-width=".35" stroke-opacity=".7"/>`;
  const defs = `
    <defs>
      <linearGradient id="${id}-case" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${light(col, clear ? 0.5 : 0.14)}"/>
        <stop offset="1" stop-color="${dark(col, 0.12)}"/>
      </linearGradient>
      <radialGradient id="${id}-pillow" cx=".38" cy=".32" r=".8">
        <stop offset="0" stop-color="${light(col, 0.3)}"/>
        <stop offset="1" stop-color="${dark(col, 0.12)}"/>
      </radialGradient>
    </defs>`;
  if (c.type === 'half') {
    // A bumper around the edge plus a sleeve over the lower half of the face.
    const band = `M-2.2 30.6H102.2V42.2H-2.2Z`; // below the screen and buttons
    return `${defs}<clipPath id="${id}-cclip"><path d="${CASE_OUT}"/></clipPath>
    <g opacity="${op}" pointer-events="none">
      <path d="${CASE_OUT} ${BODY_PATH}" fill="url(#${id}-case)" fill-rule="evenodd"/>
      <path d="${band}" fill="url(#${id}-case)" clip-path="url(#${id}-cclip)"/>
      <path d="M-2 30.8H102" stroke="${light(col, 0.45)}" stroke-width=".5" stroke-opacity=".8"/>
      <path d="M-2 31.4H102" stroke="${dark(col, 0.3)}" stroke-width=".4" stroke-opacity=".5"/>
      ${edge}
    </g>`;
  }
  // Full case: everything covered except the screen; buttons become silicone pillows.
  const win = rrect(SCREEN.x - 0.4, SCREEN.y - 0.4, SCREEN.w + 0.8, SCREEN.h + 0.8, SCREEN.r + 0.3);
  const pillow = (key, cx, cy, r) => `
    <g class="pillow" data-key="${key}">
      <circle cx="${cx}" cy="${cy}" r="${r + 0.5}" fill="${dark(col, 0.25)}" opacity=".45"/>
      <circle class="cap" cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-pillow)"/>
    </g>`;
  const arrows = Object.values(DIRS).map((a) => {
    const r = 8.4, cx = DPAD.x + Math.cos(a) * r, cy = DPAD.y + Math.sin(a) * r;
    const t = (rr, aa) => `${f(cx + rr * Math.cos(a + aa))} ${f(cy + rr * Math.sin(a + aa))}`;
    return `<path d="M${t(1.1, 0)}L${t(1.1, 2.3)}L${t(1.1, -2.3)}Z" fill="${dark(col, 0.3)}"/>`;
  }).join('');
  return `${defs}<g opacity="${op}">
    <path d="${CASE_OUT} ${win}" fill="url(#${id}-case)" fill-rule="evenodd" pointer-events="none"/>
    <path d="${win}" fill="none" stroke="${dark(col, 0.35)}" stroke-width=".4" pointer-events="none"/>
    ${edge}
    <g class="pillow-dpad">${pillow('dpad', DPAD.x, DPAD.y, DPAD.r + 0.6)}${arrows}</g>
    ${pillow('ok', DPAD.x, DPAD.y, DPAD.ok + 0.4)}
    ${pillow('back', BACK.x, BACK.y, BACK.r + 0.5)}
    <text x="31" y="37.3" font-family="'Segoe UI', Arial, sans-serif" font-weight="800" font-style="italic" font-size="4.6" letter-spacing=".9" fill="${dark(col, 0.28)}" pointer-events="none">iFlipper</text>
  </g>
  <g class="hits">
    ${Object.entries(DIRS).map(([k, a]) => `<path class="hit" data-key="${k}" d="${sector(DPAD.x, DPAD.y, DPAD.ok + 1.1, DPAD.r + 0.6, a - Math.PI / 4, a + Math.PI / 4)}"/>`).join('')}
    <circle class="hit" data-key="ok" cx="${DPAD.x}" cy="${DPAD.y}" r="${DPAD.ok + 1}"/>
    <circle class="hit" data-key="back" cx="${BACK.x}" cy="${BACK.y}" r="${BACK.r + 1}"/>
  </g>`;
}

// -- internals (visible through a clear shell) --------------------------------------

function internals(id) {
  const chips = [[38, 6, 9, 9], [62, 4, 7, 5], [30, 18, 6, 4], [8, 26, 12, 6], [64, 30, 10, 5]]
    .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx=".4" fill="#0d0e10"/>`).join('');
  return `
  <g clip-path="url(#${id}-clip)">
    <rect x="0" y="0" width="${L}" height="${W}" fill="#14171a"/>
    <rect x="12" y="7" width="52" height="28" rx="2" fill="#b9bdc4"/>
    <rect x="12" y="7" width="52" height="28" rx="2" fill="none" stroke="#8b9097" stroke-width=".5"/>
    <rect x="4" y="3" width="92" height="34" rx="2.5" fill="#1d2a22" opacity=".9"/>
    ${chips}
    <rect x="16" y="4.5" width="11" height="11" rx=".6" fill="#c9ccd1"/>
    <ellipse cx="50" cy="20" rx="34" ry="14" fill="none" stroke="#b87333" stroke-width=".7" opacity=".85"/>
    <ellipse cx="50" cy="20" rx="31" ry="11.5" fill="none" stroke="#b87333" stroke-width=".5" opacity=".7"/>
    ${Array.from({ length: 18 }, (_, i) => `<rect x="${GPIO.x0 + i * 3.2}" y=".6" width="1.4" height="2" fill="#d7b25a"/>`).join('')}
  </g>`;
}

// -- GPIO modules (attached at the top edge, lying on the mat) -----------------------------

function moduleSVG(look) {
  const id = look.module.id;
  if (!MODULES[id] || id === 'none') return '';
  const o = look.modules[id] || {};
  const spec = { wifi: [44, 30, '#202226'], cc1101: [34, 22, '#1f5c3a'], nrf24: [32, 17, '#16181b'], game: [50, 34, '#2a1f4d'] }[id];
  const [bw, bd, mask] = spec;
  const cx = (GPIO.x0 + GPIO.x1) / 2, x = cx - bw / 2, y = -4 - bd;
  let parts = '';
  let antenna = null;
  const box = (px, py, w, h, fill, r = 0.4) => `<rect x="${f(px)}" y="${f(py)}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
  if (id === 'wifi') {
    parts += box(x + 4, y + 7, 16, 19, '#c9ccd1', 0.6) + box(x + 4, y + 1.5, 16, 5.6, '#0d0e10');
    parts += `<path d="M${x + 5} ${y + 3}h3v2h3v-2h3v2h3v-2" fill="none" stroke="#c9a24a" stroke-width=".4"/>`;
    parts += box(x + 28, y + 0.5, 9, 4.5, '#c9ccd1', 1.2) + box(x + 28, y + 12, 3.2, 3.2, '#111') + box(x + 34, y + 12, 3.2, 3.2, '#111');
    parts += `<circle cx="${x + 24}" cy="${y + 22}" r=".7" fill="#00ff88"/>`;
    antenna = { x: x + 2, y: y + 2, len: 48, w: 2.4, a: -2.2 };
  } else if (id === 'cc1101' || id === 'nrf24') {
    parts += box(x + bw / 2 - 6, y + 7, 11, id === 'cc1101' ? 10 : 6, '#0d0e10');
    if (id === 'nrf24') parts += box(x + bw / 2 + 2, y + 6, 9, 8, '#c9ccd1', 0.5);
    parts += box(x + 4, y + bd - 6, 4, 2.5, '#b8b8b8');
    // SMA connector on the far edge
    parts += box(x + bw / 2 - 3, y - 7, 6, 8, '#d7b25a', 0.8) + box(x + bw / 2 - 4.5, y - 1.2, 9, 2.6, '#c9a24a', 0.4);
    antenna = { x: x + bw / 2, y: y - 7, len: id === 'cc1101' ? 105 : 72, w: 7, a: -2.05 };
  } else if (id === 'game') {
    parts += box(x + 8, y + 10, 7, 7, '#0d0e10') + box(x + 22, y + 14, 3, 3, '#0d0e10') + box(x + 36, y + 0.5, 9, 4.5, '#c9ccd1', 1.2);
  }
  let pins = '';
  for (let i = 0; i < 18; i++) pins += `<rect x="${f(GPIO.x0 + 0.6 + i * 3.2)}" y="-3.2" width="1.6" height="3.4" fill="#d7b25a"/>`;
  const header = `<rect x="${GPIO.x0 - 1}" y="-4.6" width="${GPIO.x1 - GPIO.x0 + 2}" height="3.2" rx=".4" fill="#111214"/>`;
  const board = `
    <rect x="${x}" y="${y}" width="${bw}" height="${bd}" rx="1" fill="${mask}"/>
    <rect x="${x + 0.6}" y="${y + 0.6}" width="${bw - 1.2}" height="${bd - 1.2}" rx=".7" fill="none" stroke="#e8e8e8" stroke-width=".25" opacity=".7"/>
    ${parts}`;
  let cover = '';
  if (o.cover) {
    const clearCover = o.coverClear;
    const col = o.coverColor;
    cover = `
      <rect x="${x - 2}" y="${y - 1.5}" width="${bw + 4}" height="${bd + 6}" rx="3" fill="${col}" opacity="${clearCover ? 0.38 : 1}"/>
      <rect x="${x - 2}" y="${y - 1.5}" width="${bw + 4}" height="${bd + 6}" rx="3" fill="none" stroke="${light(col, 0.45)}" stroke-width=".4"/>
      <rect x="${x - 0.8}" y="${y - 0.3}" width="${bw + 1.6}" height="${(bd + 6) * 0.45}" rx="2.4" fill="#fff" opacity="${clearCover ? 0.12 : 0.08}"/>
      ${clearCover ? '' : `<text x="${cx}" y="${y + bd / 2 + 1.6}" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-weight="700" font-size="3" letter-spacing=".4" fill="${luma(col) > 0.55 ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.55)'}">${MODULES[id].name.toUpperCase()}</text>`}`;
  }
  let ant = '';
  if (MODULES[id].antenna && o.antenna && antenna) {
    const { len, w } = antenna;
    const ax = antenna.x, ay = antenna.y, deg = (antenna.a * 180) / Math.PI;
    const ribs = Array.from({ length: 6 }, (_, i) => `<rect x="${f(w * 1.1 + (len * (i + 1)) / 7.5)}" y="${-w / 2}" width=".5" height="${w}" fill="#000" opacity=".35"/>`).join('');
    ant = `<g transform="translate(${f(ax)} ${f(ay)}) rotate(${f(deg)})">
      <rect x="0" y="${-w * 0.55}" width="${w * 1.6}" height="${w * 1.1}" rx="${w * 0.3}" fill="#1a1b1e"/>
      <path d="M${w * 1.4} ${-w / 2}L${len} ${-w * 0.36}Q${len + w * 0.4} 0 ${len} ${w * 0.36}L${w * 1.4} ${w / 2}Z" fill="#1d1e22"/>
      <path d="M${w * 1.4} ${-w / 2}L${len} ${-w * 0.36}" stroke="#4a4c52" stroke-width="${w * 0.12}"/>
      ${ribs}
    </g>`;
  }
  return `<g class="module">${board}${cover}${header}${pins}${ant}</g>`;
}

// -- live screen ------------------------------------------------------------------------

export class Screen {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.img = this.g.createImageData(128, 64);
    this.lit = true;
  }

  // 1024 bytes, u8g2 page layout (8 rows per byte, LSB on top). Off pixels stay transparent.
  draw(bits) {
    const d = this.img.data;
    const ink = this.lit ? [28, 15, 2, 255] : [10, 6, 2, 255];
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 128; x++) {
        const i = (y * 128 + x) * 4;
        const on = bits(x, y);
        d[i] = ink[0]; d[i + 1] = ink[1]; d[i + 2] = ink[2]; d[i + 3] = on ? ink[3] : 0;
      }
    }
    this.g.putImageData(this.img, 0, 0);
  }

  setFrame(f) {
    this.frame = f;
    this.message = null;
    this.draw((x, y) => (f[(y >> 3) * 128 + x] >> (y & 7)) & 1);
  }

  setMessage(lines) {
    this.message = lines;
    this.frame = null;
    const bits = textBits(lines);
    this.draw((x, y) => bits[y * 128 + x]);
  }
}

const textCache = new Map();
export function textBits(lines) {
  const key = lines.join('\n');
  if (textCache.has(key)) return textCache.get(key);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = 64 / (lines.length + 1);
  lines.forEach((t, i) => {
    g.font = i === 0 ? 'bold 13px "Segoe UI", Arial, sans-serif' : '10px "Segoe UI", Arial, sans-serif';
    g.fillText(t, 64, lh * (i + 1));
  });
  const a = g.getImageData(0, 0, 128, 64).data;
  const bits = new Uint8Array(128 * 64);
  for (let i = 0; i < bits.length; i++) bits[i] = a[i * 4 + 3] > 110 ? 1 : 0;
  textCache.set(key, bits);
  return bits;
}
