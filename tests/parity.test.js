// Parity tests: JS port vs. fixtures generated from the v.16 Python reference (tests/gen_fixtures.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evalCurve } from '../docs/js/curve.js';
import { buildOneShot } from '../docs/js/synth.js';
import { encodeWav, encodeAiff, encodeMidi } from '../docs/js/encoders.js';
import { parseSound } from '../docs/js/serialize.js';

const fx = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const json = (name) => JSON.parse(readFileSync(fx(name), 'utf8'));
const f64 = (name) => {
  const b = readFileSync(fx(name));
  return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

test('evalCurve matches eval_curve', () => {
  for (const c of json('eval_curve.json')) {
    const y = evalCurve(c.pts, c.t);
    assert.equal(y.length, c.y.length, c.name);
    for (let i = 0; i < y.length; i++) {
      assert.ok(Math.abs(y[i] - c.y[i]) <= 1e-12, `${c.name}[${i}] t=${c.t[i]}: ${y[i]} vs ${c.y[i]}`);
    }
  }
});

const audioCases = json('audio_cases.json');
const stateFor = (c) => ({
  pts: c.points, end_x: c.end_x, duration: 2, cycle: false, freq: 220,
  pitch: c.pitch, fm_rate: c.fm_rate, fm_depth: c.fm_depth,
});

test('one-shot buildAudio matches build_audio', () => {
  for (const c of audioCases) {
    const ref = f64(`${c.name}.f64`);
    const y = buildOneShot(stateFor(c));
    assert.equal(y.length, ref.length, `${c.name} length`);
    let worst = 0;
    for (let i = 0; i < y.length; i++) worst = Math.max(worst, Math.abs(y[i] - ref[i]));
    assert.ok(worst <= 1e-9, `${c.name} max diff ${worst}`);
  }
});

test('WAV and AIFF bytes match write_wav / write_aiff', () => {
  for (const c of audioCases) {
    const y = f64(`${c.name}.f64`);
    assert.deepEqual(Buffer.from(encodeWav(y)), readFileSync(fx(`${c.name}.wav`)), `${c.name}.wav`);
    assert.deepEqual(Buffer.from(encodeAiff(y)), readFileSync(fx(`${c.name}.aiff`)), `${c.name}.aiff`);
  }
});

test('MIDI bytes match write_midi', () => {
  for (const c of json('midi_cases.json')) {
    assert.deepEqual(Buffer.from(encodeMidi(c.freq, c.duration)), readFileSync(fx(c.file)), c.file);
  }
});

test('parseSound matches load_sound (except the cycle default)', () => {
  for (const c of json('load_cases.json')) {
    const got = parseSound(c.input);
    const exp = { ...c.expected };
    if (!('cycle' in c.input)) {
      assert.equal(exp.cycle, false, 'v.16 defaults a missing cycle key to False');
      exp.cycle = true; // deliberate fix (plan §3.4)
    }
    assert.deepEqual(got, exp, c.name);
  }
});
