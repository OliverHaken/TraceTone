// Graph canvas: rendering and pointer interaction (port of GraphView from v.16, plus pinch/wheel
// zoom and shift-drag box selection).
import { evalCurve, ampViewBound } from './curve.js';
import { clamp, fmtG } from './params.js';
import * as S from './state.js';

const PAD = 14;
const HIT_R2 = 26 * 26;
const DRAG_R2 = 8 * 8;
const MIN_SPAN = 0.01;
const FONT = (size, bold = false) => `${bold ? '600 ' : ''}${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
const C = {
  bg: '#090D14', axis: '#334155', grid: '#1E293B', ampText: '#64748B', timeText: '#475569',
  trace: '#4ADE80', end: '#FACC15', glyph: '#F472B6', point: '#E2E8F0', sel: '#FB923C',
  label: '#FDE68A', status: '#94A3B8',
};

export class Graph {
  // hooks: beforeTouch(), onSelect(), onEdit(), onPointMoved(p), onView()
  constructor(canvas, state, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.s = state;
    this.hooks = hooks;
    this.w = 1; this.h = 1; this.dpr = 1;
    this.amp = 1;
    this.g = null;                 // active gesture
    this.pointers = new Map();     // pointerId -> {x, y}
    this.pending = false;

    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.cancel(e));
    canvas.addEventListener('lostpointercapture', (e) => this.cancel(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resize();
  }

  get view() { return this.s.view; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.render();
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.render(); });
  }

  // ---- coordinates -------------------------------------------------------------------------

  toPx(x, y) {
    const { x0, x1 } = this.view;
    return [(x - x0) / Math.max(x1 - x0, 1e-9) * this.w,
      this.h / 2 - y / this.amp * (this.h / 2 - PAD)];
  }

  fromPx(px, py) {
    const { x0, x1 } = this.view;
    return [x0 + px / Math.max(this.w, 1) * (x1 - x0),
      (this.h / 2 - py) / Math.max(this.h / 2 - PAD, 1) * this.amp];
  }

  // ---- view --------------------------------------------------------------------------------

  fit() {
    this.view.x0 = 0;
    this.view.x1 = this.s.duration;
    this.viewChanged();
  }

  // Zoom by `factor` (>1 zooms out) keeping time `anchor` at the same screen position (default: center).
  zoom(factor, anchor = null) {
    const dur = this.s.duration;
    const { x0, x1 } = this.view;
    const span = x1 - x0;
    const a = anchor ?? (x0 + x1) / 2;
    const frac = span > 0 ? (a - x0) / span : 0.5;
    const rng = clamp(span * factor, MIN_SPAN, dur);
    this.setView(a - frac * rng, rng);
  }

  setView(x0, rng) {
    const dur = this.s.duration;
    this.view.x0 = clamp(x0, 0, Math.max(0, dur - rng));
    this.view.x1 = this.view.x0 + rng;
    this.viewChanged();
  }

  // Keep the view inside [0, duration] (e.g. after undo/load changed the duration).
  clampView() {
    const dur = this.s.duration;
    const rng = clamp(this.view.x1 - this.view.x0, MIN_SPAN, dur);
    if (!Number.isFinite(rng)) return this.fit();
    this.setView(this.view.x0, rng);
  }

  viewChanged() {
    this.requestRender();
    this.hooks.onView?.();
  }

  // ---- rendering ---------------------------------------------------------------------------

  render() {
    const { ctx, w, h, s } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);
    this.amp = ampViewBound(s.pts);
    const { x0, x1 } = this.view;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'top';

    const hline = (py, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    };
    const vline = (px, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    };
    const text = (str, x, y, color, font, align = 'left') => {
      ctx.fillStyle = color; ctx.font = font; ctx.textAlign = align;
      if (align === 'center') { // keep centered labels fully inside the canvas
        const half = ctx.measureText(str).width / 2 + 2;
        x = Math.max(half, Math.min(w - half, x));
      }
      ctx.fillText(str, x, y);
    };

    // Amplitude grid
    for (const frac of [-1, -0.5, 0, 0.5, 1]) {
      const yv = frac * this.amp;
      const py = this.toPx(0, yv)[1];
      hline(py, frac === 0 ? C.axis : C.grid);
      text(fmtG(yv), 3, py + 1, C.ampText, FONT(9));
    }

    // Time grid
    const span = Math.max(x1 - x0, 1e-9);
    const raw = span / 6;
    const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? 10 * mag;
    for (let t = Math.ceil(x0 / step) * step; t <= x1 + 1e-9; t += step) {
      const px = this.toPx(t, 0)[0];
      vline(px, C.grid);
      text(fmtG(t) + 's', px + 3, h - 14, C.timeText, FONT(9));
    }

    // Trace
    const left = Math.max(0, x0);
    const end = Math.min(x1, s.end_x);
    if (end > left) {
      const n = Math.max(2, Math.trunc(w * Math.min(this.dpr, 2) * (end - left) / span));
      const ts = new Float64Array(n);
      for (let i = 0; i < n; i++) ts[i] = left + (end - left) * (i / (n - 1));
      const ys = evalCurve(s.pts, ts);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const [px, py] = this.toPx(ts[i], ys[i]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = C.trace;
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // END marker
    if (x0 <= s.end_x && s.end_x <= x1) {
      const px = this.toPx(s.end_x, 0)[0];
      vline(px, C.end);
      text('END', px, 18, C.end, FONT(10, true), 'center');
    }

    // Points, polarity glyphs, labels
    const pts = s.pts;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i < pts.length - 1 && p.mode === 'curve') {
        const q = pts[i + 1];
        const [qx, qy] = this.toPx((p.x + q.x) / 2, (p.y + q.y) / 2);
        if (qx >= -10 && qx <= w + 10) text(p.polarity < 0 ? '−' : '+', qx, qy - 22, C.glyph, FONT(13, true), 'center');
      }
      const [px, py] = this.toPx(p.x, p.y);
      if (px < -10 || px > w + 10) continue;
      const selected = s.sel.has(p.id);
      const r = selected ? 8 : 5;
      ctx.fillStyle = selected ? C.sel : C.point;
      ctx.beginPath(); ctx.arc(px, py, r, 0, 2 * Math.PI); ctx.fill();
      if (s.label_mode) {
        const label = s.label_mode === 1 ? String(i + 1) : `(${fmtG(p.x)}, ${fmtG(p.y)})`;
        text(label, px, py > 34 ? py - 25 : py + 11, C.label, FONT(10, true), 'center');
      }
    }

    // Box selection overlay
    if (this.g?.type === 'box' && this.g.cur) {
      const [ax, ay] = this.g.start, [bx, by] = this.g.cur;
      ctx.fillStyle = 'rgba(251, 146, 60, 0.10)';
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = C.sel;
      ctx.strokeRect(Math.min(ax, bx) + 0.5, Math.min(ay, by) + 0.5, Math.abs(bx - ax), Math.abs(by - ay));
      ctx.setLineDash([]);
    }

    // Status line
    const status = s.draw_mode ? 'DRAW ON' : 'SELECT';
    ctx.font = FONT(10);
    const statusText = `${status}  |  ${pts.length} pts  |  ${x0.toFixed(3)}–${x1.toFixed(3)} s`;
    ctx.fillStyle = 'rgba(9, 13, 20, 0.75)';
    ctx.fillRect(4, 2, ctx.measureText(statusText).width + 8, 15);
    text(`${status}  |  ${pts.length} pts  |  ${x0.toFixed(3)}–${x1.toFixed(3)} s`, 8, 4, C.status, FONT(10));
  }

  // ---- interaction -------------------------------------------------------------------------

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  nearest(px, py) {
    let best = null, bd = HIT_R2;
    for (const p of this.s.pts) {
      const [qx, qy] = this.toPx(p.x, p.y);
      const d = (qx - px) ** 2 + (qy - py) ** 2;
      if (d < bd) { best = p; bd = d; }
    }
    return best;
  }

  down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    const [px, py] = this.pos(e);
    this.pointers.set(e.pointerId, { x: px, y: py });

    if (this.pointers.size === 2) {
      // Second finger: switch to pinch zoom (ends any drag/pan in progress; edits so far are kept).
      if (this.g?.snap) this.hooks.onEdit?.();
      const [a, b] = [...this.pointers.values()];
      const mid = (a.x + b.x) / 2;
      this.g = {
        type: 'pinch', d0: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
        span0: this.view.x1 - this.view.x0, anchor: this.fromPx(mid, 0)[0],
      };
      this.requestRender();
      return;
    }
    if (this.pointers.size > 2) return;

    this.hooks.beforeTouch?.();
    this.amp = ampViewBound(this.s.pts);
    const hit = this.nearest(px, py);
    this.g = {
      type: !hit && e.shiftKey ? 'box' : 'pending', hit, start: [px, py], moved: false, snap: false,
      pan0: [this.view.x0, this.view.x1], toggle: e.metaKey || e.ctrlKey,
    };
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const [px, py] = this.pos(e);
    this.pointers.set(e.pointerId, { x: px, y: py });
    const g = this.g;
    if (!g) return;

    if (g.type === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const d = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
      const mid = (a.x + b.x) / 2;
      const rng = clamp(g.span0 * g.d0 / d, MIN_SPAN, this.s.duration);
      this.setView(g.anchor - mid / this.w * rng, rng);
      return;
    }

    const dx = px - g.start[0], dy = py - g.start[1];
    if (!g.moved && dx * dx + dy * dy < DRAG_R2) return;
    g.moved = true;
    if (g.hit) {
      if (!g.snap) { S.snapshot(this.s); g.snap = true; }
      const [x, y] = this.fromPx(px, py);
      S.movePoint(this.s, g.hit, x, y);
      this.hooks.onPointMoved?.(g.hit);
    } else if (g.type === 'box') {
      g.cur = [px, py];
    } else if (!this.s.draw_mode) {
      const rng = g.pan0[1] - g.pan0[0];
      this.setView(g.pan0[0] - dx / Math.max(this.w, 1) * rng, rng);
      return;
    }
    this.requestRender();
  }

  up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const [px, py] = this.pos(e);
    this.pointers.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') {
      if (this.pointers.size === 0) this.g = null; // remaining finger lifting ends the gesture
      return;
    }
    this.g = null;
    if (!g.moved) {
      if (g.hit) {
        S.toggleSelect(this.s, g.hit.id);
      } else if (this.s.draw_mode && g.type !== 'box') {
        const [x, y] = this.fromPx(px, py);
        S.insertPoint(this.s, clamp(x, 0, this.s.duration), y);
        this.hooks.onEdit?.();
      } else if (g.type !== 'box') {
        this.s.sel.clear();
      }
      this.hooks.onSelect?.();
    } else if (g.type === 'box' && g.cur) {
      const [xa, ya] = this.fromPx(Math.min(g.start[0], px), Math.max(g.start[1], py));
      const [xb, yb] = this.fromPx(Math.max(g.start[0], px), Math.min(g.start[1], py));
      S.selectInBox(this.s, xa, xb, ya, yb, g.toggle);
      this.hooks.onSelect?.();
    } else if (g.snap) {
      this.hooks.onEdit?.();
    }
    this.requestRender();
  }

  cancel(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.g;
    if (g?.type === 'pinch' && this.pointers.size) return;
    this.g = null;
    if (g?.snap) this.hooks.onEdit?.();
    this.requestRender();
  }

  wheel(e) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1;
    let dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    const { x0, x1 } = this.view;
    const span = x1 - x0;
    if (Math.abs(dx) > Math.abs(dy)) {
      this.setView(x0 + dx / this.w * span, span);
    } else if (dy) {
      const [px] = this.pos(e);
      this.zoom(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.002)), this.fromPx(px, 0)[0]);
    }
  }
}
