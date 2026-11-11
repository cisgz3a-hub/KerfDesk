import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePngFile } from '../../__fixtures__/perceptual/png-decode';
import type { Polyline } from '../scene';
import { TRACE_PRESETS, traceImageToColoredPaths, type RawImageData } from '../trace';
import {
  polylineContactIndex,
  polylineContactIndexSteps,
  type ContactIndex,
  type ContactSegment,
} from './polyline-contact-index';
import { preparePolylineContacts, preparePolylineContactsSteps } from './prepare-polyline-contacts';

// The builder as it was before its split keys were computed once per segment
// (a 9 MP CNC trace spent 2.4 s here in one UI task). The index must not change.
function previousBuildIndex(segments: ReadonlyArray<ContactSegment>): ContactIndex {
  const bounds = segments.reduce(
    (b, s) => ({
      minX: Math.min(b.minX, s.minX),
      minY: Math.min(b.minY, s.minY),
      maxX: Math.max(b.maxX, s.maxX),
      maxY: Math.max(b.maxY, s.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  if (segments.length <= 8) return { ...bounds, segments };
  const isX = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
  const sorted = [...segments].sort((a, b) =>
    isX
      ? a.minX / 2 + a.maxX / 2 - (b.minX / 2 + b.maxX / 2)
      : a.minY / 2 + a.maxY / 2 - (b.minY / 2 + b.maxY / 2),
  );
  const middle = Math.floor(sorted.length / 2);
  return {
    ...bounds,
    left: previousBuildIndex(sorted.slice(0, middle)),
    right: previousBuildIndex(sorted.slice(middle)),
  };
}

function leafSegments(index: ContactIndex | null): ContactSegment[] {
  if (index === null) return [];
  return 'segments' in index
    ? [...index.segments]
    : [...leafSegments(index.left), ...leafSegments(index.right)];
}

function crop(image: RawImageData, x: number, y: number, w: number, h: number): RawImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + w * 4), row * w * 4);
  }
  return { width: w, height: h, data };
}

async function tracedPolylines(): Promise<Polyline[]> {
  const page = decodePngFile(
    resolve('src/__fixtures__/perceptual/assets/centerline-stress-test-20260909.png'),
  );
  const paths = await traceImageToColoredPaths(
    crop(page, 250, 250, 320, 320),
    TRACE_PRESETS['Centerline']!,
  );
  return paths.flatMap((path) => path.polylines);
}

/** Many equal centres and degenerate segments, where sort order is all ties. */
function tiedPolylines(): Polyline[] {
  return Array.from({ length: 60 }, (_, row) => ({
    closed: row % 3 === 0,
    points: Array.from({ length: 12 }, (_, column) => ({
      x: (column % 4) * 2 + (row % 2 === 0 ? 0 : -0),
      y: Math.floor(row / 6) + (column === 5 ? 0.5 : 0),
    })),
  }));
}

describe('polylineContactIndex', () => {
  it.each([
    ['a Centerline trace', tracedPolylines],
    ['tied and degenerate segments', async () => tiedPolylines()],
  ])(
    'builds the same index as before for %s',
    async (_name, polylines) => {
      const lines = await polylines();
      const index = polylineContactIndex(lines);
      expect(leafSegments(index).length).toBeGreaterThan(100);
      expect(index).toEqual(previousBuildIndex(leafSegments(index)));
    },
    60_000,
  );

  it('gives a cooperative runner a checkpoint per index node and builds the same index', async () => {
    const lines = await tracedPolylines();
    const steps = polylineContactIndexSteps(lines);
    let checkpoints = 0;
    let step = steps.next(true);
    while (step.done !== true) {
      checkpoints += 1;
      step = steps.next(true);
    }
    expect(checkpoints).toBeGreaterThan(10);
    expect(step.value).toEqual(polylineContactIndex(lines));
  }, 60_000);
});

describe('preparePolylineContactsSteps', () => {
  it('prepares the same contacts with checkpoints as in one call', async () => {
    const lines = await tracedPolylines();
    const once = preparePolylineContacts(lines);
    const steps = preparePolylineContactsSteps(lines);
    let step = steps.next(true);
    while (step.done !== true) step = steps.next(true);
    expect(step.value.polylines).toEqual(once.polylines);
    expect([...step.value.pinnedPoints]).toEqual([...once.pinnedPoints]);
    // Pins identify point objects, so they must be the very same objects.
    for (const pin of step.value.pinnedPoints) expect(once.pinnedPoints.has(pin)).toBe(true);
  }, 60_000);
});
