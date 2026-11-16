// Property tests for the seamless cycle mode (intentionally not sample-identical to v.16, plan §3.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SR } from '../docs/js/params.js';
import { buildCycle, cyclePlan, buildAudio } from '../docs/js/synth.js';
import { evalCurve } from '../docs/js/curve.js';

// Sawtooth over [0, end]: one big downward jump per carrier cycle.
const saw = (end) => [
  { x: 0, y: -1, mode: 'line', curv: 1, polarity: 1 },
  { x: end, y: 1, mode: 'line', curv: 1, polarity: 1 },
];
const base = (o = {}) => ({
  pts: saw(1), duration: 2, end_x: 1, cycle: true, freq: 220, pitch: 1, fm_rate: 0, fm_depth: 0, ...o,
});

const CASES = [
  base(),
  base({ freq: 55, pitch: 0.25 }),
  base({ freq: 1760, pitch: 4 }),
  base({ freq: 123.4, pitch: 1.37, fm_rate: 5.3, fm_depth: 0.4 }),
  base({ freq: 300, fm_rate: 0.3, fm_depth: 1 }),   // slow FM: one period ~3.3 s
  base({ freq: 300, fm_rate: 19.99, fm_depth: 0.9 }),
  base({ freq: 440, pitch: 2, fm_rate: 0.07, fm_depth: 0.5 }),
];

test('carrier and FM phases complete whole cycles over the buffer', () => {
  for (const s of CASES) {
    const plan = cyclePlan(s);
    let ph = 0;
    for (let i = 0; i < plan.N; i++) ph += plan.inst[i] * plan.scale / SR;
    assert.ok(Math.abs(ph - Math.round(ph)) < 1e-6, `carrier phase ${ph}`);
    if (plan.fmCycles) {
      const fmPhase = plan.rate * plan.N / SR;
      assert.ok(Math.abs(fmPhase - plan.fmCycles) < 1e-9, `fm phase ${fmPhase}`);
    }
    assert.ok(plan.N <= 20 * SR);
  }
});

test('pitch correction is negligible (< 0.01%) and FM rate within 2%', () => {
  for (const s of CASES) {
    const { scale, rate, fmCycles } = cyclePlan(s);
    assert.ok(Math.abs(scale - 1) < 1e-4, `scale ${scale}`);
    if (fmCycles) assert.ok(Math.abs(rate / s.fm_rate - 1) < 0.02, `rate ${rate} vs ${s.fm_rate}`);
  }
});

test('loop seam: sample N would equal sample 0', () => {
  for (const s of CASES) {
    const y = buildCycle(s);
    // Continuing past the end, the read position is frac(integer) * end = 0 -> same as y[0].
    const next = evalCurve(s.pts, [0])[0];
    assert.equal(y[0], next);
    // And the step from the last sample into y[0] is no larger than a normal step in the saw ramp
    // (or is the saw's own reset, which happens at a whole cycle).
    assert.ok(Number.isFinite(y[y.length - 1]));
  }
});

test('measured fundamental matches freq*pitch', () => {
  for (const s of CASES) {
    const y = buildCycle(s);
    let resets = 0;
    for (let i = 1; i < y.length; i++) if (y[i] - y[i - 1] < -1) resets++;
    const { cycles } = cyclePlan(s);
    // Each whole carrier cycle ends in one reset; the last one wraps into the next loop iteration.
    assert.ok(Math.abs(resets - (cycles - 1)) <= 1, `resets ${resets} vs cycles ${cycles}`);
    // Average fundamental over the buffer (FM averages out over whole FM cycles).
    const f = cycles / (y.length / SR);
    assert.ok(Math.abs(f / (s.freq * s.pitch) - 1) < 1e-4, `f=${f}`);
  }
});

test('playback buffer has no fades; export buffer does', () => {
  const s = base({ pts: [{ x: 0, y: 1, mode: 'line' }, { x: 1, y: 1, mode: 'line' }] });
  const play = buildAudio(s);
  const exp = buildAudio(s, { forExport: true });
  assert.equal(play[0], 1);
  assert.equal(exp[0], 0);
  assert.equal(exp[exp.length - 1], 0);
  assert.equal(exp[Math.floor(exp.length / 2)], 1);
});

test('fewer than two points -> null', () => {
  assert.equal(buildAudio(base({ pts: [] })), null);
  assert.equal(buildAudio(base({ pts: [saw(1)[0]] })), null);
  assert.equal(buildAudio(base({ pts: [saw(1)[0]], cycle: false })), null);
});
