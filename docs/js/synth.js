// Audio rendering (port of build_audio / normalize_audio from v.16, with a seamless cycle mode).
import { SR, MAX_OUT, CYCLE_SECONDS, clamp } from './params.js';
import { evalCurve } from './curve.js';

const FADE = Math.trunc(0.003 * SR); // 132 samples, as int(.003*SR) in v.16

// 3 ms linear fade in/out in place (numpy.linspace ramp semantics).
export function applyFades(y) {
  const f = Math.min(FADE, Math.floor(y.length / 2));
  if (f <= 1) return y;
  const step = 1 / (f - 1);
  const n = y.length;
  for (let i = 0; i < f; i++) {
    const r = i === f - 1 ? 1 : i * step;
    y[i] *= r;
    y[n - 1 - i] *= r;
  }
  return y;
}

// One-shot mode: read the graph at speed pitch*(1+FM) until end_x (max 20 s). Bit-for-bit v.16 math.
export function buildOneShot(s) {
  const end = clamp(s.end_x, 0.01, s.duration);
  const speedMin = Math.max(0.02, s.pitch * (1 - s.fm_depth));
  const n = Math.trunc(Math.min(MAX_OUT, end / speedMin) * SR) + 1;
  const c = 2 * Math.PI * s.fm_rate;
  const read = new Float64Array(n);
  let acc = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const speed = s.pitch * (1 + s.fm_depth * Math.sin(c * (i / SR)));
    acc += Math.max(speed, 0.02);
    const r = acc / SR;
    if (!(r < end)) break; // cumsum is increasing, so read < end is a prefix
    read[count++] = r;
  }
  if (count < 2) return null;
  return applyFades(evalCurve(s.pts, read.subarray(0, count)));
}

// Seamless cycle-mode loop layout. The buffer holds a whole number of carrier cycles C (so pitch is
// exact to within sample rounding) and, with FM, a whole number of FM cycles k: the FM rate is nudged
// to k*SR/N, an error of at most ~1/(2C) (< 2%), which is inaudible for vibrato. A final carrier
// scale (~1 +/- 1e-5) absorbs the rounding of N to whole samples.
export function cyclePlan(s) {
  const f0 = s.freq * s.pitch;
  const depth = s.fm_depth;
  let rate = s.fm_rate;
  let fmCycles = null, seam = false;
  let target = CYCLE_SECONDS; // seconds
  if (rate > 0 && depth > 0) {
    if (rate < 1 / MAX_OUT) {
      target = MAX_OUT; // one FM period would exceed 20 s: accept an FM seam
      seam = true;
    } else {
      fmCycles = Math.max(1, Math.round(CYCLE_SECONDS * rate));
      target = fmCycles / rate;
    }
  }
  let C = Math.max(1, Math.round(f0 * target));
  while (C > 1 && C / f0 > MAX_OUT) C--;
  const N = Math.max(2, Math.round(C * SR / f0));
  if (fmCycles) rate = fmCycles * SR / N; // exact whole FM cycles over N samples
  const c = 2 * Math.PI * rate;
  const inst = new Float64Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) {
    const v = Math.max(f0 * (1 + depth * Math.sin(c * (i / SR))), 0);
    inst[i] = v;
    total += v / SR;
  }
  const cycles = Math.max(1, Math.round(total));
  return { N, rate, fmCycles, seam, inst, scale: cycles / total, cycles };
}

// Cycle mode: the graph over [0, end_x] is one period of the tone. No fades unless requested.
export function buildCycle(s, { fades = false } = {}) {
  const end = clamp(s.end_x, 0.01, s.duration);
  const { N, inst, scale } = cyclePlan(s);
  const read = new Float64Array(N);
  let ph = 0;
  for (let i = 0; i < N; i++) {
    read[i] = (ph - Math.floor(ph)) * end;
    ph += inst[i] * scale / SR;
  }
  const y = evalCurve(s.pts, read);
  return fades ? applyFades(y) : y;
}

// Returns Float64Array of raw (un-normalized) samples, or null if there are fewer than 2 points.
// forExport adds fades to cycle-mode output so files start and end cleanly.
export function buildAudio(s, { forExport = false } = {}) {
  if (s.pts.length < 2) return null;
  return s.cycle ? buildCycle(s, { fades: forExport }) : buildOneShot(s);
}

// NaN/Inf -> 0; divide by peak only when the peak exceeds 1.
export function normalizeAudio(y) {
  const out = new Float64Array(y.length);
  let peak = 0;
  for (let i = 0; i < y.length; i++) {
    const v = Number.isFinite(y[i]) ? y[i] : 0;
    out[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  if (peak > 1) for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}
