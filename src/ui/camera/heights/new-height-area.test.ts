import { describe, expect, it } from 'vitest';
import { newHeightArea } from './new-height-area';

const BED = { bedWidthMm: 400, bedHeightMm: 300 };

describe('newHeightArea', () => {
  it('goes around the selection with a 10 mm margin, cut to the bed', () => {
    expect(
      newHeightArea({
        id: 'a',
        selectionBounds: { minX: 5, minY: 250, maxX: 60, maxY: 295 },
        surfaceHeightMm: 6,
        ...BED,
      }),
    ).toEqual({ id: 'a', x: 0, y: 240, width: 70, height: 60, surfaceHeightMm: 6 });
  });

  it('starts mid-bed when nothing is selected or the selection is off the bed', () => {
    const centred = { id: 'a', x: 150, y: 100, width: 100, height: 100, surfaceHeightMm: 6 };
    expect(newHeightArea({ id: 'a', selectionBounds: null, surfaceHeightMm: 6, ...BED })).toEqual(
      centred,
    );
    expect(
      newHeightArea({
        id: 'a',
        selectionBounds: { minX: 500, minY: 20, maxX: 540, maxY: 60 },
        surfaceHeightMm: 6,
        ...BED,
      }),
    ).toEqual(centred);
  });

  it('fits the square to a bed smaller than it', () => {
    expect(
      newHeightArea({
        id: 'a',
        selectionBounds: null,
        surfaceHeightMm: 0,
        bedWidthMm: 60,
        bedHeightMm: 40,
      }),
    ).toEqual({ id: 'a', x: 10, y: 0, width: 40, height: 40, surfaceHeightMm: 0 });
  });
});
