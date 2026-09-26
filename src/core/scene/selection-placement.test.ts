import { describe, expect, it } from 'vitest';
import { applyTransform } from './transform';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Transform } from './scene-object';
import { buildSelectionMoveToBedEdit, buildSelectionQuarterTurnEdit } from './selection-placement';
import { selectionMetrics } from './selection-transform';
import type { SelectionAnchor } from './selection-transform';

const POINTS = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 3, y: 10 },
];

function triangle(id: string, transform: Partial<Transform>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: 'triangle.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, ...transform },
    paths: [{ color: '#000000', polylines: [{ closed: true, points: POINTS }] }],
  };
}

function withTransforms(
  objects: ReadonlyArray<ImportedSvg>,
  result: ReturnType<typeof buildSelectionQuarterTurnEdit>,
): ImportedSvg[] {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.reason}`);
  return objects.map((object, index) => ({
    ...object,
    transform: result.transforms[index]!.transform,
  }));
}

const SELECTION = [
  triangle('a', { x: 30, y: 20, rotationDeg: 30, scaleX: 2, scaleY: 0.7 }),
  triangle('b', { x: 90, y: 45, rotationDeg: 110, mirrorY: true }),
];

describe('buildSelectionQuarterTurnEdit', () => {
  it('turns every world vertex clockwise about the selection centre', () => {
    const bbox = selectionMetrics(SELECTION)!.bbox;
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    const turned = withTransforms(SELECTION, buildSelectionQuarterTurnEdit(SELECTION, 1));
    for (const [index, object] of SELECTION.entries()) {
      for (const point of POINTS) {
        const before = applyTransform(point, object.transform);
        const after = applyTransform(point, turned[index]!.transform);
        // Scene +Y is down, so clockwise on screen maps (dx, dy) to (-dy, dx).
        expect(after.x).toBeCloseTo(cx - (before.y - cy), 8);
        expect(after.y).toBeCloseTo(cy + (before.x - cx), 8);
      }
    }
  });

  it('keeps the selection centre where it was', () => {
    const before = selectionMetrics(SELECTION)!.bbox;
    const after = selectionMetrics(
      withTransforms(SELECTION, buildSelectionQuarterTurnEdit(SELECTION, -1)),
    )!.bbox;
    expect((after.minX + after.maxX) / 2).toBeCloseTo((before.minX + before.maxX) / 2, 8);
    expect((after.minY + after.maxY) / 2).toBeCloseTo((before.minY + before.maxY) / 2, 8);
  });

  it('swaps width and height of an axis-aligned selection', () => {
    const box = [triangle('box', { x: 10, y: 10 })];
    const turned = withTransforms(box, buildSelectionQuarterTurnEdit(box, 1));
    const metrics = selectionMetrics(turned)!;
    expect(metrics.width).toBeCloseTo(10, 8);
    expect(metrics.height).toBeCloseTo(20, 8);
  });

  it('returns exactly to the start after four turns either way', () => {
    for (const direction of [1, -1] as const) {
      let objects = SELECTION;
      for (let turn = 0; turn < 4; turn += 1) {
        objects = withTransforms(objects, buildSelectionQuarterTurnEdit(objects, direction));
      }
      objects.forEach((object, index) => {
        expect(object.transform).toEqual(SELECTION[index]!.transform);
      });
    }
  });

  it('undoes a clockwise turn with a counter-clockwise turn', () => {
    const cw = withTransforms(SELECTION, buildSelectionQuarterTurnEdit(SELECTION, 1));
    const back = withTransforms(cw, buildSelectionQuarterTurnEdit(cw, -1));
    back.forEach((object, index) => {
      expect(object.transform.x).toBeCloseTo(SELECTION[index]!.transform.x, 10);
      expect(object.transform.y).toBeCloseTo(SELECTION[index]!.transform.y, 10);
      expect(object.transform.rotationDeg).toBe(SELECTION[index]!.transform.rotationDeg);
    });
  });

  it('reports an empty selection', () => {
    expect(buildSelectionQuarterTurnEdit([], 1)).toEqual({
      kind: 'error',
      reason: 'empty-selection',
    });
  });
});

describe('buildSelectionMoveToBedEdit', () => {
  const bed = { width: 400, height: 300 };

  function movedBBox(anchor: SelectionAnchor) {
    const moved = withTransforms(SELECTION, buildSelectionMoveToBedEdit(SELECTION, bed, anchor));
    return selectionMetrics(moved)!.bbox;
  }

  it('centres the selection on the bed', () => {
    const bbox = movedBBox('c');
    expect((bbox.minX + bbox.maxX) / 2).toBeCloseTo(200, 8);
    expect((bbox.minY + bbox.maxY) / 2).toBeCloseTo(150, 8);
  });

  it.each([
    ['nw', { minX: 0, minY: 0 }],
    ['ne', { maxX: 400, minY: 0 }],
    ['sw', { minX: 0, maxY: 300 }],
    ['se', { maxX: 400, maxY: 300 }],
  ] as const)('puts the %s corner in the bed corner', (anchor, expected) => {
    const bbox = movedBBox(anchor);
    for (const [key, value] of Object.entries(expected)) {
      expect(bbox[key as keyof typeof bbox]).toBeCloseTo(value, 8);
    }
  });

  it.each([
    ['n', 'minY', 0, 'x'],
    ['s', 'maxY', 300, 'x'],
    ['w', 'minX', 0, 'y'],
    ['e', 'maxX', 400, 'y'],
  ] as const)(
    'puts the selection against the %s edge, centred along it',
    (anchor, edge, at, axis) => {
      const bbox = movedBBox(anchor);
      expect(bbox[edge]).toBeCloseTo(at, 8);
      const centre = axis === 'x' ? (bbox.minX + bbox.maxX) / 2 : (bbox.minY + bbox.maxY) / 2;
      expect(centre).toBeCloseTo(axis === 'x' ? 200 : 150, 8);
    },
  );

  it('moves every object by the same amount and keeps its shape', () => {
    const result = buildSelectionMoveToBedEdit(SELECTION, bed, 'se');
    if (result.kind !== 'ok') throw new Error('expected ok');
    const dx = result.transforms[0]!.transform.x - SELECTION[0]!.transform.x;
    const dy = result.transforms[0]!.transform.y - SELECTION[0]!.transform.y;
    result.transforms.forEach((edit, index) => {
      const source = SELECTION[index]!.transform;
      expect(edit.transform).toEqual({ ...source, x: source.x + dx, y: source.y + dy });
    });
  });

  it('reports an empty selection and an unusable bed', () => {
    expect(buildSelectionMoveToBedEdit([], bed, 'c')).toEqual({
      kind: 'error',
      reason: 'empty-selection',
    });
    expect(buildSelectionMoveToBedEdit(SELECTION, { width: 0, height: 300 }, 'c')).toEqual({
      kind: 'error',
      reason: 'invalid-dimension',
    });
  });
});
