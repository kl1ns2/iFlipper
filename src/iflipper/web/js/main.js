import * as THREE from 'three';
import { buildCase, buildModule, MODULES } from './addons.js';
import { Flipper } from './flipper.js';
import { Stage } from './scene.js';
import { CustomPanel, DEFAULT_LOOK, mergeLook } from './custom.js';

const $ = (s) => document.querySelector(s);
const token = new URLSearchParams(location.search).get('t');
const hasBackend = !!token;

// -- backend -------------------------------------------------------------------

async function api(path, { method = 'GET', body, json } = {}) {
  if (!hasBackend) throw new Error('нет связи с приложением');
  const headers = { 'X-Token': token };
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const r = await fetch('/api/' + path, { method, headers, body });
  const ct = r.headers.get('Content-Type') || '';
  const data = ct.includes('json') ? await r.json() : await r.blob();
  if (!r.ok) throw new Error((data && data.error) || r.statusText);
  return data;
}
const fileUrl = (path) => `/api/${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;

// -- scene ---------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const iconMode = params.has('icon'); // studio render used to make the app icon
if (iconMode) { document.body.classList.add('icon-mode'); document.documentElement.style.background = 'transparent'; }
const stage = new Stage($('#stage'), { transparent: iconMode });
const flipper = new Flipper();
const rig = new THREE.Group(); // Flipper + case + module, thrown as one object
rig.add(flipper.group);
rig.visible = false;
stage.scene.add(rig);
let caseGroup = new THREE.Group(), moduleGroup = new THREE.Group();
rig.add(caseGroup, moduleGroup);
let lift = 0;
let onTable = false;

function throwIn() {
  if (onTable) return;
  onTable = true;
  document.body.classList.add('has-flipper');
  stage.throwIn(rig, { lift, onImpact: thud });
}

// -- look ------------------------------------------------------------------------

let look = structuredClone(DEFAULT_LOOK);
let panel = null;
let saveTimer = null;

function applyLook(next, { save = true } = {}) {
  look = mergeLook(next);
  flipper.apply(look);
  for (const k of Object.values(flipper.keys)) k.extra = [];
  flipper.hitTargets = flipper.hitTargets.filter((m) => !m.userData.fromCase);
  rig.remove(caseGroup, moduleGroup);
  dispose(caseGroup);
  dispose(moduleGroup);
  caseGroup = buildCase(look.case, flipper);
  caseGroup.traverse((o) => { if (o.userData.key) o.userData.fromCase = true; });
  const mod = look.module.id;
  moduleGroup = buildModule(mod, look.modules[mod] || {});
  rig.add(caseGroup, moduleGroup);
  // Under a full case the real buttons are covered by the moulded pillows.
  const full = look.case.type === 'full';
  for (const k of Object.values(flipper.keys)) k.group.visible = !full;
  const newLift = look.case.type === 'none' ? 0 : 1.4;
  if (onTable && newLift !== lift) rig.position.y += newLift - lift;
  lift = newLift;
  stage.invalidate(true);
  if (panel) panel.render();
  if (save) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (hasBackend) api('look', { method: 'PUT', json: look }).catch(() => {});
      else try { localStorage.setItem('iflipper.look', JSON.stringify(look)); } catch { /* private mode */ }
    }, 400);
  }
}

// A little dolphin-free splash for the icon's screen: "iF" in big pixels.
function iconFrame() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 44px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('iF', 64, 34);
  const a = g.getImageData(0, 0, 128, 64).data;
  const f = new Uint8Array(1024);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if (a[(y * 128 + x) * 4 + 3] > 120) f[(y >> 3) * 128 + x] |= 1 << (y & 7);
  return f;
}

function dispose(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
}

panel = new CustomPanel($('#custom'), {
  get: () => look,
  set: (l) => { applyLook(l); },
});

$('#btn-custom').onclick = () => {
  openDrawer('custom');
  if (!onTable) {
    flipper.setMessage(['iFlipper', 'Предпросмотр']);
    throwIn();
  }
};

// -- drawers ---------------------------------------------------------------------

function openDrawer(id) {
  for (const d of document.querySelectorAll('.drawer')) d.classList.toggle('open', d.id === id);
  document.body.classList.toggle('custom-open', id === 'custom');
  if (id === 'files') loadDir(cwd);
}
for (const b of document.querySelectorAll('[data-close]')) {
  b.onclick = () => { b.closest('.drawer').classList.remove('open'); document.body.classList.remove('custom-open'); };
}

// -- device state ---------------------------------------------------------------

let connected = false;
let device = null;

function setStatus(cls, text) {
  const s = $('#status');
  s.className = 'chip ' + cls;
  s.querySelector('span').textContent = text;
}

function human(n) {
  for (const u of ['B', 'KB', 'MB', 'GB']) {
    if (n < 1024 || u === 'GB') return u === 'B' ? `${n} B` : `${n.toFixed(1)} ${u}`;
    n /= 1024;
  }
}

function showDevice(snap) {
  device = snap;
  const i = snap.info;
  $('#dev-name').textContent = i.hardware_name || 'Flipper';
  $('#dev-fw').textContent = `${i.firmware_version || '?'} · ${i.firmware_branch || ''}`;
  const meta = [
    ['Железо', `${i.hardware_model || 'Flipper Zero'} v${i.hardware_ver || '?'}`],
    ['Регион', i.hardware_region_provisioned || '?'],
    ['Сборка', `${i.firmware_commit || '?'} · ${i.firmware_build_date || ''}`],
    ['UID', i.hardware_uid || '?'],
  ];
  $('#dev-meta').innerHTML = meta.map(([k, v]) => `<dt>${k}</dt><dd title="${esc(v)}">${esc(v)}</dd>`).join('');
  showPower(snap.power);
  for (const [root, id] of [['/ext', '#bar-ext'], ['/int', '#bar-int']]) {
    const s = snap.storage[root];
    const el = $(id);
    if (!s) { el.querySelector('em').textContent = '—'; el.querySelector('i').style.width = '0'; continue; }
    const [total, free] = s;
    el.querySelector('em').textContent = `${human(total - free)} / ${human(total)}`;
    el.querySelector('i').style.width = `${((total - free) / total) * 100}%`;
  }
}

function showPower(p) {
  const lvl = Number(p.charge_level || 0);
  const b = $('#battery');
  b.querySelector('span').textContent = `${lvl}%`;
  const val = b.querySelector('.val');
  val.style.strokeDashoffset = String(113 - (113 * lvl) / 100);
  val.style.stroke = lvl < 20 ? 'var(--bad)' : lvl < 45 ? 'var(--accent)' : 'var(--ok)';
  b.title = `${p.charge_state || ''} · ${p.battery_voltage || '?'} В`;
}

function clearDevice() {
  $('#dev-name').textContent = 'Нет устройства';
  $('#dev-fw').textContent = 'Подключите Flipper по USB';
  $('#dev-meta').innerHTML = '';
  $('#battery span').textContent = '—';
  $('#battery .val').style.strokeDashoffset = '113';
  for (const id of ['#bar-ext', '#bar-int']) { $(id + ' em').textContent = ''; $(id + ' i').style.width = '0'; }
}

function setConnected(on) {
  connected = on;
  for (const b of document.querySelectorAll('.needs-dev')) b.disabled = !on;
  flipper.setLed(on ? 0x00ff66 : 0xff3322, on ? 1.6 : 0);
  stage.invalidate();
}

const handlers = {
  status(s) {
    if (s.state === 'connected') return;
    if (connected) {
      setConnected(false);
      clearDevice();
      flipper.setBacklight(false);
      flipper.setMessage(['Отключён']);
    }
    if (s.state === 'waiting') setStatus('wait', 'Ищу Flipper Zero…');
    else if (s.state === 'connecting') setStatus('wait', `Подключаюсь к ${s.target}…`);
    else if (s.state === 'error') setStatus('bad', `Ошибка подключения: ${s.message}`);
    else if (s.state === 'disconnected') { setStatus('bad', 'Flipper отключён — жду…'); toast('Flipper отключён'); }
    stage.invalidate();
  },
  device(snap) {
    showDevice(snap);
    setConnected(true);
    setStatus('ok', `Подключено: ${snap.info.hardware_name || 'Flipper'}`);
    flipper.setBacklight(true);
    if (!flipper.frame) flipper.setMessage([snap.info.hardware_name || 'Flipper', 'подключён']);
    throwIn();
  },
  power: showPower,
  frame(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    flipper.setFrame(bytes);
    stage.invalidate();
  },
  progress(p) {
    const el = $('#progress');
    const done = p.total > 0 && p.done >= p.total;
    el.classList.toggle('hidden', done || !p.label);
    el.classList.toggle('indeterminate', !p.total);
    el.querySelector('label').textContent = p.label + (p.total ? ` — ${Math.round((p.done / p.total) * 100)}%` : '');
    el.querySelector('i').style.width = p.total ? `${(p.done / p.total) * 100}%` : '';
  },
};

function listen() {
  const es = new EventSource(fileUrl('events'));
  for (const [k, fn] of Object.entries(handlers)) es.addEventListener(k, (e) => fn(JSON.parse(e.data)));
  es.onerror = () => setStatus('bad', 'Нет связи с приложением…');
}

// -- input: mouse on the 3D buttons, and the keyboard ------------------------------

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let held = null; // {key, t}

function hitKey(ev) {
  if (!rig.visible) return null;
  const r = stage.canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  const targets = flipper.hitTargets.filter((m) => isShown(m));
  const hit = ray.intersectObjects(targets, false)[0];
  return hit ? hit.object.userData.key : null;
}

function isShown(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function keyDown(key) {
  if (held) return;
  held = { key, t: performance.now() };
  flipper.pressVisual(key, true);
  stage.animate((dt) => flipper.animateKeys(dt));
  click(0.5);
}

function keyUp() {
  if (!held) return;
  const { key, t } = held;
  held = null;
  flipper.pressVisual(key, false);
  stage.animate((dt) => flipper.animateKeys(dt));
  click(0.35);
  const kind = performance.now() - t > 500 ? 'long' : 'short';
  if (connected) api('press', { method: 'POST', json: { key, kind } }).catch((e) => toast(e.message, true));
}

stage.canvas.addEventListener('pointerdown', (ev) => {
  const key = hitKey(ev);
  if (!key) return;
  stage.controls.enabled = false;
  stage.canvas.setPointerCapture(ev.pointerId);
  keyDown(key);
});
stage.canvas.addEventListener('pointerup', () => { keyUp(); stage.controls.enabled = true; });
stage.canvas.addEventListener('pointercancel', () => { keyUp(); stage.controls.enabled = true; });
let hoverQueued = false;
stage.canvas.addEventListener('pointermove', (ev) => {
  if (hoverQueued || held) return;
  hoverQueued = true;
  requestAnimationFrame(() => {
    hoverQueued = false;
    stage.canvas.style.cursor = hitKey(ev) ? 'pointer' : 'grab';
  });
});
stage.canvas.addEventListener('dblclick', () => stage.resetView());

const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Backspace: 'back', Escape: 'back' };
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea') || e.repeat) return;
  const key = KEYMAP[e.key];
  if (key && rig.visible) { e.preventDefault(); keyDown(key); }
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.key]) keyUp(); });

// -- sound: synthesised clicks and thuds (no audio files) -------------------------

let audio = null;
let muted = false;
try { muted = localStorage.getItem('iflipper.muted') === '1'; } catch { /* storage unavailable */ }
$('#btn-sound').textContent = muted ? '🔇' : '🔊';
$('#btn-sound').onclick = () => {
  muted = !muted;
  $('#btn-sound').textContent = muted ? '🔇' : '🔊';
  try { localStorage.setItem('iflipper.muted', muted ? '1' : '0'); } catch { /* ignore */ }
};

function noise(dur, freq, gain) {
  if (muted) return;
  try {
    audio = audio || new AudioContext();
    const n = Math.floor(audio.sampleRate * dur);
    const buf = audio.createBuffer(1, n, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const src = audio.createBufferSource();
    src.buffer = buf;
    const f = audio.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = audio.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(audio.destination);
    src.start();
  } catch { /* audio not allowed yet */ }
}
const thud = (s) => noise(0.12, 900, 0.9 * s);
const click = (s) => noise(0.03, 4000, 0.25 * s);

// -- actions ---------------------------------------------------------------------

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 3200);
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  if (name) a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const p = $('#picker');
    p.accept = accept || '';
    p.multiple = multiple;
    p.value = '';
    p.onchange = () => resolve([...p.files]);
    p.click();
  });
}

function screenshotPng() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(flipper.lcdCanvas, 0, 0, 512, 256);
  return c.toDataURL('image/png');
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');

const actions = {
  files: () => openDrawer('files'),
  shot: () => { download(screenshotPng(), `flipper-${stamp()}.png`); toast('Скриншот сохранён'); },
  alert: () => api('alert', { method: 'POST' }).then(() => toast('Flipper мигнул и пискнул 👋')),
  time: () => api('time', { method: 'POST' }).then(() => toast('Время синхронизировано')),
  backup: () => { download(fileUrl('backup')); toast('Бэкап собирается — файл скачается сам'); },
  restore: async () => {
    const [f] = await pickFile('.gz,.tgz,.tar.gz');
    if (!f || !confirm(`Восстановить из ${f.name}? Изменённые файлы на Flipper будут перезаписаны.`)) return;
    const st = await api('restore', { method: 'POST', body: f });
    toast(`Готово: загружено ${st.uploaded}, без изменений ${st.skipped}`);
  },
  update: async () => {
    const [f] = await pickFile('.tgz');
    if (!f || !confirm(`Установить прошивку ${f.name}? Flipper перезагрузится.`)) return;
    await api('update', { method: 'POST', body: f });
    toast('Прошивка загружена — Flipper обновляется');
  },
};
for (const b of document.querySelectorAll('[data-act]')) {
  b.onclick = async () => {
    try { await actions[b.dataset.act](); } catch (e) { toast(e.message, true); }
  };
}
$('#btn-view').onclick = () => stage.resetView();
$('#btn-photo').onclick = () => {
  stage.renderer.render(stage.scene, stage.camera);
  download(stage.canvas.toDataURL('image/png'), `iflipper-desk-${stamp()}.png`);
};

// -- files -----------------------------------------------------------------------

let cwd = '/ext';

async function loadDir(path) {
  cwd = path;
  const crumbs = $('#crumbs');
  const parts = path.split('/').filter(Boolean);
  crumbs.innerHTML = '';
  parts.forEach((p, i) => {
    if (i) crumbs.insertAdjacentHTML('beforeend', '<span>/</span>');
    const b = document.createElement('button');
    b.textContent = p;
    b.onclick = () => loadDir('/' + parts.slice(0, i + 1).join('/'));
    crumbs.appendChild(b);
  });
  const list = $('#file-list');
  if (!connected) { list.innerHTML = '<li class="empty-dir">Flipper не подключён</li>'; return; }
  list.innerHTML = '<li class="empty-dir">Загрузка…</li>';
  try {
    const items = await api('ls?path=' + encodeURIComponent(path));
    list.innerHTML = '';
    if (path.split('/').filter(Boolean).length > 1) {
      list.appendChild(row('⬆️', '..', '', () => loadDir(path.replace(/\/[^/]+$/, '') || '/ext')));
    }
    if (!items.length) list.insertAdjacentHTML('beforeend', '<li class="empty-dir">Пусто</li>');
    for (const it of items) {
      const full = (path === '/' ? '' : path) + '/' + it.name;
      const li = it.dir
        ? row('📁', it.name, '', () => loadDir(full))
        : row(fileIcon(it.name), it.name, human(it.size), () => download(fileUrl('file?path=' + encodeURIComponent(full)), it.name));
      const del = document.createElement('button');
      del.className = 'row-act';
      del.title = 'Удалить';
      del.textContent = '🗑';
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Удалить ${full}?`)) return;
        try { await api('rm', { method: 'POST', json: { path: full } }); loadDir(path); } catch (er) { toast(er.message, true); }
      };
      li.appendChild(del);
      list.appendChild(li);
    }
  } catch (e) {
    list.innerHTML = `<li class="empty-dir">${esc(e.message)}</li>`;
  }
}

function row(icon, name, size, onclick) {
  const li = document.createElement('li');
  li.innerHTML = `<span>${icon}</span><span class="nm">${esc(name)}</span><span class="sz">${size}</span>`;
  li.onclick = onclick;
  return li;
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  return { sub: '📡', nfc: '💳', rfid: '🏷️', ir: '📺', ibtn: '🔑', txt: '📄', js: '📜', fap: '🧩', png: '🖼️', bmx: '🖼️' }[ext] || '📄';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

$('#f-refresh').onclick = () => loadDir(cwd);
$('#f-mkdir').onclick = async () => {
  const name = prompt('Имя новой папки:');
  if (!name) return;
  try { await api('mkdir', { method: 'POST', json: { path: `${cwd}/${name}` } }); loadDir(cwd); } catch (e) { toast(e.message, true); }
};
$('#f-up').onclick = async () => {
  const files = await pickFile('', true);
  for (const f of files) {
    try {
      await api('file?path=' + encodeURIComponent(`${cwd}/${f.name}`), { method: 'POST', body: f });
    } catch (e) { toast(e.message, true); break; }
  }
  if (files.length) { toast(`Загружено файлов: ${files.length}`); loadDir(cwd); }
};

// -- boot ------------------------------------------------------------------------------

async function boot() {
  setConnected(false);
  let saved = null;
  if (hasBackend) saved = await api('look').catch(() => null);
  else try { saved = JSON.parse(localStorage.getItem('iflipper.look')); } catch { /* none */ }
  applyLook(saved && Object.keys(saved).length ? saved : DEFAULT_LOOK, { save: false });
  panel.render();
  flipper.setMessage(['Подключите', 'Flipper Zero']);
  if (hasBackend) listen();
  else setStatus('bad', 'Демо-режим (без приложения)');
  if (params.has('fast')) stage.timeScale = 25; // headless tests
  if (iconMode) {
    applyLook(DEFAULT_LOOK, { save: false });
    flipper.setFrame(iconFrame());
    rig.visible = true;
    rig.rotation.set(0, 0.22, 0);
    stage.controls.target.set(2, 6, 0);
    stage.camera.position.set(-20, 150, 118);
    stage.camera.fov = 40;
    stage.camera.updateProjectionMatrix();
    stage.invalidate(true);
    return;
  }
  if (new URLSearchParams(location.search).has('demo')) {
    flipper.setMessage(['iFlipper', 'Демо']);
    throwIn();
  }
  window.__iflipper = { stage, flipper, rig, applyLook, get look() { return look; }, MODULES };
}
boot();
