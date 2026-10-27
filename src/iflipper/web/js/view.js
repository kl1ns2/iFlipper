// Top-down desk: wooden table, repair mat, props and the Flipper, positioned in millimetres.
import { deviceSVG, L, LCD, overlaySVG, Screen, W } from './device.js';
import { MAT, matCanvas, woodCanvas, WORK } from './textures.js';

export const REST = { x: WORK.x + WORK.w / 2, y: WORK.y + WORK.h / 2 - 4, rot: -2 };
const KEYS = new Set(['up', 'down', 'left', 'right', 'ok', 'back']);

export class Desk {
  constructor(root, { onKey, transparent = false } = {}) {
    this.root = root;
    this.onKey = onKey;
    this.state = { x: REST.x, y: REST.y, rot: REST.rot, lift: 0 }; // the Flipper
    this.view = { cx: REST.x + 10, cy: REST.y + 2, zoom: 1 };
    this.timeScale = 1;
    this.held = null;
    this.look = null;
    this.connected = false;
    root.innerHTML = `
      <div class="mat"><svg class="props" viewBox="0 0 ${MAT.w} ${MAT.h}" overflow="visible">${props()}</svg></div>
      <div class="rig" hidden>
        <div class="rig-body"></div>
        <canvas class="lcd" width="128" height="64"></canvas>
        <div class="rig-over"></div>
      </div>`;
    this.mat = root.querySelector('.mat');
    this.rig = root.querySelector('.rig');
    this.body = root.querySelector('.rig-body');
    this.over = root.querySelector('.rig-over');
    const lcd = root.querySelector('.lcd');
    Object.assign(lcd.style, {
      left: `${(LCD.x / L) * 100}%`, top: `${(LCD.y / W) * 100}%`, width: `${(LCD.w / L) * 100}%`, height: `${(LCD.h / W) * 100}%`,
    });
    this.screen = new Screen(lcd);
    if (transparent) {
      this.mat.hidden = true;
    } else {
      root.style.backgroundImage = `url(${woodCanvas().toDataURL('image/jpeg', 0.85)})`;
      this.mat.style.backgroundImage = `url(${matCanvas().toDataURL('image/png')})`;
    }
    this.bindInput();
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  get visible() { return !this.rig.hidden; }

  // px per mm at zoom 1: the Flipper fills a good part of the window.
  get S() {
    const base = Math.min(innerWidth / 330, innerHeight / 220); // the bench, with the Flipper large enough to use
    return base * this.view.zoom;
  }

  toPx(x, y) {
    const S = this.S;
    return [(x - this.view.cx) * S + innerWidth / 2, (y - this.view.cy) * S + innerHeight / 2];
  }

  layout() {
    const S = this.S;
    const [mx, my] = this.toPx(0, 0);
    Object.assign(this.mat.style, { left: `${mx}px`, top: `${my}px`, width: `${MAT.w * S}px`, height: `${MAT.h * S}px` });
    this.root.style.backgroundSize = `${260 * S}px`;
    this.root.style.backgroundPosition = `${mx}px ${my}px`;
    this.rig.style.width = `${L * S}px`;
    this.rig.style.height = `${W * S}px`;
    this.place();
  }

  // Position the Flipper; `lift` > 0 means it is in the air (bigger, with a far, soft shadow).
  place() {
    const { x, y, rot, lift } = this.state;
    const S = this.S;
    const [px, py] = this.toPx(x - L / 2, y - W / 2);
    this.rig.style.transform = `translate(${px}px, ${py}px) rotate(${rot}deg) scale(${1 + lift * 0.32})`;
    const off = (0.9 + lift * 12) * S * 0.35, blur = (1.2 + lift * 9) * S * 0.45;
    const a = 0.45 - lift * 0.2;
    this.rig.style.filter = `drop-shadow(${off * 0.6}px ${off}px ${blur}px rgba(0,0,0,${a})) drop-shadow(0 ${0.25 * S}px ${0.35 * S}px rgba(0,0,0,${0.35 * (1 - lift)}))`;
  }

  setLook(look, connected = this.connected) {
    this.look = look;
    this.connected = connected;
    this.body.innerHTML = deviceSVG(look, { cable: connected });
    this.over.innerHTML = overlaySVG(look);
    this.root.querySelector('.lcd').style.setProperty('--backlight', look.screen.backlight);
  }

  setConnected(on) {
    this.rig.classList.toggle('led-on', on);
    if (this.look && on !== this.connected) this.setLook(this.look, on);
  }

  // -- animation -----------------------------------------------------------------

  run(fn) {
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05) * this.timeScale;
      last = now;
      if (fn(dt) !== false) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Thrown onto the mat: flies in spinning, lands, hops twice and slides to a stop.
  throwIn(onImpact) {
    if (this.visible) return;
    this.rig.hidden = false;
    const st = this.state;
    const start = { x: REST.x - 330, y: REST.y - 190, rot: -250 };
    const land = { x: REST.x - 60, y: REST.y - 18, rot: -18 };
    const tFly = 0.5, tAll = 1.9;
    let t = 0, impacts = 0;
    const ease = (u) => 1 - Math.pow(1 - u, 3);
    this.run((dt) => {
      t += dt;
      if (t < tFly) {
        const u = t / tFly;
        st.x = start.x + (land.x - start.x) * u;
        st.y = start.y + (land.y - start.y) * u;
        st.rot = start.rot + (land.rot - start.rot) * ease(u);
        st.lift = 1 - u * u;
      } else {
        const v = Math.min(1, (t - tFly) / (tAll - tFly));
        const hops = [[0, 0.2, 0.13], [0.2, 0.34, 0.05]];
        st.lift = 0;
        hops.forEach(([a, b, h], i) => {
          if (v >= a && v < b) {
            st.lift = Math.sin(((v - a) / (b - a)) * Math.PI) * h;
            if (impacts <= i) { impacts = i + 1; onImpact && onImpact(1 / (i + 1)); }
          }
        });
        if (v >= 0.34 && impacts < 3) { impacts = 3; onImpact && onImpact(0.25); }
        const s = ease(v);
        st.x = land.x + (REST.x - land.x) * s;
        st.y = land.y + (REST.y - land.y) * s;
        st.rot = land.rot + (REST.rot - land.rot) * s + Math.sin(v * 28) * 5 * Math.exp(-v * 6);
        if (v >= 1) {
          Object.assign(st, { x: REST.x, y: REST.y, rot: REST.rot, lift: 0 });
          this.place();
          return false;
        }
      }
      this.place();
      return true;
    });
  }

  resetView() {
    const from = { ...this.view }, to = { cx: REST.x + 10, cy: REST.y + 2, zoom: 1 };
    let t = 0;
    this.run((dt) => {
      t = Math.min(1, t + dt * 3);
      const e = 1 - Math.pow(1 - t, 3);
      for (const k of ['cx', 'cy', 'zoom']) this.view[k] = from[k] + (to[k] - from[k]) * e;
      this.layout();
      return t < 1;
    });
  }

  // -- input -------------------------------------------------------------------------

  pressVisual(key, down) {
    this.rig.classList.toggle(`press-${key}`, down);
  }

  bindInput() {
    const root = this.root;
    let drag = null;
    root.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-key]');
      const key = el && el.dataset.key;
      if (key && KEYS.has(key)) {
        e.preventDefault();
        root.setPointerCapture(e.pointerId);
        this.onKey(key, true);
        this.held = key;
        return;
      }
      if (e.target.closest('.panel, button, input')) return;
      drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy };
      root.setPointerCapture(e.pointerId);
      root.classList.add('dragging');
    });
    const up = () => {
      if (this.held) { this.onKey(this.held, false); this.held = null; }
      drag = null;
      root.classList.remove('dragging');
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.view.cx = drag.cx - (e.clientX - drag.x) / this.S;
      this.view.cy = drag.cy - (e.clientY - drag.y) / this.S;
      this.layout();
    });
    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const S0 = this.S;
      const wx = this.view.cx + (e.clientX - innerWidth / 2) / S0, wy = this.view.cy + (e.clientY - innerHeight / 2) / S0;
      this.view.zoom = Math.min(3, Math.max(0.55, this.view.zoom * Math.exp(-e.deltaY * 0.0015)));
      const S1 = this.S;
      this.view.cx = wx - (e.clientX - innerWidth / 2) / S1;
      this.view.cy = wy - (e.clientY - innerHeight / 2) / S1;
      this.layout();
    }, { passive: false });
    root.addEventListener('dblclick', (e) => { if (!e.target.closest('[data-key]')) this.resetView(); });
  }
}

// Things lying on the mat: a solder spool, tweezers and a few screws in the trays.
function props() {
  const screws = [[278, 34], [285, 38], [309, 32], [336, 62], [343, 58], [281, 90], [339, 88], [306, 116], [300, 198], [318, 204], [330, 196]]
    .map(([x, y], i) => `
      <g transform="translate(${x} ${y}) rotate(${i * 37})">
        <circle r="2.4" fill="url(#screw)"/><circle r="2.4" fill="none" stroke="#5d636b" stroke-width=".3"/>
        <path d="M-1.1 0H1.1M0 -1.1V1.1" stroke="#4b5057" stroke-width=".55" stroke-linecap="round"/>
      </g>`).join('');
  return `
    <defs>
      <radialGradient id="screw" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#e3e6ea"/><stop offset="1" stop-color="#868c94"/></radialGradient>
      <radialGradient id="spool" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#3d8cf0"/><stop offset=".8" stop-color="#1b62c2"/><stop offset="1" stop-color="#11468f"/></radialGradient>
      <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3f5"/><stop offset=".5" stop-color="#b8bdc4"/><stop offset="1" stop-color="#8d939b"/></linearGradient>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1.2" dy="2" stdDeviation="1.6" flood-opacity=".45"/></filter>
    </defs>
    <g filter="url(#soft)">
      <g transform="translate(372 -6)">
        <circle r="34" fill="url(#spool)"/>
        <circle r="34" fill="none" stroke="#0e3c7a" stroke-width=".8"/>
        <circle r="26" fill="none" stroke="#5fa3f5" stroke-width=".6" opacity=".6"/>
        <circle r="9" fill="#0b0c0e"/><circle r="9" fill="none" stroke="#2c5fa0" stroke-width="1.2"/>
        <text y="-15" text-anchor="middle" font-family="Segoe UI, Arial" font-size="4.5" font-weight="700" fill="#e9f1ff" opacity=".85">Sn63 Pb37 · 0.8 mm</text>
      </g>
      <path d="M346 12C330 18 318 14 300 10S270 8 262 14" fill="none" stroke="#c9cdd2" stroke-width="1" stroke-linecap="round"/>
      <g transform="translate(150 228) rotate(-12)">
        <path d="M0 -3.2L118 -1.3L118 .2L0 -.6Z" fill="url(#steel)"/>
        <path d="M0 3.2L118 1.3L118 -.2L0 .6Z" fill="url(#steel)"/>
        <rect x="-4" y="-3.6" width="8" height="7.2" rx="1.2" fill="#9aa0a8"/>
        <rect x="30" y="-3.4" width="36" height="1.6" rx=".6" fill="#2c6be0" opacity=".85"/>
        <rect x="30" y="1.8" width="36" height="1.6" rx=".6" fill="#2c6be0" opacity=".85"/>
      </g>
      ${screws}
    </g>`;
}
