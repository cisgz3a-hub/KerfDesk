import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject, type Transform } from './scene-object';
import { buildSelectionDistributeEdit } from './selection-distribute';

describe('buildSelectionDistributeEdit', () => {
  it('distributes selected objects by horizontal center and keeps the outer centers fixed', () => {
    const left = objectWithSize('left', 10, 10, { ...IDENTITY_TRANSFORM, x: 0, y: 0 });
    const middle = objectWithSize('middle', 10, 10, { ...IDENTITY_TRANSFORM, x: 40, y: 20 });
    const right = objectWithSize('right', 10, 10, { ...IDENTITY_TRANSFORM, x: 100, y: 5 });

    const result = buildSelectionDistributeEdit([left, right, middle], {
      kind: 'horizontal-centers',
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.transforms).toEqual([
      { id: 'middle', transform: { ...middle.transform, x: 50 } },
    ]);
  });

  it('distributes selected objects by horizontal edge spacing and preserves object widths', () => {
    const left = objectWithSize('left', 10, 10, { ...IDENTITY_TRANSFORM, x: 0, y: 0 });
    const middle = objectWithSize('middle', 30, 10, { ...IDENTITY_TRANSFORM, x: 20, y: 5 });
    const right = objectWithSize('right', 20, 10, { ...IDENTITY_TRANSFORM, x: 100, y: 10 });

    const result = buildSelectionDistributeEdit([left, middle, right], {
      kind: 'horizontal-spacing',
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.transforms).toEqual([
      { id: 'middle', transform: { ...middle.transform, x: 40 } },
    ]);
  });

  it('distributes selected objects by vertical edge spacing using transformed bounds', () => {
    const top = objectWithSize('top', 10, 10, { ...IDENTITY_TRANSFORM, x: 0, y: 0 });
    const middle = objectWithSize('middle', 10, 30, { ...IDENTITY_TRANSFORM, x: 8, y: 15 });
    const bottom = objectWithSize('bottom', 10, 10, {
      ...IDENTITY_TRANSFORM,
      x: 30,
      y: 80,
      rotationDeg: 90,
    });

    const result = buildSelectionDistributeEdit([bottom, top, middle], {
      kind: 'vertical-spacing',
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.transforms[0]?.id).toBe('middle');
    expect(result.transforms[0]?.transform.x).toBe(8);
    expect(result.transforms[0]?.transform.y).toBeCloseTo(30, 6);
  });

  it('rejects distribution with fewer than three objects', () => {
    const result = buildSelectionDistributeEdit(
      [
        objectWithSize('one', 10, 10, IDENTITY_TRANSFORM),
        objectWithSize('two', 10, 10, { ...IDENTITY_TRANSFORM, x: 30 }),
      ],
      { kind: 'horizontal-centers' },
    );

    expect(result).toEqual({ kind: 'error', reason: 'not-enough-objects' });
  });
});

function objectWithSize(
  id: string,
  widthMm: number,
  heightMm: number,
  transform: Transform,
): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm, heightMm, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm },
    transform,
    paths: [],
  };
}
