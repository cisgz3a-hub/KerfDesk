import { describe, expect, it } from 'vitest';
import {
  areaContains,
  areasLowestFirst,
  clipAreaToBed,
  heightAreaAround,
  surfaceHeightAt,
  type SurfaceHeightArea,
} from './height-areas';

const box: SurfaceHeightArea = {
  id: 'box',
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  surfaceHeightMm: 40,
};
const lid: SurfaceHeightArea = {
  id: 'lid',
  x: 80,
  y: 40,
  width: 60,
  height: 60,
  surfaceHeightMm: 25,
};
const hole: SurfaceHeightArea = {
  id: 'hole',
  x: 200,
  y: 200,
  width: 20,
  height: 20,
  surfaceHeightMm: 0,
};

describe('surfaceHeightAt', () => {
  it('uses the material height outside every area', () => {
    expect(surfaceHeightAt([box, lid], 300, 300, 3)).toBe(3);
  });

  it('uses the highest area where areas overlap', () => {
    expect(surfaceHeightAt([lid, box], 90, 50, 3)).toBe(40);
    expect(surfaceHeightAt([box, lid], 130, 90, 3)).toBe(25);
  });

  it('lets an area lower than the material win inside itself', () => {
    expect(surfaceHeightAt([hole], 210, 210, 3)).toBe(0);
  });

  it('counts the edges as inside', () => {
    expect(areaContains(box, 10, 20)).toBe(true);
    expect(areaContains(box, 110, 70)).toBe(true);
    expect(areaContains(box, 110.001, 70)).toBe(false);
  });
});

describe('areasLowestFirst', () => {
  it('orders by height and keeps the order of equal heights', () => {
    const twin = { ...lid, id: 'twin' };
    expect(areasLowestFirst([box, lid, hole, twin]).map((area) => area.id)).toEqual([
      'hole',
      'lid',
      'twin',
      'box',
    ]);
  });
});

describe('clipAreaToBed', () => {
  it('cuts an area to the bed and drops one that misses it', () => {
    expect(clipAreaToBed({ x: -10, y: 380, width: 50, height: 40 }, 400, 400)).toEqual({
      x: 0,
      y: 380,
      width: 40,
      height: 20,
    });
    expect(clipAreaToBed({ x: 410, y: 10, width: 50, height: 40 }, 400, 400)).toBeNull();
    expect(clipAreaToBed({ x: 10, y: 10, width: 0, height: 40 }, 400, 400)).toBeNull();
  });
});

describe('heightAreaAround', () => {
  it('grows the box by the margin and cuts it to the bed', () => {
    expect(
      heightAreaAround({
        id: 'new',
        bounds: { minX: 5, minY: 100, maxX: 60, maxY: 150 },
        marginMm: 10,
        surfaceHeightMm: 18,
        bedWidthMm: 400,
        bedHeightMm: 400,
      }),
    ).toEqual({ id: 'new', x: 0, y: 90, width: 70, height: 70, surfaceHeightMm: 18 });
  });

  it('returns null for a box off the bed', () => {
    expect(
      heightAreaAround({
        id: 'new',
        bounds: { minX: 500, minY: 500, maxX: 560, maxY: 550 },
        marginMm: 10,
        surfaceHeightMm: 18,
        bedWidthMm: 400,
        bedHeightMm: 400,
      }),
    ).toBeNull();
  });
});
