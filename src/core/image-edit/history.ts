// Editor-local undo/redo over copy-on-write tile snapshots (ADR-242).
//
// The project store's whole-Project snapshot undo cannot absorb per-stroke
// pixel history (each snapshot would carry the base64 image blobs), so the
// Image Studio keeps its own stacks here: an entry stores the pre-op pixels of
// only the tiles an op touched, under a byte budget that silently evicts the
// oldest steps (surfaced as "older steps trimmed", flow F-L4 — never a block).
//
// Entries are valid only while document dimensions are unchanged; operations
// that resize the document must clear or re-seed the history.

import type { RgbaBuffer } from './rgba-buffer';
import {
  copyTilePixels,
  type PixelRect,
  TILE_SIZE_PX,
  type TileCoord,
  tilesForPixelRect,
  writeTilePixelsInPlace,
} from './tiles';

export const EDITOR_HISTORY_BYTE_BUDGET = 256 * 1024 * 1024;

export type TileSnapshot = {
  readonly coord: TileCoord;
  readonly pixels: Uint8ClampedArray;
};

export type HistoryEntry = {
  /** Operator-facing label for the History panel ("Brush stroke", "Fill"). */
  readonly label: string;
  /**
   * Which buffer the tiles belong to — the session tags entries with the
   * active layer id so undo can follow strokes across layer switches
   * (V2 plan A2). '' = untagged (single-buffer callers).
   */
  readonly scope: string;
  readonly tiles: readonly TileSnapshot[];
  readonly byteSize: number;
};

export type EditHistory = {
  readonly undoStack: readonly HistoryEntry[];
  readonly redoStack: readonly HistoryEntry[];
  readonly byteBudget: number;
  /** Entries evicted by the budget since the session opened. */
  readonly trimmedCount: number;
};

export function createEditHistory(byteBudget: number = EDITOR_HISTORY_BYTE_BUDGET): EditHistory {
  return { undoStack: [], redoStack: [], byteBudget, trimmedCount: 0 };
}

/**
 * Snapshot the CURRENT pixels of the given tiles. Call this before mutating
 * the buffer, then push the entry once the op has been applied.
 */
export function captureTiles(
  buffer: RgbaBuffer,
  coords: readonly TileCoord[],
  label: string,
  tileSizePx: number = TILE_SIZE_PX,
  scope = '',
): HistoryEntry {
  const tiles = coords.map((coord) => ({
    coord,
    pixels: copyTilePixels(buffer, coord, tileSizePx),
  }));
  const byteSize = tiles.reduce((sum, tile) => sum + tile.pixels.byteLength, 0);
  return { label, scope, tiles, byteSize };
}

/**
 * Snapshot every tile a dirty rect touches — the one-call form of
 * captureTiles for ops that report a PixelRect (strokeDirtyRect etc.).
 */
export function captureRect(
  buffer: RgbaBuffer,
  rect: PixelRect,
  label: string,
  tileSizePx: number = TILE_SIZE_PX,
  scope = '',
): HistoryEntry {
  return captureTiles(
    buffer,
    tilesForPixelRect(buffer, rect, tileSizePx),
    label,
    tileSizePx,
    scope,
  );
}

function stackByteSize(stack: readonly HistoryEntry[]): number {
  return stack.reduce((sum, entry) => sum + entry.byteSize, 0);
}

/**
 * Push a committed op onto the undo stack. Redo is cleared (a new op forks
 * history), then the OLDEST undo entries are evicted until the stacks fit the
 * budget — the just-pushed entry itself is always kept so undo depth is never
 * zero, even for an op larger than the whole budget.
 */
export function pushHistoryEntry(history: EditHistory, entry: HistoryEntry): EditHistory {
  const undoStack = [...history.undoStack, entry];
  let evicted = 0;
  while (undoStack.length > 1 && stackByteSize(undoStack) > history.byteBudget) {
    undoStack.shift();
    evicted += 1;
  }
  return {
    byteBudget: history.byteBudget,
    undoStack,
    redoStack: [],
    trimmedCount: history.trimmedCount + evicted,
  };
}

type StepResult = {
  readonly history: EditHistory;
  /** Label of the step that was applied, or null when the stack was empty. */
  readonly applied: string | null;
};

function moveEntry(
  history: EditHistory,
  working: RgbaBuffer,
  from: 'undoStack' | 'redoStack',
  tileSizePx: number,
): StepResult {
  const source = history[from];
  const entry = source[source.length - 1];
  if (entry === undefined) return { history, applied: null };
  // Capture the buffer's current pixels for the opposite stack BEFORE
  // restoring, so the step is exactly reversible. The counterpart keeps the
  // entry's scope — it targets the same buffer.
  const counterpart = captureTiles(
    working,
    entry.tiles.map((tile) => tile.coord),
    entry.label,
    tileSizePx,
    entry.scope,
  );
  for (const tile of entry.tiles) {
    writeTilePixelsInPlace(working, tile.coord, tile.pixels, tileSizePx);
  }
  const remaining = source.slice(0, -1);
  const next: EditHistory =
    from === 'undoStack'
      ? { ...history, undoStack: remaining, redoStack: [...history.redoStack, counterpart] }
      : { ...history, redoStack: remaining, undoStack: [...history.undoStack, counterpart] };
  return { history: next, applied: entry.label };
}

/** Undo the newest entry into `working` (mutates its pixels in place). */
export function undoInPlace(
  history: EditHistory,
  working: RgbaBuffer,
  tileSizePx: number = TILE_SIZE_PX,
): StepResult {
  return moveEntry(history, working, 'undoStack', tileSizePx);
}

/** Redo the newest undone entry into `working` (mutates its pixels in place). */
export function redoInPlace(
  history: EditHistory,
  working: RgbaBuffer,
  tileSizePx: number = TILE_SIZE_PX,
): StepResult {
  return moveEntry(history, working, 'redoStack', tileSizePx);
}
