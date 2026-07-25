import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { localFromScene, pointerNdc, sceneFromLocal } from './viewer3d-picking';

const MESH = { widthMm: 200, heightMm: 100 };
const ORIGIN = { x: 30, y: 40 };

describe('pointerNdc', () => {
  it('puts the canvas centre at the origin', () => {
    expect(pointerNdc(50, 25, 100, 50)).toEqual({ x: 0, y: 0 });
  });

  it('flips Y, because DOM pixels grow down and NDC grows up', () => {
    expect(pointerNdc(0, 0, 100, 50)).toEqual({ x: -1, y: 1 });
    expect(pointerNdc(100, 50, 100, 50)).toEqual({ x: 1, y: -1 });
  });

  it('returns the centre for a collapsed canvas instead of NaN', () => {
    // NaN reaches the raycaster as "hit nothing", so the readout would simply
    // never appear and the cause would be invisible.
    expect(pointerNdc(10, 10, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(Number.isNaN(pointerNdc(10, 10, 0, 50).x)).toBe(false);
  });
});

describe('scene <-> local frame', () => {
  it('mirrors Y, which is the whole reason this conversion exists', () => {
    // A point at the grid's min corner sits at the TOP-left of the viewport,
    // because the heightmap's row axis points down the canvas.
    expect(localFromScene({ x: 30, y: 40, z: -1 }, ORIGIN, MESH)).toEqual({
      x: -100,
      y: 50,
      z: -1,
    });
  });

  it('leaves Z alone in both directions', () => {
    // Z is machine depth in every frame here; mirroring it would make pockets
    // read as bosses.
    expect(localFromScene({ x: 0, y: 0, z: -3.5 }, ORIGIN, MESH).z).toBe(-3.5);
    expect(sceneFromLocal({ x: 0, y: 0, z: -3.5 }, ORIGIN, MESH).z).toBe(-3.5);
  });

  it('round-trips any point (property)', () => {
    // The cutter is placed with localFromScene and the hover readout reads back
    // with sceneFromLocal. If these ever stop being inverses, the readout
    // reports a position the drawn tool is not at.
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -500, max: 500, noNaN: true }),
          y: fc.double({ min: -500, max: 500, noNaN: true }),
          z: fc.double({ min: -50, max: 50, noNaN: true }),
        }),
        (point) => {
          const back = sceneFromLocal(localFromScene(point, ORIGIN, MESH), ORIGIN, MESH);
          expect(back.x).toBeCloseTo(point.x, 9);
          expect(back.y).toBeCloseTo(point.y, 9);
          expect(back.z).toBe(point.z);
        },
      ),
    );
  });
});
