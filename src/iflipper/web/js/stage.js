// The Flipper on a black stage, sized to the app column (mobile-style layout).
import { deviceSVG, L, LCD, overlaySVG, Screen, W } from './device.js';

const KEYS = new Set(['up', 'down', 'left', 'right', 'ok', 'back']);
// Room above the Flipper for whatever sits in the GPIO header (mm).
const HEADROOM = { none: 6, wifi: 64, cc1101: 84, nrf24: 74, game: 44 };
const FOOT = 10;

export class Stage {
  constructor(root, { onKey } = {}) {
    this.root = root;
    this.onKey = onKey;
    this.timeScale = 1;
    this.held = null;
    this.look = null;
    root.innerHTML = `
      <div class="floor"></div>
      <div class="rig" hidden>
        <div class="rig-body"></div>
        <canvas class="lcd"></canvas>
        <div class="rig-over"></div>
      </div>`;
    this.rig = root.querySelector('.rig');
    this.body = root.querySelector('.rig-body');
    this.over = root.querySelector('.rig-over');
    this.floor = root.querySelector('.floor');
    const lcd = root.querySelector('.lcd');
    Object.assign(lcd.style, {
      left: `${(LCD.x / L) * 100}%`, top: `${(LCD.y / W) * 100}%`, width: `${(LCD.w / L) * 100}%`, height: `${(LCD.h / W) * 100}%`,
    });
    this.screen = new Screen(lcd);
    this.bindInput();
    new ResizeObserver(() => this.layout()).observe(root);
  }

  get visible() { return !this.rig.hidden; }

  layout() {
    const w = this.root.clientWidth;
    const S = (w * 0.92) / L; // px per mm
    const room = HEADROOM[(this.look && this.look.module.id) || 'none'] || 6;
    this.root.style.height = `${(room + W + FOOT) * S}px`;
    Object.assign(this.rig.style, { width: `${L * S}px`, height: `${W * S}px`, left: `${(w - L * S) / 2}px`, top: `${room * S}px` });
    Object.assign(this.floor.style, { width: `${L * S * 1.1}px`, left: `${(w - L * S * 1.1) / 2}px`, top: `${(room + W - 4) * S}px`, height: `${14 * S}px` });
    this.screen.resize(LCD.w * S, LCD.h * S);
  }

  setLook(look) {
    const moduleChanged = !this.look || this.look.module.id !== look.module.id;
    this.look = look;
    this.body.innerHTML = deviceSVG(look);
    this.over.innerHTML = overlaySVG(look);
    if (moduleChanged) this.layout();
  }

  setConnected(on) {
    this.rig.classList.toggle('led-on', on);
  }

  run(fn) {
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05) * this.timeScale;
      last = now;
      if (fn(dt) !== false) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // The Flipper rises out of the dark: fades in and settles with a small overshoot.
  appear() {
    if (this.visible) return;
    this.rig.hidden = false;
    this.root.classList.add('shown');
    let t = 0;
    const D = 0.9;
    this.run((dt) => {
      t = Math.min(D, t + dt);
      const u = t / D;
      const back = 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2); // ease-out-back
      this.rig.style.opacity = String(Math.min(1, u * 1.6));
      this.rig.style.transform = `translateY(${(1 - back) * 18}px) scale(${0.9 + 0.1 * back})`;
      if (u >= 1) { this.rig.style.transform = ''; return false; }
      return true;
    });
  }

  pressVisual(key, down) {
    this.rig.classList.toggle(`press-${key}`, down);
  }

  bindInput() {
    const root = this.root;
    root.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-key]');
      const key = el && el.dataset.key;
      if (!key || !KEYS.has(key)) return;
      e.preventDefault();
      root.setPointerCapture(e.pointerId);
      this.held = key;
      this.onKey(key, true);
    });
    const up = () => {
      if (this.held) { this.onKey(this.held, false); this.held = null; }
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  }
}
