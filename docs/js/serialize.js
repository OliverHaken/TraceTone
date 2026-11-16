// Sound JSON in/out, compatible with v.16 GraphSounds/*.json files.
import { MAX_DUR, MAX_CURVATURE, clamp, finite, sign } from './params.js';

export const DEFAULTS = Object.freeze({
  duration: 2, end_x: 2, pitch: 1, fm_rate: 0, fm_depth: 0, curv: 1, cycle: true, freq: 220,
});

// Same key order as v.16's save_sound().
export function soundToJSON(s) {
  return {
    points: s.pts.map((p) => ({ id: p.id, x: p.x, y: p.y, mode: p.mode, curv: p.curv, polarity: p.polarity })),
    duration: s.duration, end_x: s.end_x, pitch: s.pitch, fm_rate: s.fm_rate, fm_depth: s.fm_depth,
    curv: s.curv, cycle: s.cycle, freq: s.freq,
  };
}

// Validate and clamp like load_sound(). Points come back without ids (assigned by the caller).
// Difference from v.16: a missing 'cycle' key means true (the fresh-session default).
export function parseSound(d) {
  if (typeof d === 'string') d = JSON.parse(d);
  if (!d || typeof d !== 'object' || !Array.isArray(d.points)) throw new Error('Not a TraceTone sound file');
  const curv = clamp(finite(d.curv ?? 1, 1), 0, MAX_CURVATURE);
  const points = d.points
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      x: finite(p.x),
      y: finite(p.y),
      mode: p.mode === 'curve' ? 'curve' : 'line',
      curv: clamp(finite(p.curv ?? 1, 1), 0, MAX_CURVATURE), // v.16: p.get('curv', 1)
      polarity: sign(p.polarity ?? 1),
    }))
    .sort((a, b) => a.x - b.x);
  const duration = clamp(finite(d.duration ?? 2, 2), 0.1, MAX_DUR);
  return {
    points,
    duration,
    end_x: clamp(finite(d.end_x ?? duration, duration), 0.01, duration),
    pitch: clamp(finite(d.pitch ?? 1, 1), 0.25, 4),
    fm_rate: clamp(finite(d.fm_rate ?? 0), 0, 20),
    fm_depth: clamp(finite(d.fm_depth ?? 0), 0, 1),
    curv,
    cycle: 'cycle' in d ? Boolean(d.cycle) : true,
    freq: clamp(finite(d.freq ?? 220, 220), 55, 1760),
  };
}
