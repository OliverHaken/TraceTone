// Waveform curve evaluation (port of eval_curve / update_amp_view from v.16).
import { sign, strengthOf } from './params.js';

// Index of the last x <= t (numpy searchsorted(side='right') - 1); -1 if none.
function lastLE(xs, t) {
  let lo = 0, hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid] <= t) lo = mid + 1; else hi = mid;
  }
  return lo - 1;
}

// pts: sorted by x. t: array-like of times. Returns Float64Array.
// Segment i (pts[i] -> pts[i+1]) uses pts[i].mode/curv/polarity. Outside [x0, xLast) the value is 0.
export function evalCurve(pts, t) {
  const n = t.length;
  const out = new Float64Array(n);
  const m = pts.length;
  if (m < 2) return out;
  const xs = new Float64Array(m), ys = new Float64Array(m), k = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const p = pts[j];
    xs[j] = p.x;
    ys[j] = p.y;
    // k[j] = polarity * strength for curves, 0 for lines (flag via NaN-free check below)
    k[j] = p.mode === 'curve' ? sign(p.polarity ?? 1) * strengthOf(p) : NaN;
  }
  for (let q = 0; q < n; q++) {
    const tq = t[q];
    const i = lastLE(xs, tq);
    if (i < 0 || i >= m - 1) continue;
    const dx = Math.max(xs[i + 1] - xs[i], 1e-9);
    let u = (tq - xs[i]) / dx;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    let s = u;
    if (!Number.isNaN(k[i])) s = u + k[i] * Math.sin(Math.PI * u) / Math.PI;
    out[q] = ys[i] + (ys[i + 1] - ys[i]) * s;
  }
  return out;
}

// Graph amplitude half-range: covers control points and a bound on curve overshoot (x1.15, min 1).
export function ampViewBound(pts) {
  let peak = 0;
  for (const p of pts) peak = Math.max(peak, Math.abs(p.y));
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1];
    if (p.mode === 'curve') {
      peak = Math.max(peak, Math.abs(p.y) + Math.abs(q.y - p.y) * (1 + strengthOf(p) / Math.PI));
    }
  }
  return Math.max(1, peak * 1.15);
}
