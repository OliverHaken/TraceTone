// App state, undo stack and point operations (port of the App methods in v.16). No DOM access.
// Ops return {error} or {msg} (shown as a toast) or undefined.
import { MAX_CURVATURE, MAX_UNDO, CLIP_TAG, clamp, finite, sign } from './params.js';
import { DEFAULTS, parseSound } from './serialize.js';

const PARAM_KEYS = ['duration', 'end_x', 'freq', 'pitch', 'fm_rate', 'fm_depth', 'curv', 'cycle'];

export function createState() {
  return {
    pts: [], sel: new Set(), undo: [], uid: 0,
    ...DEFAULTS,
    label_mode: 2, draw_mode: false, clip: null,
    view: { x0: 0, x1: DEFAULTS.duration },
  };
}

export function newPoint(s, x, y, mode = 'line', curv = null, polarity = 1) {
  s.uid += 1;
  return {
    id: s.uid, x: finite(x), y: finite(y), mode: mode === 'curve' ? 'curve' : 'line',
    curv: clamp(finite(curv ?? s.curv, 1), 0, MAX_CURVATURE),
    polarity: sign(polarity),
  };
}

const sortPts = (s) => s.pts.sort((a, b) => a.x - b.x);
export const selIndices = (s) => s.pts.flatMap((p, i) => (s.sel.has(p.id) ? [i] : []));
export const selectedPoint = (s) => (s.sel.size === 1 ? s.pts.find((p) => s.sel.has(p.id)) : null);
// Selected points that start a curve segment (not the last point).
export const selectedCurves = (s) => s.pts.slice(0, -1).filter((p) => s.sel.has(p.id) && p.mode === 'curve');

// ---- undo -------------------------------------------------------------------------------------

function capture(s) {
  const snap = { pts: s.pts.map((p) => ({ ...p })) };
  for (const k of PARAM_KEYS) snap[k] = s[k];
  return snap;
}

export function snapshot(s) {
  s.undo.push(capture(s));
  if (s.undo.length > MAX_UNDO) s.undo.shift();
}

// Returns {durationChanged} on success.
export function undo(s) {
  if (!s.undo.length) return { msg: 'Nothing to undo' };
  const snap = s.undo.pop();
  const oldDur = s.duration;
  s.pts = snap.pts;
  for (const k of PARAM_KEYS) s[k] = snap[k];
  const ids = new Set(s.pts.map((p) => p.id));
  s.sel = new Set([...s.sel].filter((id) => ids.has(id)));
  return { durationChanged: s.duration !== oldDur };
}

// ---- point editing ----------------------------------------------------------------------------

export function insertPoint(s, x, y) {
  snapshot(s);
  const found = s.pts.find((p) => Math.abs(p.x - x) < 1e-4);
  if (found) {
    found.y = y;
    s.sel = new Set([found.id]);
  } else {
    const p = newPoint(s, x, y);
    s.pts.push(p);
    sortPts(s);
    s.sel = new Set([p.id]);
  }
}

// Parse the x / amplitude text boxes like read_boxes().
export function readBoxes(s, xText, yText) {
  const x = finite(xText, NaN), y = finite(yText, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [clamp(x, 0, s.duration), y];
}

export function setPoint(s, x, y) {
  const p = selectedPoint(s);
  if (!p) return { error: 'Select exactly one point' };
  snapshot(s);
  p.x = x;
  p.y = y;
  sortPts(s);
}

// Move a point during a drag (the caller snapshots once per drag).
export function movePoint(s, p, x, y) {
  p.x = clamp(x, 0, s.duration);
  p.y = y;
  sortPts(s);
}

export function connect(s, mode) {
  const idx = selIndices(s);
  if (idx.length < 2) return { error: 'Select 2+ points first' };
  snapshot(s);
  for (let j = 0; j + 1 < idx.length; j++) {
    for (let i = idx[j]; i < idx[j + 1]; i++) {
      const p = s.pts[i];
      p.mode = mode;
      if (mode === 'curve') p.curv = s.curv;
      p.polarity ??= 1;
    }
  }
}

export function flipPolarity(s) {
  const curves = selectedCurves(s);
  if (!curves.length) return { error: 'Select a curve starting point' };
  snapshot(s);
  for (const p of curves) p.polarity = p.polarity > 0 ? -1 : 1;
}

export function polarityTitle(s) {
  const curves = selectedCurves(s);
  if (!curves.length) return 'Polarity +/-';
  const signs = curves.map((p) => sign(p.polarity));
  if (signs.every((v) => v === 1)) return 'Polarity +';
  if (signs.every((v) => v === -1)) return 'Polarity −';
  return 'Polarity ±';
}

export function deleteSel(s) {
  if (!s.sel.size) return;
  snapshot(s);
  s.pts = s.pts.filter((p) => !s.sel.has(p.id));
  s.sel.clear();
}

export function clearAll(s) {
  if (!s.pts.length) return;
  snapshot(s);
  s.pts = [];
  s.sel.clear();
}

export function toggleSelect(s, id) {
  if (s.sel.has(id)) s.sel.delete(id); else s.sel.add(id);
}

export function selectAll(s) {
  s.sel = new Set(s.pts.map((p) => p.id));
}

// Box selection: add (or toggle) points with x in [xa, xb] and y in [ya, yb].
export function selectInBox(s, xa, xb, ya, yb, toggle = false) {
  for (const p of s.pts) {
    if (p.x >= xa && p.x <= xb && p.y >= ya && p.y <= yb) {
      if (toggle) toggleSelect(s, p.id); else s.sel.add(p.id);
    }
  }
}

// ---- copy / paste -----------------------------------------------------------------------------

// Returns {error} or {msg, text} where text is the tagged clipboard string.
export function copySel(s) {
  const idx = selIndices(s);
  if (!idx.length) return { error: 'Select points to copy' };
  const x0 = s.pts[idx[0]].x;
  s.clip = idx.map((i) => {
    const p = s.pts[i];
    return { dx: p.x - x0, y: p.y, mode: p.mode ?? 'line', curv: p.curv ?? 1, polarity: p.polarity ?? 1 };
  });
  return { msg: `Copied ${s.clip.length} points`, text: CLIP_TAG + JSON.stringify(s.clip) };
}

// Parse a tagged clipboard string; null if it isn't one.
export function parseClipText(text) {
  if (typeof text !== 'string' || !text.startsWith(CLIP_TAG)) return null;
  try {
    const c = JSON.parse(text.slice(CLIP_TAG.length));
    return Array.isArray(c) ? c.filter((e) => e && typeof e === 'object') : null;
  } catch {
    return null;
  }
}

export function paste(s, clip) {
  if (!clip || !clip.length) return { error: 'Nothing to paste' };
  const idx = selIndices(s);
  const base = idx.length ? s.pts[idx[idx.length - 1]].x : s.view.x0;
  const fresh = clip.filter((c) => {
    const x = base + finite(c.dx);
    return x >= 0 && x <= s.duration + 1e-9;
  });
  if (!fresh.length) return { error: 'No room here' };
  const xs = fresh.map((c) => base + finite(c.dx));
  const lo = Math.min(...xs), hi = Math.max(...xs);
  snapshot(s);
  s.pts = s.pts.filter((p) => !(lo - 1e-4 <= p.x && p.x <= hi + 1e-4));
  const added = new Set();
  for (const c of fresh) {
    const p = newPoint(s, clamp(base + finite(c.dx), 0, s.duration), finite(c.y),
      c.mode ?? 'line', c.curv ?? 1, c.polarity ?? 1);
    s.pts.push(p);
    added.add(p.id);
  }
  sortPts(s);
  s.sel = added;
  return { msg: `Pasted ${fresh.length} points` };
}

// ---- parameters -------------------------------------------------------------------------------

// Set a synth/timing parameter (already clamped/mapped by the caller). No snapshot here: the UI
// snapshots once per slider gesture or typed entry. Returns {durationChanged}.
export function setParam(s, key, value) {
  if (key === 'duration') {
    s.duration = value;
    s.end_x = clamp(s.end_x, 0.01, s.duration);
    return { durationChanged: true };
  }
  if (key === 'end_x') s.end_x = clamp(value, 0.01, s.duration);
  else if (key === 'cycle') s.cycle = Boolean(value);
  else if (key === 'curv') {
    s.curv = clamp(value, 0, MAX_CURVATURE);
    for (const p of selectedCurves(s)) p.curv = s.curv; // live-edit selected curve segments
  } else s[key] = value;
  return {};
}

// ---- whole-sound operations -------------------------------------------------------------------

export function loadSound(s, data) {
  const d = parseSound(data); // throws on invalid input, before touching state
  snapshot(s);
  s.pts = d.points.map((p) => newPoint(s, p.x, p.y, p.mode, p.curv, p.polarity));
  for (const k of PARAM_KEYS) s[k] = d[k];
  s.sel.clear();
}

export function newSession(s) {
  snapshot(s);
  s.pts = [];
  s.sel.clear();
  for (const k of PARAM_KEYS) s[k] = DEFAULTS[k];
}
