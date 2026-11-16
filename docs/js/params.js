// Constants, numeric helpers and slider <-> value mappings (mirrors TraceTone v.16).

export const SR = 44100;
export const MAX_DUR = 5.0;
export const MAX_OUT = 20.0;
export const CYCLE_SECONDS = 2.0;
export const MAX_CURVATURE = 5.0;
export const MAX_UNDO = 100;
export const CLIP_TAG = 'GraphSynthPoints:';

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Python's finite(): float(v) if it parses and is finite, else default.
export function finite(v, def = 0) {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'boolean') n = v ? 1 : 0;
  else if (typeof v === 'string') {
    const s = v.trim().replace(/_/g, '');
    if (s === '') return def;
    n = Number(s);
  } else return def;
  return Number.isFinite(n) ? n : def;
}

export const sign = (p) => (finite(p, 1) < 0 ? -1 : 1);
export const strengthOf = (p) => clamp(finite(p.curv ?? 1, 1), 0, MAX_CURVATURE);

// Each parameter: range for manual entry, slider mapping (v in [0,1]) both ways, display format.
export const PARAMS = {
  duration: {
    lo: 0.1, hi: MAX_DUR,
    fromSlider: (v) => Math.round((0.1 + v * 4.9) * 100) / 100,
    toSlider: (x) => (x - 0.1) / 4.9,
    fmt: (x) => x.toFixed(2),
  },
  end_x: {
    lo: 0.01, hi: null, // hi = duration
    fromSlider: (v, s) => clamp(v * s.duration, 0.01, s.duration),
    toSlider: (x, s) => x / s.duration,
    fmt: (x) => x.toFixed(3),
  },
  freq: {
    lo: 55, hi: 1760,
    fromSlider: (v) => 55 * 2 ** (v * 5),
    toSlider: (x) => Math.log2(x / 55) / 5,
    fmt: (x) => x.toFixed(1),
  },
  pitch: {
    lo: 0.25, hi: 4,
    fromSlider: (v) => 2 ** ((v - 0.5) * 4),
    toSlider: (x) => Math.log2(x) / 4 + 0.5,
    fmt: (x) => x.toFixed(3),
  },
  fm_rate: {
    lo: 0, hi: 20,
    fromSlider: (v) => v * 20,
    toSlider: (x) => x / 20,
    fmt: (x) => x.toFixed(2),
  },
  fm_depth: {
    lo: 0, hi: 1,
    fromSlider: (v) => v,
    toSlider: (x) => x,
    fmt: (x) => x.toFixed(2),
  },
  curv: {
    lo: 0, hi: MAX_CURVATURE,
    fromSlider: (v) => v * MAX_CURVATURE,
    toSlider: (x) => x / MAX_CURVATURE,
    fmt: (x) => x.toFixed(2),
  },
};

export function paramRange(key, s) {
  const p = PARAMS[key];
  return [p.lo, p.hi ?? s.duration];
}

// Python '%.<p>g' formatting.
export function fmtG(v, p = 3) {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return Object.is(v, -0) ? '-0' : '0';
  const [mant, expStr] = v.toExponential(p - 1).split('e');
  const e = Number(expStr);
  const strip = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (e < -4 || e >= p) {
    const ae = Math.abs(e);
    return strip(mant) + 'e' + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
  }
  return strip(v.toFixed(Math.max(0, p - 1 - e)));
}

// Python 3 round(): ties to even.
export function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function sanitizeName(name) {
  return String(name ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim();
}
