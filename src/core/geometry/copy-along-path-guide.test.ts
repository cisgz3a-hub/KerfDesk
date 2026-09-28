import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
  type TextObject,
} from '../scene/scene-object';
import { createRectangle } from '../shapes/primitives/create-rectangle';
import { splitCopyAlongPathSelection } from './copy-along-path-guide';

function line(points: ReadonlyArray<readonly [number, number]>, closed = false): Polyline {
  return { closed, points: points.map(([x, y]) => ({ x, y })) };
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
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines }],
    ...patch,
  };
}

const STROKE = line([
  [0, 0],
  [100, 0],
]);
const TWO_SQUARES = [
  line(
    [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 0],
    ],
    true,
  ),
  line(
    [
      [10, 0],
      [15, 0],
      [15, 5],
      [10, 0],
    ],
    true,
  ),
];

function text(id: string): TextObject {
  return {
    kind: 'text',
    id,
    content: 'l',
    fontKey: 'builtin:sans',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [STROKE] }],
  };
}

function split(selected: ReadonlyArray<SceneObject>, guideId?: string) {
  return splitCopyAlongPathSelection(selected, guideId);
}

describe('choosing the Copy Along Path guide', () => {
  it('takes the top-most single path as the guide and copies the rest', () => {
    const result = split([
      svg('lower', [STROKE]),
      svg('logo', TWO_SQUARES),
      svg('upper', [STROKE]),
    ]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.guide.object.id).toBe('upper');
    expect(result.guides.map((guide) => guide.object.id)).toEqual(['upper', 'lower']);
    expect(result.artwork.map((object) => object.id)).toEqual(['lower', 'logo']);
    expect(result.guide.walk.lengthMm).toBe(100);
    expect(result.guide.closed).toBe(false);
  });

  it('uses the guide the dialog picked', () => {
    const result = split([svg('lower', [STROKE]), svg('upper', [STROKE])], 'lower');
    expect(result.kind === 'ok' && result.guide.object.id).toBe('lower');
    expect(result.kind === 'ok' && result.artwork.map((object) => object.id)).toEqual(['upper']);
  });

  it('never takes text, a barcode or a shape of several paths as the guide', () => {
    expect(split([svg('logo', TWO_SQUARES), text('label')])).toEqual({ kind: 'no-guide' });
  });

  it('reads the guide in world space and knows a drawn rectangle is closed', () => {
    const frame = createRectangle({
      id: 'frame',
      color: '#000000',
      spec: { widthMm: 30, heightMm: 20, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 50, y: 60 },
    });
    const result = split([svg('logo', TWO_SQUARES), frame]);
    expect(result.kind === 'ok' && result.guide.closed).toBe(true);
    expect(result.kind === 'ok' && result.guide.walk.lengthMm).toBeCloseTo(100, 6);
    expect(result.kind === 'ok' && result.guide.walk.points[0]).toEqual({ x: 50, y: 60 });
  });

  it('goes round an open path whose ends meet like a closed one', () => {
    const loop = line([
      [0, 0],
      [10, 0],
      [10, 10],
      [0.0004, 0],
    ]);
    const result = split([svg('logo', TWO_SQUARES), svg('loop', [loop])]);
    expect(result.kind === 'ok' && result.guide.closed).toBe(true);
  });

  it('passes over a path with no length for one that has some', () => {
    const dot = svg('dot', [line([[5, 5]])]);
    const result = split([svg('path', [STROKE]), dot]);
    expect(result.kind === 'ok' && result.guide.object.id).toBe('path');
    expect(result.kind === 'ok' && result.artwork.map((object) => object.id)).toEqual(['dot']);
    expect(split([svg('logo', TWO_SQUARES), dot])).toEqual({ kind: 'zero-length' });
  });

  it('needs artwork as well as the guide', () => {
    expect(split([svg('path', [STROKE])])).toEqual({ kind: 'no-artwork' });
    expect(split([])).toEqual({ kind: 'no-guide' });
  });
});
