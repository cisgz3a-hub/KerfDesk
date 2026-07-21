// Image Studio editor core (Phase L, ADR-242) — pure pixel primitives for the
// in-app raster editor: the RGBA working document, editor-local copy-on-write
// undo history, and the paint pipeline (brush/pencil/eraser/line as stamped
// strokes). Selection ops arrive in the next IE-1 increment.
//
// The barrel is curated (new-barrel cap: 20 exports). UI imports only this
// surface; intra-module code and tests import the leaf files directly.

export type { RgbaBuffer } from './rgba-buffer';
export { cloneRgbaBuffer, RGBA_CHANNELS } from './rgba-buffer';

export type { PixelRect } from './tiles';

export type { EditHistory } from './history';
export {
  captureRect,
  createEditHistory,
  pushHistoryEntry,
  redoInPlace,
  undoInPlace,
} from './history';

export type { BrushParams, BrushTip } from './brush-stamp';
export { MAX_BRUSH_DIAMETER_PX, MIN_BRUSH_DIAMETER_PX } from './brush-stamp';

export type { PaintColor, PaintPoint, PaintStroke } from './stroke';
export { paintStrokeInPlace, snapLineEnd45, strokeDirtyRect } from './stroke';
