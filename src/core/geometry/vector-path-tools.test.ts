import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type ShapeObject, type TextObject } from '../scene';
import { materializeVectorObject, weldVectorObjects } from './vector-path-tools';

const square = (x: number, y: number, size: number) => ({
  closed: true,
  points: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
    { x, y },
  ],
});

describe('vector path tools', () => {
  it('bakes editable vector transforms into imported-svg path geometry', () => {
    const text: TextObject = {
      kind: 'text',
      id: 'label',
      content: 'A',
      fontKey: 'builtin:sans',
      sizeMm: 12,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: '#111111',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 5,
        y: 7,
        scaleX: 2,
        scaleY: 3,
      },
      paths: [{ color: '#111111', polylines: [square(0, 0, 1)] }],
    };

    const materialized = materializeVectorObject(text, 'label-paths');

    expect(materialized).toMatchObject({
      kind: 'imported-svg',
      id: 'label-paths',
      source: 'Text: A (paths)',
      transform: IDENTITY_TRANSFORM,
      bounds: { minX: 5, minY: 7, maxX: 7, maxY: 10 },
    });
    expect(materialized.paths[0]?.polylines[0]?.points).toEqual([
      { x: 5, y: 7 },
      { x: 7, y: 7 },
      { x: 7, y: 10 },
      { x: 5, y: 10 },
      { x: 5, y: 7 },
    ]);
  });

  it('welds selected closed vector contours by color into one baked path object', () => {
    const left: ShapeObject = {
      kind: 'shape',
      id: 'left',
      spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      color: '#222222',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#222222', polylines: [square(0, 0, 10)] }],
    };
    const right: ImportedSvg = {
      kind: 'imported-svg',
      id: 'right',
      source: 'right.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: { ...IDENTITY_TRANSFORM, x: 5 },
      paths: [{ color: '#222222', polylines: [square(0, 0, 10)] }],
    };

    const result = weldVectorObjects([left, right], 'welded');
    if (!result.ok) throw new Error(result.message);
    const welded = result.value;

    expect(welded.kind).toBe('imported-svg');
    expect(welded.id).toBe('welded');
    expect(welded.transform).toEqual(IDENTITY_TRANSFORM);
    expect(welded.paths).toHaveLength(1);
    expect(welded.paths[0]?.color).toBe('#222222');
    expect(welded.paths[0]?.polylines).toHaveLength(1);
    expect(welded.bounds).toEqual({ minX: 0, minY: 0, maxX: 15, maxY: 10 });
  });

  it('preserves common output metadata when welding vector objects', () => {
    const metadata = {
      operationOverride: { mode: 'fill' as const, power: 42 },
      powerScale: 65,
    };
    const left: ShapeObject = {
      ...shapeObject('left', '#222222', square(0, 0, 10)),
      ...metadata,
    };
    const right: ShapeObject = {
      ...shapeObject('right', '#222222', square(5, 0, 10)),
      ...metadata,
    };

    const result = weldVectorObjects([left, right], 'welded');
    if (!result.ok) throw new Error(result.message);
    const welded = result.value;

    expect(welded.operationOverride).toEqual(metadata.operationOverride);
    expect(welded.powerScale).toBe(65);
  });

  it('rejects weld input with mixed output metadata', () => {
    const left: ShapeObject = {
      ...shapeObject('left', '#222222', square(0, 0, 10)),
      powerScale: 50,
    };
    const right: ShapeObject = {
      ...shapeObject('right', '#222222', square(5, 0, 10)),
      powerScale: 80,
    };

    const result = weldVectorObjects([left, right], 'welded');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/matching output metadata/i);
  });

  it('rejects weld input containing open polylines', () => {
    const open: ImportedSvg = {
      kind: 'imported-svg',
      id: 'open',
      source: 'open.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#333333',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
            },
          ],
        },
      ],
    };

    const result = weldVectorObjects([open], 'welded');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/closed vector contours/i);
  });
});

function shapeObject(id: string, color: string, polyline: ReturnType<typeof square>): ShapeObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [polyline] }],
  };
}
