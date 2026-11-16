// Web Audio playback: pre-rendered buffer -> AudioBufferSourceNode -> GainNode (click-free start/stop).
import { SR } from './params.js';
import { normalizeAudio } from './synth.js';

const RAMP = 0.003; // seconds
let ctx = null;
let current = null; // {src, gain, start, dur}
let onStateChange = () => {};

export function setStateListener(fn) { onStateChange = fn; }
export const isPlaying = () => !!current;

// Must be called synchronously inside a user gesture (iOS requirement).
export function unlock() {
  if (!ctx) {
    // Let audio play with the iOS ringer switch on silent (Safari 17+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio is not supported in this browser');
    ctx = new AC();
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

export const hasAudioSession = () => 'audioSession' in navigator;

function fadeOutAndStop(entry, when) {
  const { src, gain } = entry;
  const t = Math.max(when, ctx.currentTime);
  try {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + RAMP);
    src.stop(t + RAMP + 0.001);
  } catch { /* already stopped */ }
}

// Earliest time we may rewrite gain automation without disturbing the start ramp.
const editTime = (entry) => Math.max(ctx.currentTime, entry.start + RAMP + 0.0005);

// Schedule a fade at the end of the iteration that is playing (non-looping end).
function scheduleEndFade(entry) {
  const t0 = editTime(entry);
  const iterEnd = entry.start + Math.max(1, Math.ceil((t0 - entry.start) / entry.dur)) * entry.dur;
  const g = entry.gain.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(1, Math.max(t0, iterEnd - RAMP));
  g.linearRampToValueAtTime(0, Math.max(iterEnd, t0 + 0.001));
}

// samples: Float64Array (raw, un-normalized). Stops anything already playing.
export function play(samples, loop) {
  unlock();
  stop();
  const y = normalizeAudio(samples);
  const buf = ctx.createBuffer(1, y.length, SR);
  buf.getChannelData(0).set(Float32Array.from(y));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  const gain = ctx.createGain();
  src.connect(gain).connect(ctx.destination);
  const start = ctx.currentTime + 0.01;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(1, start + RAMP);
  const entry = { src, gain, start, dur: buf.duration };
  current = entry;
  if (!loop) scheduleEndFade(entry);
  src.onended = () => {
    if (current === entry) { current = null; onStateChange(false); }
    try { src.disconnect(); gain.disconnect(); } catch { /* ignore */ }
  };
  src.start(start);
  onStateChange(true);
}

export function stop() {
  if (!current) return;
  const entry = current;
  current = null;
  fadeOutAndStop(entry, ctx.currentTime);
  onStateChange(false);
}

// Live loop toggle (like setting number_of_loops on the v.16 player).
export function setLoop(loop) {
  if (!current) return;
  const entry = current;
  entry.src.loop = loop;
  const g = entry.gain.gain;
  if (loop) {
    const t0 = editTime(entry);
    g.cancelScheduledValues(t0);
    g.setValueAtTime(1, t0);
  } else {
    scheduleEndFade(entry);
  }
}
