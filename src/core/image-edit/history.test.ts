import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  captureTiles,
  createEditHistory,
  pushHistoryEntry,
  redoInPlace,
  undoInPlace,
} from './history';
import { cloneRgbaBuffer, createRgbaBuffer, RGBA_CHANNELS, rgbaBuffersEqual } from './rgba-buffer';
import { tilesForPixelRect, type PixelRect } from './tiles';

const TILE = 8;

function fillRect(buffer: ReturnType<typeof createRgbaBuffer>, rect: PixelRect, byte: number) {
  const right = Math.min(buffer.width, rect.x + rect.width);
  const bottom = Math.min(buffer.height, rect.y + rect.height);
  for (let y = Math.max(0, rect.y); y < bottom; y += 1) {
    for (let x = Math.max(0, rect.x); x < right; x += 1) {
      const base = (y * buffer.width + x) * RGBA_CHANNELS;
      buffer.data.fill(byte, base, base + RGBA_CHANNELS);
    }
  }
}

// The editing protocol under test, exactly as the UI will drive it:
// capture touched tiles -> mutate the buffer -> push the entry.
function applyOp(
  history: ReturnType<typeof createEditHistory>,
  buffer: ReturnType<typeof createRgbaBuffer>,
  rect: PixelRect,
  byte: number,
  label: string,
) {
  const entry = captureTiles(buffer, tilesForPixelRect(buffer, rect, TILE), label, TILE);
  fillRect(buffer, rect, byte);
  return pushHistoryEntry(history, entry);
}

describe('undoInPlace / redoInPlace', () => {
  it('restores pre-op pixels on undo and re-applies them on redo', () => {
    const buffer = createRgbaBuffer(20, 20);
    const original = cloneRgbaBuffer(buffer);
    let history = createEditHistory();

    history = applyOp(history, buffer, { x: 5, y: 5, width: 6, height: 6 }, 10, 'Brush stroke');
    const afterOp = cloneRgbaBuffer(buffer);
    expect(rgbaBuffersEqual(buffer, original)).toBe(false);

    const undone = undoInPlace(history, buffer, TILE);
    history = undone.history;
    expect(undone.applied).toBe('Brush stroke');
    expect(rgbaBuffersEqual(buffer, original)).toBe(true);

    const redone = redoInPlace(history, buffer, TILE);
    history = redone.history;
    expect(redone.applied).toBe('Brush stroke');
    expect(rgbaBuffersEqual(buffer, afterOp)).toBe(true);
  });

  it('returns applied: null and leaves everything untouched on empty stacks', () => {
    const buffer = createRgbaBuffer(8, 8);
    const history = createEditHistory();
    const result = undoInPlace(history, buffer, TILE);
    expect(result.applied).toBeNull();
    expect(result.history).toBe(history);
    expect(buffer.data.every((byte) => byte === 255)).toBe(true);
  });

  it('a new op after undo clears the redo stack', () => {
    const buffer = createRgbaBuffer(20, 20);
    let history = createEditHistory();
    history = applyOp(history, buffer, { x: 0, y: 0, width: 4, height: 4 }, 20, 'A');
    history = undoInPlace(history, buffer, TILE).history;
    expect(history.redoStack).toHaveLength(1);

    history = applyOp(history, buffer, { x: 8, y: 8, width: 4, height: 4 }, 30, 'B');
    expect(history.redoStack).toHaveLength(0);
    expect(redoInPlace(history, buffer, TILE).applied).toBeNull();
  });
});

describe('byte budget', () => {
  // One full 8-px tile snapshot is 8 * 8 * 4 = 256 bytes.
  const FULL_TILE_BYTES = TILE * TILE * RGBA_CHANNELS;

  it('evicts the oldest entries once the budget overflows and counts them', () => {
    const buffer = createRgbaBuffer(24, 24);
    let history = createEditHistory(FULL_TILE_BYTES * 2);
    history = applyOp(history, buffer, { x: 0, y: 0, width: TILE, height: TILE }, 1, 'first');
    history = applyOp(history, buffer, { x: 8, y: 0, width: TILE, height: TILE }, 2, 'second');
    expect(history.undoStack.map((entry) => entry.label)).toEqual(['first', 'second']);
    expect(history.trimmedCount).toBe(0);

    history = applyOp(history, buffer, { x: 16, y: 0, width: TILE, height: TILE }, 3, 'third');
    expect(history.undoStack.map((entry) => entry.label)).toEqual(['second', 'third']);
    expect(history.trimmedCount).toBe(1);
  });

  it('always keeps the newest entry even when it alone exceeds the budget', () => {
    const buffer = createRgbaBuffer(24, 24);
    let history = createEditHistory(1);
    history = applyOp(history, buffer, { x: 0, y: 0, width: 24, height: 24 }, 5, 'huge');
    expect(history.undoStack.map((entry) => entry.label)).toEqual(['huge']);

    // The single oversized entry still undoes correctly.
    const result = undoInPlace(history, buffer, TILE);
    expect(result.applied).toBe('huge');
    expect(buffer.data.every((byte) => byte === 255)).toBe(true);
  });
});

describe('property: op sequences are exactly reversible within budget', () => {
  const opArb = fc.record({
    x: fc.integer({ min: -4, max: 22 }),
    y: fc.integer({ min: -4, max: 22 }),
    width: fc.integer({ min: 1, max: 12 }),
    height: fc.integer({ min: 1, max: 12 }),
    byte: fc.integer({ min: 0, max: 254 }),
  });

  it('undo-all restores the original buffer; redo-all restores the final one', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 12 }), (ops) => {
        const buffer = createRgbaBuffer(20, 20);
        const original = cloneRgbaBuffer(buffer);
        let history = createEditHistory();
        ops.forEach((op, index) => {
          history = applyOp(history, buffer, op, op.byte, `op-${index}`);
        });
        const final = cloneRgbaBuffer(buffer);

        ops.forEach(() => {
          history = undoInPlace(history, buffer, TILE).history;
        });
        expect(rgbaBuffersEqual(buffer, original)).toBe(true);

        ops.forEach(() => {
          history = redoInPlace(history, buffer, TILE).history;
        });
        expect(rgbaBuffersEqual(buffer, final)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });
});
