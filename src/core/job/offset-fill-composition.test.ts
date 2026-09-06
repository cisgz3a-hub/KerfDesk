import { expect, it, vi } from 'vitest';
import type * as Clipper from 'clipper2-ts';
import { unionD } from 'clipper2-ts';
import { square } from '../../__fixtures__/square';
import { offsetFillContours } from './offset-fill';
import { prepareOffsetFillRegion } from './offset-fill-region';

vi.mock('clipper2-ts', async (original) => {
  const actual = await original<typeof Clipper>();
  return { ...actual, unionD: vi.fn(actual.unionD) };
});

it('normalises overlapping strokes within a text object before the first half-spacing inset', () => {
  const text = [square(10), square(10, 5, 0)];
  const actual = offsetFillContours({ polylines: text, nonzeroGroups: [text], spacingMm: 1 });
  const rectangle = {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 15, y: 0 },
      { x: 15, y: 10 },
      { x: 0, y: 10 },
    ],
  };
  expect(actual).toEqual(offsetFillContours({ polylines: [rectangle], spacingMm: 1 }));
  expect(actual.termination).toEqual({ kind: 'complete' });
});

it('composes coincident text and vector regions even-odd, reaching natural empty completion', () => {
  const vector = square(10),
    text = square(10);
  expect(
    offsetFillContours({ polylines: [vector, text], nonzeroGroups: [[text]], spacingMm: 1 }),
  ).toEqual({ contours: [], termination: { kind: 'complete' } });
});

it('keeps the prepared text region unchanged when every winding is reversed', () => {
  const text = [square(10), { ...square(4, 3, 3), points: [...square(4, 3, 3).points].reverse() }];
  const reversed = text.map((p) => ({ ...p, points: [...p.points].reverse() }));
  expect(prepareOffsetFillRegion(text, [text])).toEqual(
    prepareOffsetFillRegion(reversed, [reversed]),
  );
});

it('propagates a text constituent normalisation failure through existing offset-failed diagnostics', () => {
  const text = [square(10), square(10, 5, 0)];
  vi.mocked(unionD).mockImplementationOnce(() => {
    throw new Error('text union failed');
  });
  expect(offsetFillContours({ polylines: text, nonzeroGroups: [text], spacingMm: 1 })).toEqual({
    contours: [],
    termination: { kind: 'offset-failed' },
  });
});
