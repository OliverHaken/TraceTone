// TraceTone web: bootstraps the app and wires the DOM to the state layer.
import { PARAMS, paramRange, clamp, finite } from './params.js';
import * as S from './state.js';
import { Graph } from './graph.js';
import { toast, listDialog, isDialogOpen } from './ui.js';
import { buildAudio } from './synth.js';
import * as audio from './audio.js';

export const APP_VERSION = 'web 1.0';

const $ = (sel) => document.querySelector(sel);
const state = S.createState();
const canvas = $('#graph');
const xf = $('#xf'), yf = $('#yf');

// ---- change propagation -----------------------------------------------------------------------

// Call after any state change. kind: 'edit' (data changed), 'select', 'view'.
function changed(kind = 'edit') {
  graph.requestRender();
  syncUI();
  if (kind === 'edit') hooks.afterEdit?.();
}
// Extension points filled in by later modules (audio / persistence).
const hooks = {};

function report(r) {
  if (r?.error) toast(r.error, 'error');
  else if (r?.msg) toast(r.msg);
  return r;
}

function fillBoxes() {
  const p = S.selectedPoint(state);
  if (p) {
    xf.value = p.x.toFixed(4);
    yf.value = p.y.toFixed(4);
  }
}

const paramRows = [...document.querySelectorAll('.param')].map((row) => ({
  key: row.dataset.param,
  range: row.querySelector('input[type=range]'),
  num: row.querySelector('input[type=number]'),
}));

function syncParam({ key, range, num }) {
  const p = PARAMS[key];
  const v = state[key];
  const pos = clamp(p.toSlider(v, state), 0, 1);
  if (document.activeElement !== range) range.value = String(pos);
  range.style.setProperty('--pct', `${pos * 100}%`);
  if (document.activeElement !== num) num.value = p.fmt(v);
}

function syncUI() {
  for (const r of paramRows) syncParam(r);
  $('#cycle-sw').checked = state.cycle;
  const draw = $('#draw-b');
  draw.textContent = state.draw_mode ? 'Draw Point: ON' : 'Draw Point: OFF';
  draw.style.setProperty('--b', state.draw_mode ? '#1A4B36' : '#243047');
  draw.setAttribute('aria-pressed', String(state.draw_mode));
  $('#polarity-b').textContent = S.polarityTitle(state);
}

// ---- graph ------------------------------------------------------------------------------------

const graph = new Graph(canvas, state, {
  beforeTouch: () => dismissKeyboard(),
  onSelect: () => { fillBoxes(); changed('select'); },
  onEdit: () => { fillBoxes(); changed('edit'); },
  onPointMoved: (p) => { if (state.sel.size === 1 && state.sel.has(p.id)) fillBoxes(); },
  onView: () => hooks.afterView?.(),
});

function dismissKeyboard() {
  const a = document.activeElement;
  if (a && (a === xf || a === yf || a.classList?.contains('num'))) a.blur();
}

// ---- parameter rows (slider + number) ---------------------------------------------------------

function applyParam(key, value) {
  const r = S.setParam(state, key, value);
  if (r.durationChanged) graph.fit();
  changed('edit');
}

for (const row of paramRows) {
  const { key, range, num } = row;
  let gesture = false; // one undo snapshot per slider gesture
  range.addEventListener('input', () => {
    if (!gesture) { S.snapshot(state); gesture = true; }
    applyParam(key, PARAMS[key].fromSlider(Number(range.value), state));
    syncParam(row);
  });
  range.addEventListener('change', () => { gesture = false; });
  num.addEventListener('change', () => {
    const v = finite(num.value, NaN);
    if (!Number.isFinite(v)) {
      toast('Invalid number', 'error');
      syncParam(row);
      return;
    }
    const [lo, hi] = paramRange(key, state);
    S.snapshot(state);
    applyParam(key, key === 'duration' ? Math.round(clamp(v, lo, hi) * 100) / 100 : clamp(v, lo, hi));
    syncParam(row);
  });
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); });
  num.addEventListener('blur', () => syncParam(row));
}

$('#loop-sw').addEventListener('change', (e) => audio.setLoop(e.target.checked));
audio.setStateListener((playing) => $('#play-b').classList.toggle('playing', playing));
window.addEventListener('pagehide', () => audio.stop());

// iOS without navigator.audioSession: Web Audio is muted by the ringer switch. Say so once.
function silentSwitchHint() {
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iOS || audio.hasAudioSession()) return;
  try {
    if (localStorage.getItem('tracetone.hint.silent')) return;
    localStorage.setItem('tracetone.hint.silent', '1');
  } catch { /* storage unavailable: show every time is fine */ }
  setTimeout(() => toast('No sound? Turn off silent mode (ringer switch).'), 600);
}

$('#cycle-sw').addEventListener('change', (e) => {
  S.snapshot(state);
  applyParam('cycle', e.target.checked);
});

// ---- actions ----------------------------------------------------------------------------------

const LABELS = ['Labels off', 'Point numbers', 'Coordinates'];

const actions = {
  add() {
    const xy = S.readBoxes(state, xf.value, yf.value);
    if (!xy) return toast('Enter finite numbers for x and amplitude', 'error');
    S.insertPoint(state, ...xy);
    dismissKeyboard();
    fillBoxes();
    changed();
  },
  set() {
    if (state.sel.size !== 1) return toast('Select exactly one point', 'error');
    const xy = S.readBoxes(state, xf.value, yf.value);
    if (!xy) return toast('Enter finite numbers for x and amplitude', 'error');
    report(S.setPoint(state, ...xy));
    dismissKeyboard();
    fillBoxes();
    changed();
  },
  done: () => dismissKeyboard(),
  draw() {
    state.draw_mode = !state.draw_mode;
    changed('select');
  },
  line() { if (!report(S.connect(state, 'line'))?.error) changed(); },
  curve() { if (!report(S.connect(state, 'curve'))?.error) changed(); },
  polarity() { if (!report(S.flipPolarity(state))?.error) changed(); },
  undo() {
    const r = report(S.undo(state));
    if (r.msg) return;
    if (r.durationChanged) graph.fit(); else graph.clampView();
    fillBoxes();
    changed();
  },
  delete() { S.deleteSel(state); changed(); },
  clear() { S.clearAll(state); changed(); },
  copy() {
    const r = report(S.copySel(state));
    if (r.text) navigator.clipboard?.writeText(r.text).catch(() => {});
  },
  async paste() {
    let clip = state.clip;
    if (!clip && navigator.clipboard?.readText) {
      try { clip = S.parseClipText(await navigator.clipboard.readText()); } catch { /* permission denied */ }
    }
    if (!report(S.paste(state, clip))?.error) { fillBoxes(); changed(); }
  },
  play() {
    try { audio.unlock(); } catch (e) { return toast(e.message, 'error'); } // must run inside the gesture
    const y = buildAudio(state);
    if (!y) return toast('Need at least 2 points', 'error');
    audio.play(y, $('#loop-sw').checked);
    silentSwitchHint();
  },
  stop: () => audio.stop(),
  'toggle-play'() { if (audio.isPlaying()) actions.stop(); else actions.play(); },
  'zoom-out': () => graph.zoom(2),
  'zoom-in': () => graph.zoom(0.5),
  fit: () => graph.fit(),
  labels() {
    state.label_mode = (state.label_mode + 1) % 3;
    toast(LABELS[state.label_mode]);
    changed('view');
    hooks.afterView?.();
  },
  'select-all'() { S.selectAll(state); changed('select'); },
  deselect() { state.sel.clear(); changed('select'); },
  help() {
    listDialog({
      title: 'Keyboard shortcuts',
      items: SHORTCUT_HELP.map(([k, d]) => ({ label: `${k} — ${d}`, value: null })),
    });
  },
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.closest('dialog')) return;
  if (e.detail > 0) btn.blur(); // pointer clicks shouldn't leave focus on the button (Space = play)
  const fn = actions[btn.dataset.action];
  if (fn) fn();
});

xf.addEventListener('keydown', (e) => { if (e.key === 'Enter') actions.add(); });
yf.addEventListener('keydown', (e) => { if (e.key === 'Enter') actions.add(); });

// ---- keyboard shortcuts -----------------------------------------------------------------------

const SHORTCUT_HELP = [
  ['Space', 'Play / Stop'], ['⌘/Ctrl+Z', 'Undo'], ['Delete', 'Delete selection'],
  ['⌘/Ctrl+C / V', 'Copy / paste points'], ['⌘/Ctrl+A', 'Select all points'], ['D', 'Toggle draw mode'],
  ['L / C', 'Connect line / curve'], ['P', 'Flip polarity'], ['+ / − / 0', 'Zoom in / out / fit'],
  ['Esc', 'Clear selection'], ['Shift+drag', 'Box select (⌘/Ctrl to toggle)'], ['Wheel / pinch', 'Zoom'],
];

function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(el.type);
}

document.addEventListener('keydown', (e) => {
  if (isDialogOpen() || isTyping(e.target)) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  let act = null;
  if (mod && !e.altKey) {
    act = { z: 'undo', c: 'copy', v: 'paste', a: 'select-all' }[k.toLowerCase()] ?? null;
    if (k.toLowerCase() === 'z' && e.shiftKey) act = null; // no redo
  } else if (!e.altKey) {
    act = {
      ' ': 'toggle-play', Delete: 'delete', Backspace: 'delete', d: 'draw', D: 'draw', l: 'line', L: 'line',
      c: 'curve', C: 'curve', p: 'polarity', P: 'polarity', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out',
      '_': 'zoom-out', '0': 'fit', Escape: 'deselect',
    }[k] ?? null;
    // Space on a focused slider/switch is harmless, but arrows etc. belong to the control.
    if (act && act !== 'toggle-play' && e.target?.type === 'range' && k.startsWith('Arrow')) act = null;
  }
  if (!act || !actions[act]) return;
  e.preventDefault();
  actions[act]();
});

// ---- boot -------------------------------------------------------------------------------------

$('#version').textContent = APP_VERSION;
$('#foot-version').textContent = `TraceTone ${APP_VERSION} (based on v.16)`;
syncUI();
graph.fit();
window.TraceTone = { state, graph, actions, version: APP_VERSION }; // for debugging from the console

export { state, graph, actions, hooks, changed, report, fillBoxes, syncUI };
