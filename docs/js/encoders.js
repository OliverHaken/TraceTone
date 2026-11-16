// WAV / AIFF / MIDI encoders -> Uint8Array (byte-compatible with the v.16 writers).
import { SR, clamp, roundHalfEven } from './params.js';
import { normalizeAudio } from './synth.js';

// 16-bit PCM: normalize, clip to [-1, 1], scale by 32767, truncate toward zero (numpy astype).
function writePcm16(dv, offset, y, littleEndian) {
  const n = normalizeAudio(y);
  for (let i = 0; i < n.length; i++) {
    const v = Math.max(-1, Math.min(1, n[i]));
    dv.setInt16(offset + 2 * i, Math.trunc(v * 32767), littleEndian);
  }
}

const ascii = (dv, off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };

export function encodeWav(y, sr = SR) {
  const dataLen = y.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  ascii(dv, 0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  ascii(dv, 8, 'WAVE');
  ascii(dv, 12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);          // PCM
  dv.setUint16(22, 1, true);          // mono
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true);     // byte rate
  dv.setUint16(32, 2, true);          // block align
  dv.setUint16(34, 16, true);         // bits per sample
  ascii(dv, 36, 'data');
  dv.setUint32(40, dataLen, true);
  writePcm16(dv, 44, y, true);
  return new Uint8Array(buf);
}

// IEEE 754 80-bit extended, big-endian (as extended80 in v.16; value must be positive).
export function extended80(value) {
  const exponent = Math.floor(Math.log2(value));
  const mantissa = BigInt(value / 2 ** exponent * 2 ** 63);
  const out = new Uint8Array(10);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, exponent + 16383, false);
  dv.setBigUint64(2, mantissa, false);
  return out;
}

export function encodeAiff(y, sr = SR) {
  const dataLen = y.length * 2;
  const commLen = 18, ssndLen = 8 + dataLen;
  const formLen = 4 + (8 + commLen) + (8 + ssndLen);
  const buf = new ArrayBuffer(8 + formLen);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let o = 0;
  ascii(dv, o, 'FORM'); dv.setUint32(o + 4, formLen, false); o += 8;
  ascii(dv, o, 'AIFF'); o += 4;
  ascii(dv, o, 'COMM'); dv.setUint32(o + 4, commLen, false); o += 8;
  dv.setInt16(o, 1, false);              // channels
  dv.setUint32(o + 2, y.length, false);  // frames
  dv.setInt16(o + 6, 16, false);         // bits
  u8.set(extended80(sr), o + 8); o += commLen;
  ascii(dv, o, 'SSND'); dv.setUint32(o + 4, ssndLen, false); o += 8;
  dv.setUint32(o, 0, false); dv.setUint32(o + 4, 0, false); o += 8;
  writePcm16(dv, o, y, false);
  return u8;
}

// Single note at `frequency` lasting `duration` seconds (120 bpm, 480 ppq -> 960 ticks/s).
export function encodeMidi(frequency, duration) {
  const semis = 69 + 12 * (Math.log(Math.max(frequency, 1e-6) / 440) / Math.log(2));
  const note = clamp(roundHalfEven(semis), 0, 127);
  const ticks = Math.max(1, Math.trunc(duration * 960));
  const vlq = (n) => {
    const b = [n & 127];
    n = Math.floor(n / 128);
    while (n) { b.unshift((n & 127) | 128); n = Math.floor(n / 128); }
    return b;
  };
  const track = [
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // tempo 500000 us/qn
    0x00, 0x90, note, 100,
    ...vlq(ticks), 0x80, note, 0,
    0x00, 0xff, 0x2f, 0x00,
  ];
  const out = new Uint8Array(14 + 8 + track.length);
  const dv = new DataView(out.buffer);
  ascii(dv, 0, 'MThd');
  dv.setUint32(4, 6, false);
  dv.setUint16(8, 0, false);
  dv.setUint16(10, 1, false);
  dv.setUint16(12, 480, false);
  ascii(dv, 14, 'MTrk');
  dv.setUint32(18, track.length, false);
  out.set(track, 22);
  return out;
}
