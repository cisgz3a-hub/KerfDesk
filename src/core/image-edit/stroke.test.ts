import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BrushParams } from './brush-stamp';
import { captureRect, createEditHistory, pushHistoryEntry, undoInPlace } from './history';
import { cloneRgbaBuffer, createRgbaBuffer, RGBA_CHANNELS, rgbaBuffersEqual } from './rgba-buffer';
import { type PaintStroke, paintStrokeInPlace, snapLineEnd45, strokeDirtyRect } from './stroke';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

function pencilStroke(
  points: readonly { x: number; y: number }[],
  diameterPx: number,
  opacity = 1,
  color = BLACK,
): PaintStroke {
  const brush: BrushParams = { diameterPx, opacity, tip: { kind: 'pixel' } };
  return { points, brush, color };
}

function channelAt(buffer: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return buffer.data[(y * buffer.width + x) * RGBA_CHANNELS] ?? -1;
}

describe('paintStrokeInPlace', () => {
  it('a single-point 1 px pencil dab inks exactly one pixel', () => {
    const buffer = createRgbaBuffer(10, 10);
    paintStrokeInPlace(buffer, pencilStroke([{ x: 2.5, y: 2.5 }], 1));
    expect(channelAt(buffer, 2, 2)).toBe(0);
    let inked = 0;
    for (let i = 0; i < buffer.data.length; i += RGBA_CHANNELS) {
      if ((buffer.data[i] ?? 255) !== 255) inked += 1;
    }
    expect(inked).toBe(1);
  });

  it('stamp spacing leaves no gaps along a straight stroke', () => {
    const buffer = createRgbaBuffer(20, 12);
    paintStrokeInPlace(
      buffer,
      pencilStroke(
        [
          { x: 2, y: 5.5 },
          { x: 18, y: 5.5 },
        ],
        3,
      ),
    );
    for (let x = 2; x <= 17; x += 1) {
      expect(channelAt(buffer, x, 5)).toBe(0);
    }
  });

  it('applies stroke opacity as a single blend over white', () => {
    const buffer = createRgbaBuffer(8, 8);
    paintStrokeInPlace(buffer, pencilStroke([{ x: 4, y: 4 }], 4, 0.5));
    expect(channelAt(buffer, 4, 4)).toBe(128);
  });

  it('painting white IS the eraser', () => {
    const buffer = createRgbaBuffer(8, 8);
    paintStrokeInPlace(buffer, pencilStroke([{ x: 4, y: 4 }], 6));
    expect(channelAt(buffer, 4, 4)).toBe(0);
    paintStrokeInPlace(buffer, pencilStroke([{ x: 4, y: 4 }], 6, 1, WHITE));
    expect(buffer.data.every((byte) => byte === 255)).toBe(true);
  });

  it('reports the padded, document-clamped dirty rect', () => {
    const buffer = createRgbaBuffer(20, 20);
    const rect = strokeDirtyRect(
      pencilStroke(
        [
          { x: 5, y: 5 },
          { x: 10, y: 5 },
        ],
        4,
      ),
      buffer,
    );
    expect(rect).toEqual({ x: 2, y: 2, width: 11, height: 6 });
  });

  it('supports the UI protocol: captureRect before painting, undo restores', () => {
    const buffer = createRgbaBuffer(24, 24);
    const original = cloneRgbaBuffer(buffer);
    const stroke = pencilStroke(
      [
        { x: 3, y: 3 },
        { x: 20, y: 18 },
      ],
      5,
    );
    let history = createEditHistory();
    const entry = captureRect(buffer, strokeDirtyRect(stroke, buffer), 'Brush stroke', 8);
    paintStrokeInPlace(buffer, stroke);
    history = pushHistoryEntry(history, entry);
    expect(rgbaBuffersEqual(buffer, original)).toBe(false);

    const result = undoInPlace(history, buffer, 8);
    expect(result.applied).toBe('Brush stroke');
    expect(rgbaBuffersEqual(buffer, original)).toBe(true);
  });

  it('clamps painting to a clip mask (active-selection semantics)', () => {
    const buffer = createRgbaBuffer(10, 10);
    // Clip: only the left half of the document is selected.
    const alpha = new Uint8Array(100);
    for (let y = 0; y < 10; y += 1) alpha.fill(255, y * 10, y * 10 + 5);
    paintStrokeInPlace(
      buffer,
      pencilStroke(
        [
          { x: 1, y: 5.5 },
          { x: 9, y: 5.5 },
        ],
        3,
      ),
      { alpha },
    );
    expect(channelAt(buffer, 3, 5)).toBe(0);
    expect(channelAt(buffer, 7, 5)).toBe(255);
  });

  it('is deterministic: the same stroke paints byte-identical buffers', () => {
    const pointArb = fc.record({
      x: fc.double({ min: -5, max: 30, noNaN: true }),
      y: fc.double({ min: -5, max: 30, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(pointArb, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 1, max: 12 }),
        (points, diameter) => {
          const a = createRgbaBuffer(25, 25);
          const b = createRgbaBuffer(25, 25);
          const stroke = pencilStroke(points, diameter, 0.7);
          paintStrokeInPlace(a, stroke);
          paintStrokeInPlace(b, stroke);
          expect(rgbaBuffersEqual(a, b)).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe('snapLineEnd45', () => {
  it('snaps near-horizontal, near-vertical, and near-diagonal drags', () => {
    const from = { x: 0, y: 0 };
    const horizontal = snapLineEnd45(from, { x: 10, y: 1 });
    expect(horizontal.y).toBeCloseTo(0, 10);
    expect(horizontal.x).toBeCloseTo(Math.hypot(10, 1), 10);

    const vertical = snapLineEnd45(from, { x: 1, y: 10 });
    expect(vertical.x).toBeCloseTo(0, 10);

    const diagonal = snapLineEnd45(from, { x: 5, y: 4 });
    expect(diagonal.x).toBeCloseTo(diagonal.y, 10);
  });

  it('returns a zero-length drag unchanged', () => {
    expect(snapLineEnd45({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({ x: 3, y: 3 });
  });
});
