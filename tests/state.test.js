// State / editing operation tests (behavior of the v.16 App methods, plus undo-with-params).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../docs/js/state.js';
import { fmtG, finite, PARAMS, roundHalfEven, sanitizeName } from '../docs/js/params.js';
import { soundToJSON, parseSound } from '../docs/js/serialize.js';

const withPts = (xys) => {
  const s = S.createState();
  for (const [x, y] of xys) S.insertPoint(s, x, y);
  s.undo = [];
  s.sel.clear();
  return s;
};
const ids = (s, ...idx) => new Set(idx.map((i) => s.pts[i].id));

test('insertPoint sorts, selects, and merges within 1e-4', () => {
  const s = withPts([[1, 0.5], [0.2, -1]]);
  assert.deepEqual(s.pts.map((p) => p.x), [0.2, 1]);
  S.insertPoint(s, 1.00005, 3);
  assert.equal(s.pts.length, 2);
  assert.equal(s.pts[1].y, 3);
  assert.deepEqual(s.sel, ids(s, 1));
  assert.equal(s.undo.length, 1);
});

test('connect applies mode over the whole selected span and uses current curvature', () => {
  const s = withPts([[0, 0], [0.5, 1], [1, 0], [1.5, 1]]);
  s.curv = 3.5;
  s.sel = ids(s, 0, 2);
  S.connect(s, 'curve');
  assert.deepEqual(s.pts.map((p) => p.mode), ['curve', 'curve', 'line', 'line']);
  assert.equal(s.pts[1].curv, 3.5);
  s.sel = ids(s, 0);
  assert.equal(S.connect(s, 'line').error, 'Select 2+ points first');
});

test('polarity flip and title', () => {
  const s = withPts([[0, 0], [0.5, 1], [1, 0]]);
  s.sel = ids(s, 0, 1, 2);
  S.connect(s, 'curve');
  assert.equal(S.polarityTitle(s), 'Polarity +');
  s.sel = ids(s, 0);
  S.flipPolarity(s);
  s.sel = ids(s, 0, 1, 2);
  assert.equal(S.polarityTitle(s), 'Polarity ±');
  S.flipPolarity(s);
  assert.deepEqual(s.pts.map((p) => p.polarity), [1, -1, 1]);
  s.sel = ids(s, 2); // last point never starts a segment
  assert.equal(S.flipPolarity(s).error, 'Select a curve starting point');
});

test('curvature slider live-edits selected curve segments only', () => {
  const s = withPts([[0, 0], [0.5, 1], [1, 0]]);
  s.sel = ids(s, 0, 1, 2);
  S.connect(s, 'curve');
  s.sel = ids(s, 1);
  S.setParam(s, 'curv', 4);
  assert.deepEqual(s.pts.map((p) => p.curv), [1, 4, 1]);
  assert.equal(s.curv, 4);
});

test('copy / paste replaces the pasted range and selects new points', () => {
  const s = withPts([[0, 0], [0.1, 1], [0.2, 0], [1, 0.5], [1.15, 9], [1.3, 0]]);
  s.sel = ids(s, 0, 1, 2);
  const c = S.copySel(s);
  assert.equal(c.msg, 'Copied 3 points');
  assert.deepEqual(S.parseClipText(c.text), s.clip);
  s.sel = ids(s, 3);
  const r = S.paste(s, s.clip);
  assert.equal(r.msg, 'Pasted 3 points');
  assert.deepEqual(s.pts.map((p) => [p.x, p.y]), [[0, 0], [0.1, 1], [0.2, 0], [1, 0], [1.1, 1], [1.2, 0], [1.3, 0]]
    .map(([x, y]) => [x, y]).map(([x, y]) => [s.pts.find((p) => Math.abs(p.x - x) < 1e-9).x, y]));
  assert.equal(s.sel.size, 3);
  // Paste beyond duration drops the points that don't fit.
  s.sel = ids(s, s.pts.length - 1);
  s.pts[s.pts.length - 1].x = 1.95;
  assert.equal(S.paste(s, s.clip).msg, 'Pasted 1 points');
  assert.equal(S.parseClipText('hello'), null);
  assert.equal(S.parseClipText('GraphSynthPoints:{bad'), null);
});

test('undo restores points and parameters; 100-snapshot cap', () => {
  const s = withPts([[0, 0], [1, 1]]);
  S.snapshot(s);
  S.setParam(s, 'freq', 440);
  S.setParam(s, 'duration', 0.5);
  assert.equal(s.end_x, 0.5);
  s.pts[0].y = 7;
  const r = S.undo(s);
  assert.equal(r.durationChanged, true);
  assert.equal(s.freq, 220);
  assert.equal(s.duration, 2);
  assert.equal(s.end_x, 2);
  assert.equal(s.pts[0].y, 0);
  assert.equal(S.undo(s).msg, 'Nothing to undo');
  for (let i = 0; i < 150; i++) S.snapshot(s);
  assert.equal(s.undo.length, 100);
});

test('delete, clear, box select', () => {
  const s = withPts([[0, 0], [0.5, 1], [1, -1]]);
  S.selectInBox(s, 0.4, 1.1, -2, 0.5);
  assert.deepEqual(s.sel, ids(s, 2));
  S.selectInBox(s, 0.4, 1.1, -2, 2, true);
  assert.deepEqual(s.sel, ids(s, 1));
  S.deleteSel(s);
  assert.equal(s.pts.length, 2);
  S.clearAll(s);
  assert.equal(s.pts.length, 0);
  S.undo(s);
  assert.equal(s.pts.length, 2);
});

test('loadSound round-trips soundToJSON and is undoable', () => {
  const s = withPts([[0, 0], [0.5, 1], [1, -1]]);
  s.sel = ids(s, 0, 1);
  S.connect(s, 'curve');
  S.setParam(s, 'fm_rate', 4);
  const saved = JSON.parse(JSON.stringify(soundToJSON(s)));
  const t = S.createState();
  S.loadSound(t, saved);
  const strip = (j) => ({ ...j, points: j.points.map(({ id, ...p }) => p) });
  assert.deepEqual(strip(soundToJSON(t)), strip(saved));
  S.undo(t);
  assert.equal(t.pts.length, 0);
  assert.throws(() => S.loadSound(t, { nope: 1 }));
  assert.equal(t.undo.length, 0, 'failed load does not push undo');
  assert.deepEqual(parseSound('{"points":[]}').points, []);
});

test('readBoxes', () => {
  const s = S.createState();
  assert.deepEqual(S.readBoxes(s, '3', '-2.5'), [2, -2.5]);
  assert.equal(S.readBoxes(s, '', '1'), null);
  assert.equal(S.readBoxes(s, 'x', '1'), null);
  assert.equal(S.readBoxes(s, '1', 'inf'), null);
});

test('helpers: fmtG, finite, mappings, rounding, names', () => {
  const cases = [[0, '0'], [1, '1'], [-0.5, '-0.5'], [1.15, '1.15'], [0.30000000000000004, '0.3'],
    [1234, '1.23e+03'], [0.0001234, '0.000123'], [0.00001234, '1.23e-05'], [12.5, '12.5'], [999.9, '1e+03'],
    [-1.725, '-1.73']];
  for (const [v, want] of cases) assert.equal(fmtG(v), want, String(v));
  assert.equal(finite('1_0'), 10);
  assert.equal(finite(null, 3), 3);
  assert.equal(finite('nan', 2), 2);
  for (const k of ['freq', 'pitch', 'fm_rate', 'fm_depth', 'curv']) {
    for (const v of [0, 0.25, 0.5, 1]) {
      assert.ok(Math.abs(PARAMS[k].toSlider(PARAMS[k].fromSlider(v)) - v) < 1e-12, k);
    }
  }
  assert.equal(PARAMS.duration.fromSlider(0.5), 2.55);
  assert.equal(roundHalfEven(2.5), 2);
  assert.equal(roundHalfEven(3.5), 4);
  assert.equal(roundHalfEven(-2.5), -2);
  assert.equal(sanitizeName('  my/snd:1 '), 'mysnd1');
});
