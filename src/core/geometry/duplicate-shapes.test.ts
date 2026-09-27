import { describe, expect, it } from 'vitest';
import { cncTabAnchorPosition } from '../cnc/cnc-tab-anchors';
import { compileCncJob } from '../cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
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
  it('keeps different fill rules, winding relationships and stroke envelopes', () => {
    const outer = closed(SQUARE);
    const inner = closed([p(3, 3), p(7, 3), p(7, 7), p(3, 7)]);
    const fill = (id: string, fillRule: 'evenodd' | 'nonzero', hole = inner) => ({
      ...art(id, [outer, hole]),
      paths: [{ color: '#ff0000', fillRule, polylines: [outer, hole] }],
    });
    const strokes = [1, 2].map((strokeWidthMm) => ({
      ...art(`stroke-${strokeWidthMm}`, [outer]),
      paths: [{ color: '#ff0000', strokeWidthMm, polylines: [outer] }],
    }));
    expect(
      duplicateObjectIds(
        [
          fill('even', 'evenodd'),
          fill('solid', 'nonzero'),
          fill('hole', 'nonzero', { ...inner, points: [...inner.points].reverse() }),
          ...strokes,
        ],
        LAYERS,
        new Set(),
      ),
    ).toEqual([]);
  });

  it('keeps manual tabs and their source contour parameterization', () => {
    const base = art('automatic', [closed(SQUARE)]);
    const manual = {
      ...base,
      id: 'manual',
      cncTabAnchors: [{ layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 0.1 }],
    };
    const movedStart = {
      ...manual,
      id: 'other-tab-location',
      paths: [
        {
          color: '#ff0000',
          polylines: [closed([...SQUARE.slice(1), SQUARE[0]!])],
        },
      ],
    };
    expect(
      duplicateObjectIds(
        [base, manual, movedStart, { ...manual, id: 'true-copy' }],
        LAYERS,
        new Set(),
      ),
    ).toEqual(['true-copy']);
  });

  it('keeps world-equivalent contours whose authored scale puts tabs at different locations', () => {
    const anchor = { layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 0.125 };
    const square = { ...art('square', [closed(SQUARE)]), cncTabAnchors: [anchor] };
    const scaled = {
      ...art('scaled', [closed([p(0, 0), p(5, 0), p(5, 10), p(0, 10)])]),
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 10 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2 },
      cncTabAnchors: [anchor],
    };
    expect(cncTabAnchorPosition(square, anchor)).toEqual(p(5, 0));
    expect(cncTabAnchorPosition(scaled, anchor)).toEqual(p(7.5, 0));
    expect(deepestTabPaths(square)).not.toEqual(deepestTabPaths(scaled));
    expect(
      duplicateObjectIds(
        [square, scaled, { ...scaled, id: 'scaled-copy' }],
        TABBED_CNC_LAYERS,
        new Set(),
      ),
    ).toEqual(['scaled-copy']);
  });

  it('retains empty contour slots that give tab indexes their authored meaning', () => {
    const anchor = { layerColor: '#ff0000', pathIndex: 0, polylineIndex: 1, pathT: 0.125 };
    const empty = closed([]);
    const left = closed(SQUARE);
    const right = closed(SQUARE.map((point) => p(point.x + 20, point.y)));
    const before = {
      ...art('empty-before', [empty, left, right]),
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
      cncTabAnchors: [anchor],
    };
    const after = {
      ...before,
      id: 'empty-after',
      paths: [{ color: '#ff0000', polylines: [left, right, empty] }],
    };
    expect(cncTabAnchorPosition(before, anchor)).toEqual(p(5, 0));
    expect(cncTabAnchorPosition(after, anchor)).toEqual(p(25, 0));
    expect(deepestTabPaths(before)).not.toEqual(deepestTabPaths(after));
    expect(
      duplicateObjectIds(
        [before, after, { ...after, id: 'same-index-copy' }],
        TABBED_CNC_LAYERS,
        new Set(),
      ),
    ).toEqual(['same-index-copy']);
  });

  it('compares transformed stroke envelopes without discarding equivalent copies', () => {
    const base = art('round-pen', [closed(SQUARE)]);
    const path = { ...base.paths[0]!, strokeWidthMm: 1 };
    const round = { ...base, paths: [path] };
    const wide = {
      ...base,
      id: 'wide-pen',
      paths: [{ ...path, strokeTransform: { a: 2, b: 0, c: 0, d: 1 } }],
    };
    expect(
      duplicateObjectIds([round, wide, { ...wide, id: 'wide-copy' }], LAYERS, new Set()),
    ).toEqual(['wide-copy']);
  });

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

const TABBED_CNC_LAYERS: ReadonlyArray<Layer> = [
  {
    ...createLayer({ id: 'cut', color: '#ff0000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-on-path',
      depthMm: 6,
      depthPerPassMm: 3,
      tabsEnabled: true,
      tabHeightMm: 2,
      tabWidthMm: 2,
      tabsPerShape: 4,
    },
  },
];

function deepestTabPaths(object: ImportedSvg) {
  const job = compileCncJob(
    { objects: [object], layers: TABBED_CNC_LAYERS },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  const paths = job.groups
    .filter((group) => group.kind === 'cnc')
    .flatMap((group) => group.passes)
    .flatMap((pass) =>
      pass.kind === 'path3d' && Math.min(...pass.points.map((point) => point.z)) === -6
        ? [pass.points]
        : [],
    );
  expect(paths.length).toBeGreaterThan(0);
  return paths;
}

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
