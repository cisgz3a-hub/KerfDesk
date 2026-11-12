// Display-resolution adjustment preview (ADR-245 Amendment 1, perf audit
// S5-P2-1). A slider step previews only the document window the canvas
// shows, at the canvas's own resolution, in buffers kept for the whole
// dialog. OK still runs commitAdjustment on the full-resolution layer, so
// nothing here can change the applied pixels.
//
// Pointwise adjustments (each output pixel depends only on its own input)
// run on the sampled window. Neighbourhood filters (blur, median, screens)
// run at full resolution on a reused scratch copy and are sampled after,
// so their radius and screen pitch stay in document pixels. On a large
// document that filter runs in a worker instead (adjust-filter-preview.ts,
// ADR-245 Amendment 2), and composeFilteredWindow composites what it sends
// back. At 100% zoom or closer the window is copied, not averaged, and the
// preview equals the committed composite byte for byte.

import type { CurvePoint } from '../../core/image-adjust';
import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../../core/image-edit';
import { compositeLayersInPlace, type EditorLayer } from '../../core/image-layers';
import { maskBounds, type SelectionMask } from '../../core/image-select';
import { adjustmentById, runAdjustment, type AdjustmentId } from './editor-adjustments';
import type { EditorSession } from './editor-session';
import type { EditorView } from './image-editor-types';

/** A document-space window and the pixel size it is previewed at. */
export type PreviewWindow = {
  readonly rect: PixelRect;
  readonly width: number;
  readonly height: number;
};

export type AdjustRequest = {
  readonly id: AdjustmentId;
  readonly params: Readonly<Record<string, number>>;
  readonly curvePoints?: readonly CurvePoint[] | undefined;
};

type Workspace = {
  readonly session: EditorSession;
  readonly win: PreviewWindow;
  readonly pointwise: boolean;
  /** The session's layers with window-sized stand-ins; the active one is `working`. */
  readonly layers: readonly EditorLayer[];
  /** Pointwise only: the sampled active layer the op restarts from each step. */
  readonly activeBase: RgbaBuffer | null;
  readonly mask: SelectionMask | null;
  readonly working: RgbaBuffer;
  readonly output: RgbaBuffer;
  /** Neighbourhood filters only: the full-resolution copy the op runs on. */
  scratch: RgbaBuffer | null;
};

/** Buffers reused across one dialog's steps; `current` is dropped on close. */
export type AdjustPreviewCache = { current: Workspace | null };

/** The whole document at full resolution (the 1:1 reference preview). */
export function fullPreviewWindow(doc: RgbaBuffer): PreviewWindow {
  const rect = { x: 0, y: 0, width: doc.width, height: doc.height };
  return { rect, width: doc.width, height: doc.height };
}

/**
 * The part of the document the canvas shows, clipped to `clip` (the
 * selection bounds), sized at the view scale but never above 1:1. Null
 * when none of it is on screen.
 */
export function previewWindow(
  doc: { readonly width: number; readonly height: number },
  view: EditorView | null,
  viewport: { readonly width: number; readonly height: number },
  clip: PixelRect | null,
): PreviewWindow | null {
  const visible = visibleRect(doc, view, viewport);
  const rect = clip === null ? visible : intersect(visible, clip);
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scale = view !== null && view.scale > 0 ? Math.min(1, view.scale) : 1;
  return {
    rect,
    width: Math.max(1, Math.min(rect.width, Math.round(rect.width * scale))),
    height: Math.max(1, Math.min(rect.height, Math.round(rect.height * scale))),
  };
}

let boundsMemo: { readonly mask: SelectionMask; readonly rect: PixelRect | null } | null = null;

/** maskBounds, remembered for the last mask so slider steps skip the scan. */
export function selectionBounds(selection: SelectionMask | null): PixelRect | null {
  if (selection === null) return null;
  if (boundsMemo?.mask !== selection) boundsMemo = { mask: selection, rect: maskBounds(selection) };
  return boundsMemo.rect;
}

/**
 * Preview `request` over `win`: the session's composite with the adjusted
 * active layer substituted in (ADR-245), window-sized. The returned buffer
 * belongs to `cache` and is overwritten by the next step.
 */
export function computeWindowPreview(
  cache: AdjustPreviewCache,
  session: EditorSession,
  request: AdjustRequest,
  win: PreviewWindow,
): RgbaBuffer {
  const pointwise = adjustmentById(request.id).pointwise;
  const ws = workspaceFor(cache, session, win, pointwise);
  const { id, params, curvePoints } = request;
  if (ws.activeBase !== null) {
    ws.working.data.set(ws.activeBase.data);
    runAdjustment(id, params, ws.working, null, ws.mask, curvePoints);
  } else {
    ws.scratch ??= {
      width: session.doc.width,
      height: session.doc.height,
      data: new Uint8ClampedArray(session.doc.data.length),
    };
    ws.scratch.data.set(session.doc.data);
    const clip = selectionBounds(session.selection);
    runAdjustment(id, params, ws.scratch, clip, session.selection, curvePoints);
    sampleWindowInto(ws.scratch, win, ws.working);
  }
  return composite(ws);
}

/**
 * The preview of a neighbourhood filter the worker ran: `filtered` is its
 * window-sized sample of the filtered active layer over `win`. Composited
 * exactly as computeWindowPreview composites its own sample.
 */
export function composeFilteredWindow(
  cache: AdjustPreviewCache,
  session: EditorSession,
  win: PreviewWindow,
  filtered: RgbaBuffer,
): RgbaBuffer {
  const ws = workspaceFor(cache, session, win, false);
  ws.working.data.set(filtered.data);
  return composite(ws);
}

function composite(ws: Workspace): RgbaBuffer {
  ws.output.data.fill(255);
  compositeLayersInPlace(ws.output, ws.layers);
  return ws.output;
}

function workspaceFor(
  cache: AdjustPreviewCache,
  session: EditorSession,
  win: PreviewWindow,
  pointwise: boolean,
): Workspace {
  const previous = cache.current;
  if (
    previous !== null &&
    previous.session === session &&
    previous.pointwise === pointwise &&
    sameWindow(previous.win, win)
  )
    return previous;
  const blank = (): RgbaBuffer => ({
    width: win.width,
    height: win.height,
    data: new Uint8ClampedArray(win.width * win.height * RGBA_CHANNELS),
  });
  const working = blank();
  const layers = session.layers.map((layer): EditorLayer => {
    if (layer.buffer === session.doc) return { ...layer, buffer: working };
    // Hidden layers keep their own buffer: the composite skips them unread.
    if (!layer.isVisible || layer.opacity <= 0) return layer;
    const sample = blank();
    sampleWindowInto(layer.buffer, win, sample);
    return { ...layer, buffer: sample };
  });
  const activeBase = pointwise ? blank() : null;
  if (activeBase !== null) sampleWindowInto(session.doc, win, activeBase);
  const workspace: Workspace = {
    session,
    win,
    pointwise,
    layers,
    activeBase,
    mask: session.selection === null ? null : sampleMask(session.selection, win),
    working,
    output: blank(),
    scratch: previous?.session === session ? previous.scratch : null,
  };
  cache.current = workspace;
  return workspace;
}

/** Copy (1:1) or area-average `win.rect` of `source` into window-sized `target`. */
export function sampleWindowInto(source: RgbaBuffer, win: PreviewWindow, target: RgbaBuffer): void {
  const { rect } = win;
  if (win.width === rect.width && win.height === rect.height) {
    const rowBytes = rect.width * RGBA_CHANNELS;
    for (let row = 0; row < rect.height; row += 1) {
      const from = ((rect.y + row) * source.width + rect.x) * RGBA_CHANNELS;
      target.data.set(source.data.subarray(from, from + rowBytes), row * rowBytes);
    }
    return;
  }
  const xs = spanEdges(rect.x, rect.width, win.width);
  const ys = spanEdges(rect.y, rect.height, win.height);
  const sums = new Float64Array(win.width * RGBA_CHANNELS);
  for (let j = 0; j < win.height; j += 1) {
    sums.fill(0);
    const y0 = ys[j] ?? 0;
    const y1 = ys[j + 1] ?? 0;
    for (let y = y0; y < y1; y += 1) accumulateRow(source, y, xs, sums);
    writeAverages(target.data, j * win.width * RGBA_CHANNELS, xs, y1 - y0, sums);
  }
}

// Straight alpha: colour is averaged weighted by alpha, so transparent
// pixels never bleed their (meaningless) colour into a visible neighbour.
function accumulateRow(source: RgbaBuffer, y: number, xs: Int32Array, sums: Float64Array): void {
  const src = source.data;
  const rowBase = y * source.width * RGBA_CHANNELS;
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const start = rowBase + (xs[i] ?? 0) * RGBA_CHANNELS;
    const end = rowBase + (xs[i + 1] ?? 0) * RGBA_CHANNELS;
    accumulateBox(src, start, end, sums, i * RGBA_CHANNELS);
  }
}

function accumulateBox(
  src: Uint8ClampedArray,
  start: number,
  end: number,
  sums: Float64Array,
  s: number,
): void {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let p = start; p < end; p += RGBA_CHANNELS) {
    const alpha = src[p + 3] ?? 0;
    r += (src[p] ?? 0) * alpha;
    g += (src[p + 1] ?? 0) * alpha;
    b += (src[p + 2] ?? 0) * alpha;
    a += alpha;
  }
  sums[s] = (sums[s] ?? 0) + r;
  sums[s + 1] = (sums[s + 1] ?? 0) + g;
  sums[s + 2] = (sums[s + 2] ?? 0) + b;
  sums[s + 3] = (sums[s + 3] ?? 0) + a;
}

function writeAverages(
  out: Uint8ClampedArray,
  base: number,
  xs: Int32Array,
  rows: number,
  sums: Float64Array,
): void {
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const s = i * RGBA_CHANNELS;
    const alphaSum = sums[s + 3] ?? 0;
    const weight = alphaSum > 0 ? 1 / alphaSum : 0;
    out[base + s] = Math.round((sums[s] ?? 0) * weight);
    out[base + s + 1] = Math.round((sums[s + 1] ?? 0) * weight);
    out[base + s + 2] = Math.round((sums[s + 2] ?? 0) * weight);
    out[base + s + 3] = Math.round(alphaSum / (((xs[i + 1] ?? 0) - (xs[i] ?? 0)) * rows));
  }
}

function sampleMask(mask: SelectionMask, win: PreviewWindow): SelectionMask {
  const { rect } = win;
  const alpha = new Uint8Array(win.width * win.height);
  const xs = spanEdges(rect.x, rect.width, win.width);
  const ys = spanEdges(rect.y, rect.height, win.height);
  for (let j = 0; j < win.height; j += 1) {
    const y0 = ys[j] ?? 0;
    const y1 = ys[j + 1] ?? 0;
    for (let i = 0; i < win.width; i += 1) {
      const x0 = xs[i] ?? 0;
      const x1 = xs[i + 1] ?? 0;
      let sum = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) sum += mask.alpha[y * mask.width + x] ?? 0;
      }
      alpha[j * win.width + i] = Math.round(sum / ((x1 - x0) * (y1 - y0)));
    }
  }
  return { width: win.width, height: win.height, alpha };
}

// Source edges of `count` boxes over [start, start + length); each box is at
// least one pixel because count <= length.
function spanEdges(start: number, length: number, count: number): Int32Array {
  const edges = new Int32Array(count + 1);
  for (let i = 0; i <= count; i += 1) edges[i] = start + Math.floor((i * length) / count);
  return edges;
}

function visibleRect(
  doc: { readonly width: number; readonly height: number },
  view: EditorView | null,
  viewport: { readonly width: number; readonly height: number },
): PixelRect {
  const full = { x: 0, y: 0, width: doc.width, height: doc.height };
  if (view === null || !(view.scale > 0) || viewport.width <= 0 || viewport.height <= 0) {
    return full;
  }
  return intersect(full, {
    x: Math.floor(-view.panX / view.scale),
    y: Math.floor(-view.panY / view.scale),
    width: Math.ceil(viewport.width / view.scale) + 1,
    height: Math.ceil(viewport.height / view.scale) + 1,
  });
}

function intersect(a: PixelRect, b: PixelRect): PixelRect {
  const x = Math.max(a.x, Math.floor(b.x));
  const y = Math.max(a.y, Math.floor(b.y));
  const right = Math.min(a.x + a.width, Math.ceil(b.x + b.width));
  const bottom = Math.min(a.y + a.height, Math.ceil(b.y + b.height));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function sameWindow(a: PreviewWindow, b: PreviewWindow): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  );
}
