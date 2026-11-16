# TraceTone → HTML/CSS/JS port plan

Status: **phases 0–6 implemented** on branch `html-port`. Phase 7 (manual device testing) remains. All decisions are resolved (see §1 and §7).
Source of truth for behavior: `TRACETONE.txt` (TraceTone v.16, Pythonista 3). It stays where it is, unchanged.

## 1. Goal and decisions

Rebuild TraceTone as a static web app on GitHub Pages. There is no backend; everything runs in the browser.

| Decision | Choice |
|---|---|
| Audio engine | **Pre-render only.** Play renders a buffer from the current state (like v.16) and plays it through Web Audio. No AudioWorklet. |
| Tooling | **Vanilla ES modules, no build step.** No npm dependencies. Tests use Node's built-in `node --test`. |
| Hosting | **GitHub Pages serves `/docs` from `main`.** The site lives entirely in `docs/`. Plans live in `plans/`. |
| Library | **Browser storage plus JSON file import and export.** The JSON format matches v.16, so Pythonista `GraphSounds/*.json` files import directly. |
| Devices | **Phone and tablet first** (v.16's portrait and landscape layouts); desktop must also work well with a mouse. |
| Fidelity | **Fix four v.16 quirks** (§3): a curvature control, a seamless cycle-mode loop, undo that covers parameters, and the `cycle` default on load. |
| Extras | **Pinch/wheel zoom, keyboard shortcuts, autosave of the current session.** No PWA or offline support. |
| `TRACETONE.txt` | **Left as is.** The test harness loads it by path with stubbed Pythonista modules. |

## 2. Feature inventory (v.16 → web)

The line numbers refer to `TRACETONE.txt`.

| Area | Pythonista behavior | Web equivalent |
|---|---|---|
| **Data model** | Points `{id, x, y, mode, curv, polarity}`, kept sorted by x. `mode`/`curv`/`polarity` on point *i* describe the segment from *i* to *i+1* (L307) | Same plain objects, same JSON shape |
| **Curve evaluation** | `eval_curve` (L29): piecewise; within a segment `s = u + pol·k·sin(πu)/π`, where k is curvature in [0, 5]. Before the first point and after the last it is 0 | Pure JS over a `Float64Array`, with a binary search in place of `searchsorted` |
| **Graph view** | `draw()` (L152): amplitude grid at ±1, ±½ and 0 of `amp_view`; a "nice step" time grid with labels; green trace; yellow END line; points (selected ones orange, r=8; others r=5); `+`/`−` glyph at the middle of each curve segment; labels (off / index / coords); status line | `<canvas>` scaled for devicePixelRatio, redrawn with `requestAnimationFrame` when state changes |
| **Auto amplitude scale** | `update_amp_view` (L121): peak of the points and a bound on curve overshoot, ×1.15, never below 1 | Same function |
| **Touch interaction** | Hit radius 26 px; 8 px drag threshold. Drag a point to move it (one undo snapshot per drag). Drag empty space to pan (select mode). Tap a point to toggle its selection. Tap empty space to add a point (draw mode) or clear the selection (select mode) | Pointer Events with `setPointerCapture`; `touch-action: none` on the canvas |
| **Zoom / pan** | Zoom ±2× about the view center, Fit, pan clamped to [0, duration], minimum span 0.01 s | Same buttons, plus pinch and wheel zoom (§4.3) |
| **Edit controls** | x/amplitude fields with Add/Set/Done; Draw toggle; Connect Line or Curve over the selection's span; Polarity flip (+/−/± title); Undo (100 deep); Delete; Clear; Copy/Paste (relative x; replaces points in the pasted range; `GraphSynthPoints:` clipboard tag) | Buttons and `<input type="number" inputmode="decimal">`. Clipboard: in-memory first, with `navigator.clipboard` as a bonus |
| **Timing** | Duration 0.1–5 s (rounded to 0.01), End X 0.01–duration, Cycle switch | A range input paired with a number input; the number input replaces the "123" popups |
| **Synth params** | Freq 55–1760 Hz `55·2^(5v)`, Pitch ×0.25–4 `2^((v−.5)·4)`, FM rate 0–20 Hz (linear), FM depth 0–1 (linear) | Same mappings, each in one shared function used in both directions |
| **Audio render** | `build_audio` (L713). *Cycle:* 2 s buffer; the phase accumulator runs at `freq·pitch·(1+depth·sin(2π·rate·t))` and reads the graph over [0, end] once per period. *One-shot:* reads at speed `pitch·(1+FM)` (floor 0.02) up to `end`, capped at 20 s. 3 ms fades. Normalized only when the peak exceeds 1 | Same math into a `Float32Array`, then an `AudioBuffer` and an `AudioBufferSourceNode`. Cycle mode changes per §3.2 |
| **Transport** | Play (regenerates audio), Stop, Loop switch (changes live) | Same; Loop sets `source.loop` live |
| **Library** | `~/Documents/GraphSounds/*.json` plus a `.wav` copy; tap to load, swipe to delete | localStorage plus import and export (§4.5). No `.wav` copy, because audio can be regenerated |
| **Export** | WAV (16-bit mono, 44.1 kHz), AIFF (80-bit float SR), MIDI (one note at freq·pitch for the audio length, then a notice) | Encoders write to an `ArrayBuffer` via `DataView`. Use `navigator.share({files})` where supported, otherwise an `<a download>` Blob link |
| **Layout** | Portrait: graph on the top 36% (min 190 px), scrolling controls below. Landscape: graph on the left 62%, controls on the right | CSS grid with an `orientation` media query; the controls panel scrolls on its own; safe-area insets |
| **Feedback** | `hud_alert` toasts, `input_alert` prompts, `list_dialog` | A toast component and `<dialog>`-based prompt and list dialogs (never `window.prompt`) |

## 3. Fixes over v.16

### 3.1 Curvature control
- Add a **Curve 0.00–5.00** slider (with a number input) to the *Edit points* section, next to Connect Curve.
- It sets `state.curv`, the k used by the next **Connect Curve**. This is the field v.16 already saves and never changes.
- If the selection contains curve segments, moving the slider also updates their `curv` live. That edit is one
  undo step per slider gesture.
- The amplitude auto-scale already accounts for k, so no change is needed there.

### 3.2 Seamless cycle-mode loop
v.16 builds a 2 s buffer and fades both ends by 3 ms, so a looped tone dips every 2 s. With FM on, the phase also jumps at the seam.
- **No fades in cycle mode.** Instead, short gain ramps (3 ms) on a `GainNode` at Play and Stop prevent clicks at start and stop.
- **The buffer holds whole carrier cycles and whole FM cycles.** The target length is 2 s, or, with FM on,
  k FM periods, where k is the integer nearest to 2·rate (at least 1). The buffer is `C` whole carrier cycles
  closest to that target, `N = round(C·SR/f0)`. The FM rate is then nudged to exactly `k·SR/N`; the error is
  under 2%, and a change that small in vibrato rate can't be heard. A final carrier scale `round(Φ)/Φ` (≈1 ± 1e-5)
  absorbs the rounding of N to whole samples, so the pitch is effectively exact. For very slow FM (rate < 0.05 Hz,
  where one period is longer than 20 s), use about 20 s and accept an FM seam.
  *(Revised during implementation: an earlier version scaled the pitch to fit a fixed 2 s buffer, which was up
  to 2% flat at 13.75 Hz.)*
- The phase starts at 0, so sample 0 and sample N continue each other with no discontinuity.
- **Exports in cycle mode** (WAV/AIFF) use the same seamless buffer, plus a 3 ms fade in and out on the exported
  file only, so the file starts and ends cleanly (decided, §7).

### 3.3 Undo covers parameters
- An undo snapshot is `{pts, duration, end_x, freq, pitch, fm_rate, fm_depth, curv, cycle}`, kept 100 deep as in v.16.
- Selection, view (zoom/pan), label mode, draw mode and the Loop switch are not undoable, matching v.16, where they aren't data.
- Sliders take one snapshot per gesture: record it on the first `input` event and close it on `change`. Typed
  number entries take one snapshot per commit.
- Loading a library sound is one undo step, as in v.16.

### 3.4 `cycle` default on load
If a loaded JSON file has no `cycle` key, cycle mode defaults to `true`, the same as a fresh session.

## 4. Architecture

### 4.1 Layout

```
docs/                     ← GitHub Pages root (main branch, /docs)
  .nojekyll               serve files as-is
  index.html              app shell: graph canvas + controls panel + dialogs
  css/app.css             dark theme (v.16 palette: #0B0F14 bg, #4ADE80 trace, #FACC15 END, #FB923C selection, …)
  js/main.js              bootstrap; wires DOM ↔ state; keyboard shortcuts
  js/state.js             state object, undo stack, point ops (insert/set/connect/polarity/delete/clear/copy/paste)
  js/curve.js             evalCurve, ampViewBound             ← pure
  js/synth.js             buildAudio (cycle / one-shot), normalize ← pure
  js/encoders.js          WAV / AIFF / MIDI → ArrayBuffer      ← pure
  js/params.js            slider↔value mappings, clamps, finite()  ← pure
  js/serialize.js         v.16-compatible JSON in/out, validation  ← pure
  js/graph.js             canvas render + pointer/pinch/wheel interaction
  js/audio.js             AudioContext lifecycle, play/stop/loop, iOS unlock
  js/library.js           localStorage library + autosave + file import/export
  js/ui.js                toast, prompt dialog, list dialog
plans/htmlport.md         this file
tests/                    not published
  load_reference.py       loads TRACETONE.txt with ui/sound/console/dialogs stubbed in sys.modules
  gen_fixtures.py         writes tests/fixtures/* from the Python reference
  fixtures/               committed golden outputs
  *.test.js               node --test
package.json              {"private": true, "type": "module", "scripts": {"test": "node --test tests/"}}, with no dependencies
```

Rules:
- Pure modules have no DOM access and are imported directly by the Node tests.
- There is one state object. UI handlers call `state.js` functions, which mutate it, push undo snapshots as
  needed, and call `requestRender()` and `scheduleAutosave()`.
- Module imports use relative paths only, so the site works both at `https://<user>.github.io/TraceTone/` and
  from a local static server.

### 4.2 Graph canvas
- Backing store = CSS size × `devicePixelRatio`; redraw on `ResizeObserver`.
- Render order and colors follow `draw()` exactly. Fonts use `system-ui`, at the same sizes as v.16 (9–13 px).
- The pointer state machine copies `touch_began/moved/ended`: hit test (26 px), then the 8 px threshold, then one
  of: move point (one snapshot), pan, or tap.

### 4.3 Zoom (extra)
- **Pinch:** track two active pointers. Span scales with the ratio of finger distance and is anchored at the
  pinch midpoint's time. Point drags and pans are cancelled when a second finger lands.
- **Wheel:** vertical wheel, or ctrl+wheel (which macOS sends for trackpad pinch), zooms about the cursor's time.
  Horizontal wheel or shift+wheel pans.
- Zoom is on x only; amplitude still auto-scales. The same clamps as v.16 apply (span 0.01 s to duration, within [0, duration]).

### 4.4 Audio
- Create the `AudioContext` lazily on the first Play and call `resume()` inside the gesture, which iOS requires.
- iOS silent switch: set `navigator.audioSession.type = 'playback'` when it exists (Safari 17+). Otherwise show
  a one-time hint that the ringer switch mutes audio.
- The buffer is created at 44.1 kHz. If the device runs at 48 kHz, Web Audio resamples it, so exact parity
  holds only for exports.
- Graph: source → GainNode (start/stop ramps) → destination.

### 4.5 Library, autosave, import and export
- **Library:** localStorage key `tracetone.library.v1` → `{name: soundJSON}`. Names are sanitized the same way
  as in v.16 (alphanumerics, space, `_`, `-`). A `<dialog>` list loads a sound on tap and has a delete button per
  row, with confirmation. Saving under an existing name asks before overwriting.
- **Autosave:** key `tracetone.session.v1` holds the current sound JSON plus the view (`x0`, `x1`, label mode),
  written 500 ms after each state change and on `pagehide`. It is restored on load. A **New** action resets the
  session (and is undoable).
- **Import / export JSON:** *Export JSON* downloads the current sound in v.16 format. *Import* uses
  `<input type="file" accept=".json">`, validates with the same `finite`/`clamp` rules as `load_sound`, and
  loads the file (and offers to add it to the library).
- **Storage failure:** private mode, quota errors or a missing localStorage show a toast; the app keeps working without persistence.
- **Audio export:** a list dialog offers `.wav` / `.aiff` / `.mid` / `.json`, then a name prompt (default
  "TraceTone Instrument"), then share or download. The MIDI notice appears after a MIDI export.

### 4.6 Keyboard shortcuts (extra)
These are ignored while focus is in a text or number input.

| Key | Action |
|---|---|
| Space | Play / Stop toggle |
| Cmd/Ctrl+Z | Undo |
| Delete / Backspace | Delete selection |
| Cmd/Ctrl+C / V | Copy / Paste points |
| Cmd/Ctrl+A | Select all points |
| D | Draw mode toggle |
| L / C | Connect Line / Curve |
| P | Flip polarity |
| + / − / 0 | Zoom in / out / Fit |
| Esc | Clear selection, close dialog |

## 5. Testing

- **Fixture generator** (`tests/gen_fixtures.py`, run with the `mae223` conda env, which has numpy):
  `load_reference.py` puts stub modules for `ui`, `sound`, `console`, `dialogs` and `clipboard` in `sys.modules`
  (with a stub `ui.View` base class), then loads `TRACETONE.txt` through
  `importlib.machinery.SourceFileLoader`. It calls the module-level functions and a minimal `App`-free
  re-statement of `build_audio`'s math, and writes fixtures.
- **Parity tests (JS against Python):**
  - `evalCurve` within 1e-12 over a grid of cases: lines, curves with k = 0, 1, 2.5 and 5, both polarities, t
    outside the range, coincident x values, fewer than 2 points.
  - One-shot `buildAudio`: same length, samples within 1e-9, with FM on and off at several pitches.
  - WAV / AIFF / MIDI encoders byte-identical to the Python writers for the same input.
  - JSON load of fixture files gives the same clamped values (except the deliberate `cycle` default change).
- **Property tests for the new cycle mode** (where there is intentionally no parity):
  - The first and last samples continue each other: |y[N−1] − predicted| is small, and phase(N) is an integer.
  - The FM phase is an integer number of cycles over N.
  - The measured fundamental (zero crossings or FFT peak) is within 0.1% of `freq·pitch`.
- **State tests:** insert/merge within 1e-4, connect over a span, polarity, paste replacing a range, undo
  restoring parameters, and the 100-snapshot cap.
- **Manual matrix (Phase 7):** iPhone Safari (portrait and landscape, silent switch on and off), iPad Safari,
  Android Chrome, desktop Chrome/Firefox/Safari with mouse and trackpad.

## 6. Phases

Each phase ends in a working, deployable state.

| # | Phase | Contents | Done when |
|---|---|---|---|
| 0 | Scaffold | `docs/` skeleton, `.nojekyll`, `package.json`, Pages enabled on `main` `/docs` | The empty dark page loads at the Pages URL |
| 1 | Core math | `curve`, `synth` (one-shot and the new cycle mode), `encoders`, `params`, `serialize`; fixture generator; tests | `npm test` is green |
| 2 | Graph | Canvas render, pointer interaction, zoom buttons and Fit, pinch and wheel zoom, shift-drag box select | Points can be drawn, dragged, panned and zoomed with mouse and touch |
| 3 | Controls | Every section and row from `build_controls`, the curvature slider, the undo-with-params state layer, keyboard shortcuts | Every v.16 button works |
| 4 | Audio | Play/Stop/Loop, gain ramps, iOS unlock and audio session | Cycle and one-shot playback sound right on iPhone and desktop |
| 5 | Persistence | Library dialog, autosave and restore, JSON import and export, WAV/AIFF/MIDI export with share or download | A Pythonista JSON imports, a library sound survives a reload, and exports open in other apps |
| 6 | Polish | Portrait and landscape layouts, safe areas, 36 px touch targets, toasts and dialogs styled | The page looks like v.16 on a phone |
| 7 | Verify | Manual matrix in §5, fix-ups, README with a usage section | Checklist passes |

## 7. Resolved follow-ups

1. **Cycle-mode exports:** WAV/AIFF exports in cycle mode are the seamless loop buffer (§3.2) with a 3 ms fade
   in and out applied to the exported file only. Playback stays fade-free.
2. **Box selection:** on desktop, shift-drag on empty canvas draws a rubber-band rectangle. The points inside it
   are added to the selection; with Cmd/Ctrl held as well, they are toggled. Plain drag still pans (select mode).
   Touch behavior is unchanged from v.16. The box is drawn as a dashed `#FB923C` outline with a 10% fill (Phase 2).
3. **Title and version:** the page `<title>` and header are "TraceTone". A web version string (`APP_VERSION =
   'web 1.0'` in `main.js`, with "based on v.16") is shown in the status line or footer. Bump it on each release.

Repo check: `OliverHaken/TraceTone` is public, so Pages from `main` `/docs` works on a free plan. The site URL will
be `https://oliverhaken.github.io/TraceTone/`.

No open questions remain; Phase 0 can start.
