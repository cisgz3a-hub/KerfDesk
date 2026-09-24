import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { stackedCopyWarnings } from './stacked-copy-warnings';

const COLOR = '#ff0000';

function wingCopy(id: string, x: number, y: number, extra: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: 'wing.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    color: COLOR,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    ...extra,
  };
}

function project(objects: ReadonlyArray<SceneObject>, layer: Partial<Layer> = {}): Project {
  return {
    ...createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
    scene: {
      ...EMPTY_SCENE,
      objects,
      layers: [{ ...createLayer({ id: 'L1', color: COLOR, mode: 'image' }), ...layer }],
    },
  };
}

describe('stacked copy warnings', () => {
  it('warns when nudged copies of one image all burn on top of each other', () => {
    const copies = [wingCopy('a', 20, 20), wingCopy('b', 19, 21), wingCopy('c', 18, 22)];
    expect(stackedCopyWarnings(project(copies))).toEqual([
      '3 copies of "wing.png" overlap on output operations. Every copy burns, so copies even slightly offset from one another fill in each other\'s fine white lines and dots. Delete the extra copies unless the stack is intentional.',
    ]);
  });

  it('ignores a single copy and side-by-side copies of the same file', () => {
    expect(stackedCopyWarnings(project([wingCopy('a', 20, 20)]))).toEqual([]);
    expect(stackedCopyWarnings(project([wingCopy('a', 20, 20), wingCopy('b', 80, 20)]))).toEqual(
      [],
    );
  });

  it('ignores the tinted trace-source backing, which never burns', () => {
    const copies = [wingCopy('a', 20, 20), wingCopy('b', 20, 20, { role: 'trace-source' })];
    expect(stackedCopyWarnings(project(copies))).toEqual([]);
  });

  it('treats different pixels under one generic label as different artwork', () => {
    const copies = [
      wingCopy('a', 20, 20, {
        source: 'rect shape (bitmap)',
        dataUrl: 'data:image/png;base64,AAAA',
      }),
      wingCopy('b', 19, 21, {
        source: 'rect shape (bitmap)',
        dataUrl: 'data:image/png;base64,BBBB',
      }),
    ];
    expect(stackedCopyWarnings(project(copies))).toEqual([]);
  });

  it('does not call copies turned or resized differently a stack', () => {
    const turned = wingCopy('b', 20, 20, {
      transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20, rotationDeg: 5 },
    });
    expect(stackedCopyWarnings(project([wingCopy('a', 20, 20), turned]))).toEqual([]);
  });

  it('compares rotated copies by their real footprints, not their bounding boxes', () => {
    const bar = (id: string, x: number, y: number) =>
      wingCopy(id, x, y, {
        bounds: { minX: 0, minY: 0, maxX: 100, maxY: 10 },
        transform: { ...IDENTITY_TRANSFORM, x, y, rotationDeg: 45 },
      });
    // 15 mm apart across the bar's short side: the boxes overlap heavily, the
    // 10 mm-wide bars themselves not at all.
    const apart = stackedCopyWarnings(project([bar('a', 100, 100), bar('b', 89.39, 110.61)]));
    expect(apart).toEqual([]);
    const nudged = stackedCopyWarnings(project([bar('a', 100, 100), bar('b', 100.7, 100.7)]));
    expect(nudged).toHaveLength(1);
  });

  it('warns about a trace kept under a re-trace of the same source', () => {
    const trace = (id: string, x: number): SceneObject => ({
      kind: 'traced-image',
      id,
      source: 'wing.png',
      traceSourceId: 'src-1',
      tracePixelWidth: 400,
      tracePixelHeight: 300,
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
      transform: { ...IDENTITY_TRANSFORM, x, y: 20 },
      paths: [
        {
          color: COLOR,
          polylines: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 40, y: 0 },
                { x: 40, y: 30 },
                { x: 0, y: 0 },
              ],
              closed: true,
            },
          ],
        },
      ],
    });
    const warnings = stackedCopyWarnings(
      project([trace('t1', 20), trace('t2', 20.5)], { mode: 'fill' }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('2 copies of "wing.png"');
  });

  it('ignores copies whose operation has output turned off', () => {
    const copies = [wingCopy('a', 20, 20), wingCopy('b', 19, 21)];
    expect(stackedCopyWarnings(project(copies, { output: false }))).toEqual([]);
  });
});
