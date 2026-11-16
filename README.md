# TraceTone

Draw a waveform with points, connect the points with lines or curves, and play the trace as a tone or a sample.

- **Web app:** https://oliverhaken.github.io/TraceTone/. It is a static site in `docs/` with no build step.
- **Original:** `TRACETONE.txt`, the Pythonista 3 app (v.16) that the web version is ported from.
- **Port plan:** [`plans/htmlport.md`](plans/htmlport.md)

## Using it

| Do this | How |
|---|---|
| Add points | Turn on **Draw Point** and tap the graph, or type x/amplitude and press **Add** |
| Select | Tap a point to toggle it. On desktop, Shift-drag draws a selection box (add ⌘/Ctrl to toggle points instead) |
| Move / pan / zoom | Drag a point to move it, or drag empty space to pan. Use pinch, the scroll wheel, or **Zoom ± / Fit** to zoom |
| Shape | Select 2+ points, then **Connect Line** or **Connect Curve**. **Curve k** sets curvature (0–5) and also changes selected curves. **Polarity** flips a curve's bulge |
| Sound | In **Cycle mode**, the graph from 0 to End X is one period of a tone at *Frequency × Pitch*. With Cycle mode off, the graph plays once as a sample at *Pitch* speed. **FM** adds vibrato |
| Keep | **Save to Library** keeps the sound in this browser. **Share** exports WAV, AIFF, MIDI or JSON. **Import JSON** opens v.16 `GraphSounds/*.json` files. The current session saves itself automatically |

Keyboard shortcuts: Space plays and stops, ⌘/Ctrl+Z undoes, Delete removes the selection, ⌘/Ctrl+C/V copies and pastes, ⌘/Ctrl+A selects all, D toggles draw, L/C connects with a line/curve, P flips polarity, +/−/0 zooms in/out/fits, and Esc deselects.

## Development

```sh
npm run serve      # http://localhost:8000 (python3 static server for docs/)
npm test           # node --test: parity with v.16 + cycle-mode + state tests
python3 tests/gen_fixtures.py   # regenerate golden fixtures (needs numpy)
```

`docs/js/` has pure modules that the Node tests import (`curve`, `synth`, `encoders`, `params`, `serialize` and
`state`) and browser modules (`graph`, `audio`, `library`, `ui` and `main`). GitHub Pages serves `docs/` from `main`.
