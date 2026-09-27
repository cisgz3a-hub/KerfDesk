import { describe, expect, it } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type RasterImage,
  type Vec2,
} from '../scene';
import { duplicateObjectIds, duplicateSignature } from './duplicate-shapes';

const LAYERS: ReadonlyArray<Layer> = [
  createLayer({ id: 'cut', name: 'Cut', color: '#ff0000', mode: 'line' }),
  createLayer({ id: 'score', name: 'Score', color: '#0000ff', mode: 'line' }),
];
const SQUARE = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];

describe('delete duplicates', () => {
  it('deletes later copies of artwork drawn twice on the same operation', () => {
    const objects = [
      art('a', [closed(SQUARE)]),
      art('b', [closed(SQUARE)]),
      art('c', [closed(SQUARE)]),
    ];

    expect(duplicateObjectIds(objects, LAYERS, new Set())).toEqual(['b', 'c']);
  });

  it('compares world geometry, so a moved copy with the move baked in still counts', () => {
    const shifted = SQUARE.map((point) => p(point.x - 5, point.y - 5));
    const moved = {
      ...art('moved', [closed(shifted)]),
      transform: { ...IDENTITY_TRANSFORM, x: 5, y: 5 },
    };

    expect(duplicateObjectIds([art('a', [closed(SQUARE)]), moved], LAYERS, new Set())).toEqual([
      'moved',
    ]);
  });

  it('treats a closed shape with another start point or direction as the same shape', () => {
    const rotatedStart = closed([p(10, 10), p(0, 10), p(0, 0), p(10, 0)]);
    const reversed = closed([p(0, 0), p(0, 10), p(10, 10), p(10, 0), p(0, 0)]);
    const objects = [art('a', [closed(SQUARE)]), art('b', [rotatedStart]), art('c', [reversed])];

    expect(duplicateObjectIds(objects, LAYERS, new Set())).toEqual(['b', 'c']);
  });

  it('treats an open path drawn the other way as the same path', () => {
    const line = open([p(0, 0), p(5, 2), p(10, 0)]);
    const back = open([p(10, 0), p(5, 2), p(0, 0)]);

    expect(duplicateObjectIds([art('a', [line]), art('b', [back])], LAYERS, new Set())).toEqual([
      'b',
    ]);
  });

  it('ignores differences below 0.001 mm but not above', () => {
    const nudged = closed(SQUARE.map((point) => p(point.x + 0.0002, point.y)));
    const moved = closed(SQUARE.map((point) => p(point.x + 0.01, point.y)));
    const objects = [art('a', [closed(SQUARE)]), art('b', [nudged]), art('c', [moved])];

    expect(duplicateObjectIds(objects, LAYERS, new Set())).toEqual(['b']);
  });

  it('keeps copies on different operations or with different settings', () => {
    const objects = [
      art('cut', [closed(SQUARE)]),
      { ...art('score', [closed(SQUARE)]), operationIds: ['score'] },
      { ...art('stronger', [closed(SQUARE)]), powerScale: 150 },
      { ...art('filled', [closed(SQUARE)]), operationOverride: { mode: 'fill' as const } },
    ];

    expect(duplicateObjectIds(objects, LAYERS, new Set())).toEqual([]);
  });

  it('keeps an open path apart from the closed shape through the same points', () => {
    const objects = [art('closed', [closed(SQUARE)]), art('open', [open(SQUARE)])];

    expect(duplicateObjectIds(objects, LAYERS, new Set())).toEqual([]);
  });

  it('keeps protected objects and deletes an unprotected copy instead', () => {
    const objects = [art('a', [closed(SQUARE)]), art('locked', [closed(SQUARE)])];

    expect(duplicateObjectIds(objects, LAYERS, new Set(['locked']))).toEqual(['a']);
    expect(duplicateObjectIds(objects, LAYERS, new Set(['a', 'locked']))).toEqual([]);
  });

  it('matches multi-path artwork regardless of path order', () => {
    const small = closed([p(2, 2), p(4, 2), p(4, 4)]);
    const objects = [art('a', [closed(SQUARE), small]), art('b', [small, closed(SQUARE)])];

    expect(duplicateObjectIds(objects, LAYERS, new Set())).toEqual(['b']);
  });

  it('has no signature for artwork without paths', () => {
    const image: RasterImage = {
      kind: 'raster-image',
      id: 'image',
      source: 'photo.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      dither: 'threshold',
      linesPerMm: 10,
      lumaBase64: 'AA==',
    };

    expect(duplicateSignature(image, LAYERS)).toBeNull();
    expect(duplicateObjectIds([image, { ...image, id: 'copy' }], LAYERS, new Set())).toEqual([]);
  });
});

function p(x: number, y: number): Vec2 {
  return { x, y };
}

function closed(points: ReadonlyArray<Vec2>): Polyline {
  return { closed: true, points };
}

function open(points: ReadonlyArray<Vec2>): Polyline {
  return { closed: false, points };
}

function art(id: string, polylines: ReadonlyArray<Polyline>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#ff0000', polylines }],
  };
}
