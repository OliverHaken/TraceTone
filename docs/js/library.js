// Persistence: sound library + session autosave in localStorage, and file delivery (share/download).
import { soundToJSON } from './serialize.js';

const LIB_KEY = 'tracetone.library.v1';
const SESSION_KEY = 'tracetone.session.v1';

let storageOk = true;
let onStorageError = () => {};
export function setStorageErrorListener(fn) { onStorageError = fn; }

function read(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    storageOk = true;
    return true;
  } catch (e) {
    if (storageOk) onStorageError(e); // report once per failure streak
    storageOk = false;
    return false;
  }
}

// ---- library ----------------------------------------------------------------------------------

// Null-prototype object so names like "__proto__" are ordinary keys.
const lib = () => {
  const l = read(LIB_KEY);
  return Object.assign(Object.create(null), l && typeof l === 'object' && !Array.isArray(l) ? l : {});
};

export function libraryEntries() {
  const l = lib();
  return Object.keys(l).sort().map((name) => ({ name, saved: l[name]?.saved ?? null }));
}

export const hasSound = (name) => Object.hasOwn(lib(), name);
export const getSound = (name) => lib()[name]?.sound ?? null;

export function saveSound(name, state) {
  const l = lib();
  l[name] = { saved: Date.now(), sound: soundToJSON(state) };
  return write(LIB_KEY, l);
}

export function addSoundJSON(name, sound) {
  const l = lib();
  l[name] = { saved: Date.now(), sound };
  return write(LIB_KEY, l);
}

export function deleteSound(name) {
  const l = lib();
  delete l[name];
  return write(LIB_KEY, l);
}

// ---- session autosave -------------------------------------------------------------------------

let timer = null;
let pendingState = null;

export function saveSessionNow(state = pendingState) {
  clearTimeout(timer);
  timer = null;
  pendingState = null;
  if (!state) return;
  write(SESSION_KEY, {
    sound: soundToJSON(state),
    view: { x0: state.view.x0, x1: state.view.x1 },
    label_mode: state.label_mode,
  });
}

export function scheduleSessionSave(state, delay = 500) {
  pendingState = state;
  clearTimeout(timer);
  timer = setTimeout(() => saveSessionNow(), delay);
}

export const flushSession = () => { if (pendingState) saveSessionNow(); };
export const loadSession = () => read(SESSION_KEY);

// ---- file delivery ----------------------------------------------------------------------------

// Share sheet on touch devices that can share files (iOS/Android), otherwise a download.
export async function deliverFile(bytes, filename, mime) {
  const file = new File([bytes], filename, { type: mime });
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (coarse && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      // NotAllowedError etc.: fall through to a download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}
