import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type LayerOperationSettings,
  type Polyline,
  type SceneObject,
} from '../scene';
import { compileJob } from './compile-job';
import type { CutSegment, Job } from './job';
import { optimizePaths } from './optimize-paths';

const device = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'rear-left' as const,
  bedWidth: 200,
  bedHeight: 200,
};
const color = '#000000';
const square = (at: number, size: number): Polyline => ({
  closed: true,
  points: [
    { x: at, y: at },
    { x: at + size, y: at },
    { x: at + size, y: at + size },
    { x: at, y: at + size },
  ],
});
function artwork(id: string, at: number, size: number): ImportedSvg {
  return {
    id,
    kind: 'imported-svg',
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: at, minY: at, maxX: at + size, maxY: at + size },
    paths: [{ color, polylines: [square(at, size)] }],
  };
}
const plate = artwork('plate', 0, 100);
const hole = artwork('hole', 40, 20);
const layer = (settings: Partial<LayerOperationSettings> = {}): Layer => ({
  ...createLayer({ id: 'operation', color, mode: 'line' }),
  power: 80,
  speed: 1200,
  passes: 2,
  ...settings,
});
const compile = (objects: readonly SceneObject[], operation = layer()): Job =>
  compileJob({ objects, layers: [operation] }, device);
function cutSegments(job: Job): CutSegment[] {
  return job.groups.flatMap((group) => (group.kind === 'cut' ? [...group.segments] : []));
}
const tabs: Partial<LayerOperationSettings> = { tabsEnabled: true, tabSizeMm: 2, tabsPerShape: 4 };
const perforation: Partial<LayerOperationSettings> = {
  perforationEnabled: true,
  perforationCutMm: 3,
  perforationSkipMm: 1,
};
function isInner(segment: CutSegment): boolean {
  return segment.polyline.every((p) => p.x >= 39 && p.x <= 61 && p.y >= 39 && p.y <= 61);
}

describe('K2 inside-first order uses parent contours before segmentation', () => {
  it.each([
    { name: 'tabs', settings: tabs },
    { name: 'perforation', settings: perforation },
    { name: 'kerf and tabs', settings: { ...tabs, kerfOffsetMm: 1 } },
    { name: 'kerf, tabs and perforation', settings: { ...tabs, ...perforation, kerfOffsetMm: 1 } },
  ])('cuts every hole segment before its outer fragments with $name', ({ settings }) => {
    const segments = cutSegments(optimizePaths(compile([plate, hole], layer(settings))));
    expect(segments.length).toBeGreaterThan(2);
    const innerCount = segments.filter(isInner).length;
    expect(innerCount).toBeGreaterThan(0);
    expect(segments.slice(0, innerCount).every(isInner)).toBe(true);
    expect(segments.slice(innerCount).some(isInner)).toBe(false);
    expect(segments.some((segment) => !isInner(segment) && !segment.closed)).toBe(true);
  });

  it('control: source order retains outer-fragment-first traversal when requested', () => {
    const optimized = optimizePaths(compile([plate, hole], layer(tabs)), {
      travelPolicy: 'source-order',
      insideFirst: true,
      layerPriority: 'project-order',
      pathDirection: 'allow-reverse',
      startPoint: 'machine-origin',
    });
    expect(isInner(cutSegments(optimized)[0]!)).toBe(false);
  });
});
