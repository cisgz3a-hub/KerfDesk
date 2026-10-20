// ADR-636: a crossed custom-shape capture is joined round the board, and the
// capture map must draw that outline rather than the capture order's bow-tie.
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../../core/scene';
import { paintPlaceBoardMarks, type PlaceBoardCanvasMarks } from './place-board-canvas-marks';

function recordingContext() {
  const path: string[] = [];
  const labels: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'moveTo' || key === 'lineTo')
          return (x: number, y: number) => path.push(`${String(key)} ${x},${y}`);
        if (key === 'fillText') return (text: string) => labels.push(text);
        return () => undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, path, labels };
}

const VIEW = { offsetX: 0, offsetY: 0, scale: 1 } as Parameters<typeof paintPlaceBoardMarks>[1];
// A square captured as 1 → 3 → 2 → 4: joined in capture order it crosses itself.
const A: Vec2 = { x: 0, y: 0 };
const B: Vec2 = { x: 10, y: 0 };
const C: Vec2 = { x: 10, y: 10 };
const D: Vec2 = { x: 0, y: 10 };
const marks = (outlinePoints?: ReadonlyArray<Vec2>): PlaceBoardCanvasMarks => ({
  points: [A, C, B, D],
  ...(outlinePoints === undefined ? {} : { outlinePoints }),
  outline: 'closed',
  sight: null,
  checks: [],
});

describe('paintPlaceBoardMarks', () => {
  it('draws the re-sorted outline while numbering points in capture order', () => {
    const { ctx, path, labels } = recordingContext();
    paintPlaceBoardMarks(ctx, VIEW, marks([A, B, C, D]));
    expect(path).toEqual(['moveTo 0,0', 'lineTo 10,0', 'lineTo 10,10', 'lineTo 0,10']);
    expect(labels).toEqual(['1', '2', '3', '4']);
  });

  it('joins the points in capture order when the outline keeps it', () => {
    const { ctx, path } = recordingContext();
    paintPlaceBoardMarks(ctx, VIEW, marks());
    expect(path).toEqual(['moveTo 0,0', 'lineTo 10,10', 'lineTo 10,0', 'lineTo 0,10']);
  });
});
