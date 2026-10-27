// Customization drawer: body, buttons, screen, cases and GPIO modules.
import { MODULES } from './addons.js';

export const DEFAULT_LOOK = {
  body: { color: '#f3f3f0', finish: 'gloss' },
  accent: '#b9bcc2',
  buttons: { dpad: '#e9e9e6', ok: '#ff8200', back: '#e9e9e6' },
  screen: { backlight: '#ff8a1c' },
  case: { type: 'none', material: 'silicone', color: '#ff7a1a' },
  module: { id: 'none' },
  modules: {
    wifi: { cover: true, coverClear: false, coverColor: '#2b2d31', antenna: false },
    cc1101: { cover: false, coverClear: false, coverColor: '#ff8200', antenna: true },
    nrf24: { cover: false, coverClear: true, coverColor: '#9ad0ff', antenna: true },
    game: { cover: true, coverClear: false, coverColor: '#f3f3f0', antenna: false },
  },
};

export function mergeLook(l) {
  const d = structuredClone(DEFAULT_LOOK);
  if (!l) return d;
  const out = { ...d, ...l };
  for (const k of ['body', 'buttons', 'screen', 'case', 'module']) out[k] = { ...d[k], ...(l[k] || {}) };
  out.modules = {};
  for (const id of Object.keys(d.modules)) out.modules[id] = { ...d.modules[id], ...((l.modules || {})[id] || {}) };
  if (!MODULES[out.module.id]) out.module.id = 'none';
  return out;
}

const BODY_COLORS = [
  ['#f3f3f0', 'Классический белый'], ['#2b2d31', 'Графит'], ['#111214', 'Чёрный'], ['#ff7a00', 'Оранжевый'],
  ['#9fe3c9', 'Мята'], ['#8fc8ff', 'Небесный'], ['#b9a7f5', 'Лаванда'], ['#ff9ec7', 'Розовый'],
  ['#ffd84d', 'Лимон'], ['#d8263a', 'Красный'], ['#2f6b3f', 'Хвоя'], ['#6c5ce7', 'Фиолетовый'],
];
const CLEAR_COLORS = [
  ['#eef6ff', 'Clear Ice'], ['#7d8590', 'Smoke'], ['#ff8a1c', 'Amber'], ['#7c4dff', 'Purple Haze'],
  ['#3ddc84', 'Atomic Green'], ['#40c4ff', 'Ocean'], ['#ff4f8b', 'Berry'], ['#ffe066', 'Citrus'],
  ['#ff3b30', 'Ruby'], ['#c0c4cc', 'Frost'], ['#1f1f24', 'Dark Smoke'], ['#a3ffd6', 'Glow'],
];
const BUTTON_COLORS = [
  ['#e9e9e6', 'Белый'], ['#2b2d31', 'Графит'], ['#ff8200', 'Оранжевый'], ['#ff3b30', 'Красный'],
  ['#3ddc84', 'Зелёный'], ['#40c4ff', 'Голубой'], ['#7c4dff', 'Фиолетовый'], ['#ffd84d', 'Жёлтый'],
  ['#ff9ec7', 'Розовый'], ['#9fe3c9', 'Мята'], ['#111214', 'Чёрный'],
];
const BACKLIGHTS = [
  ['#ff8a1c', 'Оранжевый (оригинал)'], ['#f2f5f8', 'Белый'], ['#7dff8a', 'Зелёный'], ['#5cc8ff', 'Голубой'],
  ['#ff4d5e', 'Красный'], ['#b77dff', 'Фиолетовый'],
];
const CASE_COLORS = [
  ['#ff7a1a', 'Оранжевый'], ['#2b2d31', 'Графит'], ['#111214', 'Чёрный'], ['#f3f3f0', 'Белый'],
  ['#40c4ff', 'Голубой'], ['#3ddc84', 'Зелёный'], ['#ff4f8b', 'Малиновый'], ['#7c4dff', 'Фиолетовый'],
  ['#ffd84d', 'Жёлтый'], ['#8b6b4a', 'Койот'], ['#556b2f', 'Олива'], ['#c0c4cc', 'Серый'],
];
const PRESETS = [
  { name: 'Оригинал', look: { body: { color: '#f3f3f0', finish: 'gloss' }, accent: '#b9bcc2', buttons: { dpad: '#e9e9e6', ok: '#ff8200', back: '#e9e9e6' }, screen: { backlight: '#ff8a1c' } } },
  { name: 'Stealth', look: { body: { color: '#1b1c20', finish: 'matte' }, accent: '#2b2d31', buttons: { dpad: '#2b2d31', ok: '#ff3b30', back: '#2b2d31' }, screen: { backlight: '#f2f5f8' } } },
  { name: 'Transparent', look: { body: { color: '#eef6ff', finish: 'clear' }, accent: '#c0c4cc', buttons: { dpad: '#e9e9e6', ok: '#ff8200', back: '#e9e9e6' }, screen: { backlight: '#ff8a1c' } } },
  { name: 'Purple Haze', look: { body: { color: '#7c4dff', finish: 'clear' }, accent: '#5a3fc0', buttons: { dpad: '#f3f3f0', ok: '#ffd84d', back: '#f3f3f0' }, screen: { backlight: '#b77dff' } } },
  { name: 'Retro Game', look: { body: { color: '#c0c4cc', finish: 'matte' }, accent: '#6c5ce7', buttons: { dpad: '#111214', ok: '#d8263a', back: '#d8263a' }, screen: { backlight: '#7dff8a' } } },
  { name: 'Atomic', look: { body: { color: '#3ddc84', finish: 'clear' }, accent: '#2f6b3f', buttons: { dpad: '#111214', ok: '#ffd84d', back: '#111214' }, screen: { backlight: '#7dff8a' } } },
];
const MODULE_ICONS = { none: '⭘', wifi: '📶', cc1101: '📡', nrf24: '🛰️', game: '🎮' };

const TABS = [['body', 'Корпус'], ['buttons', 'Кнопки'], ['screen', 'Экран'], ['case', 'Чехол'], ['modules', 'Модули']];

export class CustomPanel {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.tab = 'body';
    this.body = root.querySelector('#custom-body');
    this.tabs = root.querySelector('#custom-tabs');
    root.querySelector('#look-reset').onclick = () => this.store.set(structuredClone(DEFAULT_LOOK));
    root.querySelector('#look-random').onclick = () => this.store.set(randomLook(this.store.get()));
  }

  get look() { return this.store.get(); }

  change(mutate) {
    const l = structuredClone(this.look);
    mutate(l);
    this.store.set(l); // re-renders through applyLook
  }

  render() {
    this.tabs.innerHTML = '';
    for (const [id, title] of TABS) {
      const b = el('button', { class: this.tab === id ? 'on' : '', text: title });
      b.onclick = () => { this.tab = id; this.render(); };
      this.tabs.appendChild(b);
    }
    const scroll = this.body.scrollTop;
    this.body.innerHTML = '';
    this['render_' + this.tab](this.body);
    this.body.scrollTop = scroll;
  }

  render_body(root) {
    const l = this.look;
    root.appendChild(group('Готовые сборки', presets(PRESETS, (p) => this.change((x) => Object.assign(x, structuredClone(p.look))))));
    root.appendChild(group('Материал', seg([['gloss', 'Глянец'], ['matte', 'Матовый'], ['clear', 'Прозрачный']], l.body.finish,
      (v) => this.change((x) => {
        x.body.finish = v;
        if (v === 'clear' && !CLEAR_COLORS.some(([c]) => c === x.body.color)) x.body.color = CLEAR_COLORS[0][0];
      }))));
    const clear = l.body.finish === 'clear';
    root.appendChild(group(clear ? 'Оттенок пластика' : 'Цвет корпуса',
      swatches(clear ? CLEAR_COLORS : BODY_COLORS, l.body.color, (c) => this.change((x) => { x.body.color = c; }), clear)));
    root.appendChild(group('Вставки и шов', swatches(BODY_COLORS, l.accent, (c) => this.change((x) => { x.accent = c; }))));
  }

  render_buttons(root) {
    const l = this.look;
    const sets = [
      { name: 'Классика', b: { dpad: '#e9e9e6', ok: '#ff8200', back: '#e9e9e6' } },
      { name: 'Монохром', b: { dpad: '#2b2d31', ok: '#2b2d31', back: '#2b2d31' } },
      { name: 'Неон', b: { dpad: '#111214', ok: '#3ddc84', back: '#ff4f8b' } },
      { name: 'Ретро', b: { dpad: '#111214', ok: '#d8263a', back: '#d8263a' } },
    ];
    root.appendChild(group('Наборы', presets(sets.map((s) => ({ name: s.name, colors: Object.values(s.b), b: s.b })),
      (s) => this.change((x) => { x.buttons = { ...s.b }; }))));
    for (const [k, title] of [['dpad', 'Крестовина'], ['ok', 'Кнопка OK'], ['back', 'Кнопка «Назад»']]) {
      root.appendChild(group(title, swatches(BUTTON_COLORS, l.buttons[k], (c) => this.change((x) => { x.buttons[k] = c; }))));
    }
  }

  render_screen(root) {
    root.appendChild(group('Подсветка экрана', swatches(BACKLIGHTS, this.look.screen.backlight,
      (c) => this.change((x) => { x.screen.backlight = c; }))));
    root.appendChild(note('Экран показывает то, что сейчас на вашем Flipper, в реальном времени.'));
  }

  render_case(root) {
    const c = this.look.case;
    root.appendChild(group('Тип чехла', seg([['none', 'Без чехла'], ['half', 'Половинка'], ['full', 'Полный']], c.type,
      (v) => this.change((x) => { x.case.type = v; }))));
    root.appendChild(note(c.type === 'half'
      ? 'Неполноценный чехол: закрывает дно и бока до середины, лицевая сторона открыта.'
      : c.type === 'full'
        ? 'Полноценный чехол: закрыто всё, кроме экрана. Кнопки — мягкие силиконовые накладки, нажимаются как обычно.'
        : 'Выберите чехол, чтобы примерить его.'));
    if (c.type === 'none') return;
    root.appendChild(group('Материал', seg([['silicone', 'Цветной силикон'], ['clear', 'Прозрачный TPU']], c.material,
      (v) => this.change((x) => { x.case.material = v; if (v === 'clear') x.case.color = '#eef6ff'; }))));
    const clear = c.material === 'clear';
    root.appendChild(group(clear ? 'Оттенок' : 'Цвет', swatches(clear ? CLEAR_COLORS : CASE_COLORS, c.color,
      (v) => this.change((x) => { x.case.color = v; }), clear)));
  }

  render_modules(root) {
    const l = this.look;
    const cards = el('div', { class: 'cards' });
    for (const [id, m] of Object.entries(MODULES)) {
      const b = el('button', { class: 'card' + (l.module.id === id ? ' on' : '') });
      b.innerHTML = `<span class="ico">${MODULE_ICONS[id]}</span><span><b>${m.name}</b><small>${m.sub || 'GPIO свободен'}</small></span>`;
      b.onclick = () => this.change((x) => { x.module.id = id; });
      cards.appendChild(b);
    }
    root.appendChild(group('Модуль в GPIO', cards));
    const id = l.module.id;
    if (id === 'none') return;
    const o = l.modules[id];
    const box = el('div', { class: 'opts' });
    const set = (k, v) => this.change((x) => { x.modules[id][k] = v; });
    box.appendChild(toggle('С крышкой', o.cover, (v) => set('cover', v)));
    box.appendChild(toggle('Прозрачная крышка', o.coverClear, (v) => set('coverClear', v), !o.cover));
    box.appendChild(toggle(MODULES[id].antenna ? 'Антенна' : 'Антенна (нет разъёма)', !!(MODULES[id].antenna && o.antenna),
      (v) => set('antenna', v), !MODULES[id].antenna));
    if (o.cover) {
      const g = group('Цвет крышки', swatches(o.coverClear ? CLEAR_COLORS : CASE_COLORS, o.coverColor, (c) => set('coverColor', c), o.coverClear));
      g.style.marginTop = '14px';
      box.appendChild(g);
    }
    root.appendChild(group(`Настройки: ${MODULES[id].name}`, box));
  }
}

// -- small DOM helpers ------------------------------------------------------------------

function el(tag, { class: cls = '', text = '' } = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function group(title, content) {
  const g = el('section', { class: 'group' });
  g.appendChild(el('h3', { text: title }));
  g.appendChild(content);
  return g;
}

function note(text) {
  const p = el('p', { class: 'muted', text });
  p.style.margin = '-6px 0 14px';
  p.style.lineHeight = '1.45';
  return p;
}

function seg(options, value, onChange) {
  const s = el('div', { class: 'seg' });
  for (const [v, title] of options) {
    const b = el('button', { class: v === value ? 'on' : '', text: title });
    b.onclick = () => onChange(v);
    s.appendChild(b);
  }
  return s;
}

function swatches(list, value, onChange, clear = false) {
  const wrap = el('div');
  const grid = el('div', { class: 'swatches' });
  const name = el('div', { class: 'sw-name' });
  const current = list.find(([c]) => c.toLowerCase() === String(value).toLowerCase());
  name.textContent = current ? current[1] : `Свой цвет ${value}`;
  for (const [c, title] of list) {
    const b = el('button', { class: 'sw' + (clear ? ' clear' : '') + (current && current[0] === c ? ' on' : '') });
    b.style.backgroundColor = c;
    b.title = title;
    b.onmouseenter = () => { name.textContent = title; };
    b.onmouseleave = () => { name.textContent = current ? current[1] : `Свой цвет ${value}`; };
    b.onclick = () => onChange(c);
    grid.appendChild(b);
  }
  const custom = el('label', { class: 'sw custom' + (current ? '' : ' on') });
  custom.title = 'Свой цвет';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  input.onchange = () => onChange(input.value);
  custom.appendChild(input);
  grid.appendChild(custom);
  wrap.append(grid, name);
  return wrap;
}

function presets(list, onPick) {
  const g = el('div', { class: 'presets' });
  for (const p of list) {
    const b = el('button', { class: 'preset' });
    const colors = p.colors || [p.look.body.color, p.look.buttons.ok, p.look.buttons.dpad, p.look.screen.backlight];
    b.innerHTML = `<b>${p.name}</b><div class="dots">${colors.map((c) => `<i style="background:${c}"></i>`).join('')}</div>`;
    b.onclick = () => onPick(p);
    g.appendChild(b);
  }
  return g;
}

function toggle(title, on, onChange, disabled = false) {
  const t = el('label', { class: 'toggle' + (disabled ? ' disabled' : '') });
  t.innerHTML = `<span>${title}</span><input type="checkbox" ${on ? 'checked' : ''}><span class="sl"></span>`;
  t.querySelector('input').onchange = (e) => onChange(e.target.checked);
  return t;
}

function randomLook(cur) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)][0];
  const l = structuredClone(cur);
  const finish = pick([['gloss'], ['matte'], ['clear']]);
  l.body = { finish, color: pick(finish === 'clear' ? CLEAR_COLORS : BODY_COLORS) };
  l.accent = pick(BODY_COLORS);
  l.buttons = { dpad: pick(BUTTON_COLORS), ok: pick(BUTTON_COLORS), back: pick(BUTTON_COLORS) };
  l.screen = { backlight: pick(BACKLIGHTS) };
  const material = pick([['silicone'], ['clear']]);
  l.case = { type: pick([['none'], ['half'], ['full']]), material, color: pick(material === 'clear' ? CLEAR_COLORS : CASE_COLORS) };
  l.module = { id: pick(Object.keys(MODULES).map((k) => [k])) };
  return l;
}
