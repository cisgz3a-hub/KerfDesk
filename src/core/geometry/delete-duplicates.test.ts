import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Polyline,
  type RasterImage,
  type SceneObject,
  type TextObject,
  type Vec2,
} from '../scene';
import { planDeleteDuplicates } from './delete-duplicates';

function square(x: number, y: number, size = 10): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function svg(
  id: string,
  polylines: ReadonlyArray<Polyline>,
  patch: Partial<ImportedSvg> = {},
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', operationIds: ['cut'], polylines }],
    ...patch,
  };
}

function reversed(polyline: Polyline): Polyline {
  return { ...polyline, points: [...polyline.points].reverse() };
}

function startingAt(polyline: Polyline, index: number): Polyline {
  return {
    ...polyline,
    points: [...polyline.points.slice(index), ...polyline.points.slice(0, index)],
  };
}

describe('planDeleteDuplicates (ADR-377)', () => {
  it('removes a later stacked copy and keeps the first', () => {
    const plan = planDeleteDuplicates([svg('first', [square(0, 0)]), svg('copy', [square(0, 0)])]);

    expect([...plan.removedObjectIds]).toEqual(['copy']);
    expect(plan.editedObjects.size).toBe(0);
    expect(plan.removedContourCount).toBe(1);
  });

  it('matches copies placed by a different transform, drawn backwards or from another corner', () => {
    const moved = svg('moved', [square(-20, 0)], {
      transform: { ...IDENTITY_TRANSFORM, x: 20 },
    });
    const backwards = svg('backwards', [reversed(square(0, 0))]);
    const otherStart = svg('other-start', [startingAt(square(0, 0), 2)]);

    const plan = planDeleteDuplicates([svg('first', [square(0, 0)]), moved, backwards, otherStart]);

    expect([...plan.removedObjectIds]).toEqual(['moved', 'backwards', 'other-start']);
  });

  it('keeps a copy that is off by more than the tolerance', () => {
    const plan = planDeleteDuplicates([
      svg('first', [square(0, 0)]),
      svg('near', [square(0.05, 0)]),
    ]);

    expect(plan.removedObjectIds.size).toBe(0);
    expect(plan.removedContourCount).toBe(0);
  });

  it('keeps copies that run under different operations or object output settings', () => {
    const scored: ImportedSvg = {
      ...svg('scored', [square(0, 0)]),
      paths: [{ color: '#000000', operationIds: ['score'], polylines: [square(0, 0)] }],
    };
    const stronger = svg('stronger', [square(0, 0)], { powerScale: 50 });

    const plan = planDeleteDuplicates([svg('cut', [square(0, 0)]), scored, stronger]);

    expect(plan.removedObjectIds.size).toBe(0);
  });

  it('removes a repeat inside one object and moves its tab anchors to the kept contours', () => {
    const object = svg('doubled', [square(0, 0), square(20, 0), square(0, 0)], {
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
      cncTabAnchors: [
        { layerColor: '#000000', pathIndex: 0, polylineIndex: 1, pathT: 0.5 },
        { layerColor: '#000000', pathIndex: 0, polylineIndex: 2, pathT: 0.25 },
      ],
    });

    const plan = planDeleteDuplicates([object]);
    const edited = plan.editedObjects.get('doubled');

    expect(plan.removedContourCount).toBe(1);
    expect(edited?.paths[0]?.polylines).toEqual([square(0, 0), square(20, 0)]);
    expect(edited?.cncTabAnchors).toEqual([
      { layerColor: '#000000', pathIndex: 0, polylineIndex: 1, pathT: 0.5 },
    ]);
  });

  it('shrinks the bounds of an object that loses a contour far from the rest', () => {
    const object: ImportedSvg = {
      ...svg('mixed', []),
      bounds: { minX: 0, minY: 0, maxX: 60, maxY: 10 },
      paths: [
        { color: '#000000', operationIds: ['cut'], polylines: [square(0, 0)] },
        { color: '#000000', operationIds: ['cut'], polylines: [square(50, 0)] },
      ],
    };

    const plan = planDeleteDuplicates([svg('far', [square(50, 0)]), object]);
    const edited = plan.editedObjects.get('mixed');

    expect(edited?.paths).toHaveLength(1);
    expect(edited?.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('removes a text or shape object only when every contour repeats', () => {
    const glyphs: ColoredPath = { color: '#000000', polylines: [square(0, 0), square(20, 0)] };
    const text = (id: string, paths: ReadonlyArray<ColoredPath>): TextObject => ({
      kind: 'text',
      id,
      content: 'OO',
      fontKey: 'builtin:sans',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: '#000000',
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths,
    });
    const legacy = (id: string, polylines: ReadonlyArray<Polyline>): ImportedSvg => ({
      ...svg(id, polylines),
      paths: [{ color: '#000000', polylines }],
    });

    const whole = planDeleteDuplicates([text('first', [glyphs]), text('copy', [glyphs])]);
    const partial = planDeleteDuplicates([legacy('lone', [square(0, 0)]), text('text', [glyphs])]);

    expect([...whole.removedObjectIds]).toEqual(['copy']);
    expect(partial.removedObjectIds.size).toBe(0);
    expect(partial.editedObjects.size).toBe(0);
  });

  it('checks kept objects first and never removes or trims them', () => {
    const plan = planDeleteDuplicates(
      [
        svg('plain', [square(0, 0)]),
        svg('mask', [square(0, 0), square(0, 0)]),
        svg('other-mask', [square(0, 0)]),
      ],
      { keepIds: new Set(['mask', 'other-mask']) },
    );

    expect([...plan.removedObjectIds]).toEqual(['plain']);
    expect(plan.editedObjects.size).toBe(0);
    expect(plan.removedContourCount).toBe(1);
  });

  it('never removes images', () => {
    const image = {
      kind: 'raster-image',
      id: 'photo',
      source: 'photo.png',
      pixelWidth: 10,
      pixelHeight: 10,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      color: '#333333',
      dither: 'floyd-steinberg',
      linesPerMm: 10,
    } as unknown as RasterImage;
    const objects: ReadonlyArray<SceneObject> = [image, { ...image, id: 'photo-copy' }];

    expect(planDeleteDuplicates(objects).removedObjectIds.size).toBe(0);
  });

  it('keeps curves and their stored polylines in step when a curve repeats', () => {
    const curve = (start: Vec2): CurveSubpath => ({
      start,
      segments: [
        { kind: 'line', to: { x: start.x + 10, y: start.y } },
        {
          kind: 'cubic',
          control1: { x: start.x + 14, y: start.y + 3 },
          control2: { x: start.x + 14, y: start.y + 7 },
          to: { x: start.x + 10, y: start.y + 10 },
        },
        { kind: 'line', to: { x: start.x, y: start.y + 10 } },
      ],
      closed: true,
    });
    const curves = [curve({ x: 0, y: 0 }), curve({ x: 30, y: 0 }), curve({ x: 0, y: 0 })];
    const object: ImportedSvg = {
      ...svg('curvy', []),
      paths: [
        {
          color: '#000000',
          operationIds: ['cut'],
          curves,
          polylines: curves.map((item) => ({
            closed: true,
            points: [item.start, ...item.segments.map((segment) => segment.to)],
          })),
        },
      ],
    };

    const edited = planDeleteDuplicates([object]).editedObjects.get('curvy');

    expect(edited?.paths[0]?.curves).toEqual(curves.slice(0, 2));
    expect(edited?.paths[0]?.polylines).toHaveLength(2);
    expect(edited?.bounds.maxX).toBeGreaterThan(40);
  });
});
