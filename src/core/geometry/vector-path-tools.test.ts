import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type ShapeObject, type TextObject } from '../scene';
import { materializeVectorObject } from './vector-path-tools';
import { weldVectorObjects } from './vector-path-weld';

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

  it('scales trusted round-stroke width with a baked uniform transform', () => {
    const artwork: ImportedSvg = {
      kind: 'imported-svg',
      id: 'trusted-stroke',
      source: 'trusted.svg',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2 },
      paths: [{ color: '#111111', strokeWidthMm: 0.5, polylines: [square(0, 0, 1)] }],
    };

    const materialized = materializeVectorObject(artwork);

    expect(materialized.paths[0]?.strokeWidthMm).toBe(1);
  });

  it('preserves trusted round-stroke width through signed uniform reflections', () => {
    for (const transform of [
      { ...IDENTITY_TRANSFORM, scaleX: -2, scaleY: 2 },
      { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: -2 },
    ]) {
      const artwork: ImportedSvg = {
        kind: 'imported-svg',
        id: 'reflected-stroke',
        source: 'reflected.svg',
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        transform,
        paths: [{ color: '#111111', strokeWidthMm: 0.5, polylines: [square(0, 0, 1)] }],
      };

      expect(materializeVectorObject(artwork).paths[0]?.strokeWidthMm).toBe(1);
    }
  });

  it('drops round-stroke provenance that a baked non-uniform transform cannot represent', () => {
    const artwork: ImportedSvg = {
      kind: 'imported-svg',
      id: 'stretched-stroke',
      source: 'stretched.svg',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 3 },
      paths: [{ color: '#111111', strokeWidthMm: 0.5, polylines: [square(0, 0, 1)] }],
    };

    const materialized = materializeVectorObject(artwork);

    expect(materialized.paths[0]?.strokeWidthMm).toBeUndefined();
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
    if (result.kind === 'error') throw new Error(result.error.message);
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
    if (result.kind === 'error') throw new Error(result.error.message);
    const welded = result.value;

    expect(welded.operationOverride).toEqual(metadata.operationOverride);
    expect(welded.powerScale).toBe(65);
  });

  it('does not refuse weld input with mixed output metadata', () => {
    const left: ShapeObject = {
      ...shapeObject('left', '#222222', square(0, 0, 10)),
      powerScale: 50,
    };
    const right: ShapeObject = {
      ...shapeObject('right', '#222222', square(5, 0, 10)),
      powerScale: 80,
    };

    const result = weldVectorObjects([left, right], 'welded');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.powerScale).toBeUndefined();
      expect(result.value.paths).toHaveLength(1);
    }
  });

  it('reports open contours even when object output metadata differs', () => {
    const openMismatched: ImportedSvg = {
      kind: 'imported-svg',
      id: 'open-a',
      source: 'a',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
      transform: IDENTITY_TRANSFORM,
      powerScale: 50,
      paths: [
        {
          color: '#222222',
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
    const closed: ShapeObject = {
      ...shapeObject('b', '#222222', square(0, 0, 10)),
      powerScale: 80,
    };
    const result = weldVectorObjects([openMismatched, closed], 'welded');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('open-contours');
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
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error.kind).toBe('open-contours');
      expect(result.error.message).toMatch(/closed contours/i);
    }
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
