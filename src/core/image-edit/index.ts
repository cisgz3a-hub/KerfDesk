// Image Studio editor core (Phase L, ADR-242) — pure pixel primitives for the
// in-app raster editor: the RGBA working document, its tile addressing, and
// the editor-local copy-on-write undo history. Paint/selection ops build on
// these in later IE-1 increments.

export type { RgbaBuffer } from './rgba-buffer';
export { cloneRgbaBuffer, createRgbaBuffer } from './rgba-buffer';

export type { TileCoord } from './tiles';
export { TILE_SIZE_PX, tilesForPixelRect } from './tiles';

export type { EditHistory, HistoryEntry } from './history';
export {
  captureTiles,
  createEditHistory,
  EDITOR_HISTORY_BYTE_BUDGET,
  pushHistoryEntry,
  redoInPlace,
  undoInPlace,
} from './history';
