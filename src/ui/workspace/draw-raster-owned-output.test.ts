import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clipRectangle,
  ownedClipImage,
  ownedClipProject,
} from '../../__fixtures__/owned-image-clip';
import { compileJob } from '../../core/job';
import { buildMotionManifest, type MotionBlock } from '../../core/job/motion-manifest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type RasterImage,
  type Transform,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { gray, previewProject, previewSink } from './raster-preview.test-support';

afterEach(() => {
  previewSink().draw(previewProject([]));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const cases: readonly { name: string; transform: Transform; rows: readonly string[] }[] = [
  {
    name: 'translation',
    transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 },
    rows: ['.##.', '..#.', '.##.', '.##.'],
  },
  {
    name: 'quarter turn',
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100, rotationDeg: 90 },
    rows: ['....', '##.#', '####', '....'],
  },
  {
    name: 'X mirror',
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100, mirrorX: true },
    rows: ['.##.', '.#..', '.##.', '.##.'],
  },
  {
    name: 'Y mirror and nonuniform scale',
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100, mirrorY: true, scaleX: 2, scaleY: 3 },
    rows: ['.##.', '.##.', '..#.', '.##.'],
  },
  {
    name: 'both mirrors and nonuniform scale',
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 100,
      y: 100,
      mirrorX: true,
      mirrorY: true,
      scaleX: 2,
      scaleY: 3,
    },
    rows: ['.##.', '.##.', '.#..', '.##.'],
  },
  {
    name: 'quarter turn, X mirror and nonuniform scale',
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 100,
      y: 100,
      mirrorX: true,
      rotationDeg: 90,
      scaleX: 2,
      scaleY: 3,
    },
    rows: ['....', '####', '##.#', '....'],
  },
];

describe('owned image clips in displayed and emitted raster output', () => {
  it.each(cases)(
    'retains the clip hole and external-mask intersection under $name',
    ({ transform, rows }) => {
      const image = { ...ownedClipImage(), transform, imageMaskId: 'external' };
      const mask = externalMask(image);
      const source = ownedClipProject(image);
      const project = { ...source, scene: { ...source.scene, objects: [image, mask] } };
      const expected = [...rows.join('')].map((pixel) => pixel === '#');
      const job = compileJob(project.scene, project.device);
      expect(job.groups).toHaveLength(1);
      const group = job.groups[0];
      if (group?.kind !== 'raster') throw Error('Expected raster output only.');
      expect([group.pixelWidth, group.pixelHeight]).toEqual([4, 4]);
      expect(Array.from(group.sValues)).toEqual(expected.map((burns) => (burns ? 300 : 0)));

      const sink = previewSink();
      sink.draw(project);
      expect(sink.drawn).toHaveLength(1);
      expect(gray(sink.drawn[0]!).map((value) => value < 255)).toEqual(expected);

      const emitted = emitGcode(project);
      expect(emitted.gcode.length).toBeGreaterThan(0);
      const powered = buildMotionManifest(emitted.gcode, { machineKind: 'laser' }).blocks.filter(
        (block) => block.kind === 'process',
      );
      const width = (group.bounds.maxX - group.bounds.minX) / 4;
      const height = (group.bounds.maxY - group.bounds.minY) / 4;
      const actual = Array.from({ length: 16 }, (_value, index) =>
        powered.some((block) =>
          spansPoint(
            block,
            group.bounds.minX + ((index % 4) + 0.5) * width,
            group.bounds.minY + (Math.floor(index / 4) + 0.5) * height,
          ),
        ),
      );
      expect(actual).toEqual(expected);
      expect(powered.reduce((sum, block) => sum + block.lengthMm, 0)).toBeCloseTo(7 * width, 6);
      expect(project.scene.objects).toHaveLength(2);
      expect(project.scene.layers).toHaveLength(1);
      expect(image.imageClip).toEqual(ownedClipImage().imageClip);
    },
  );
});

// The independently placed mask contains source columns 1..3; intersecting
// it with the owned 0..2 clip leaves columns 1..2, minus the owned one-pixel hole.
function externalMask(image: RasterImage): ImportedSvg {
  const local = clipRectangle(11, 20, 14, 24).polylines[0]!;
  const points = local.points.map((point) => applyTransform(point, image.transform));
  return {
    kind: 'imported-svg',
    id: 'external',
    source: 'external-mask.svg',
    transform: IDENTITY_TRANSFORM,
    bounds: {
      minX: Math.min(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxX: Math.max(...points.map((p) => p.x)),
      maxY: Math.max(...points.map((p) => p.y)),
    },
    paths: [{ color: 'external-mask', polylines: [{ closed: true, points }] }],
  };
}

function spansPoint(block: MotionBlock, x: number, y: number): boolean {
  const start = block.points[0]!,
    end = block.points.at(-1)!;
  return (
    Math.abs(start.y - y) < 1e-6 &&
    Math.abs(end.y - y) < 1e-6 &&
    x > Math.min(start.x, end.x) &&
    x < Math.max(start.x, end.x)
  );
}
