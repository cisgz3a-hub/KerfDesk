import { describe, expect, it } from 'vitest';
import type { MotionBlock, MotionManifest, MotionPoint } from './motion-manifest';
import {
  EXECUTION_WINDOW_BLOCKS,
  INITIAL_ROUTE_RECONCILIATION,
  reconcileReportedPosition,
  type RouteReconciliationInput,
  type RouteReconciliationState,
} from './live-route-reconciliation';
import { legacyReconcileReportedPosition } from './live-route-reconciliation-oracle.test-support';

// These build jobs of tens of thousands of blocks and run the unbounded
// oracle across them; on a 2-vCPU CI runner or a loaded full-suite worker
// they can exceed vitest's 5 s default.
const LONG_JOB_TIMEOUT_MS = 60_000;

// Lays blocks out the way the parser does: stream order, route accumulating,
// `linesPerBlock` sendable lines per block, each block starting where the
// last one ended. Skips the parser so 50k-block jobs stay cheap to build.
function manifestBuilder(linesPerBlock: number): {
  readonly at: () => MotionPoint;
  readonly moveTo: (...targets: MotionPoint[]) => void;
  readonly build: () => MotionManifest;
} {
  const blocks: MotionBlock[] = [];
  let routeMm = 0;
  let line = 0;
  let at: MotionPoint = { x: 0, y: 0, z: 0 };
  const moveTo = (...targets: MotionPoint[]): void => {
    const points = [at, ...targets];
    let lengthMm = 0;
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1]!;
      const to = points[i]!;
      lengthMm += Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    }
    blocks.push({
      rawLineIndex: line,
      sendableLineIndex: line,
      programLineNumber: null,
      kind: 'process',
      points,
      lengthMm,
      routeStartMm: routeMm,
      routeEndMm: routeMm + lengthMm,
    });
    routeMm += lengthMm;
    line += linesPerBlock;
    at = targets.at(-1) ?? at;
  };
  const build = (): MotionManifest => ({
    blocks,
    totalRouteMm: routeMm,
    sendableLineCount: line,
    firstProcessPoint: blocks[0]?.points[0] ?? null,
    finalPoint: at,
  });
  return { at: () => at, moveTo, build };
}

// A serpentine raster, `passes` identical passes of `rowsPerPass` 50 mm rows
// 0.1 mm apart, one block per row plus a return travel per pass, and a
// non-motion line between rows — the shape of a long fill repeated for depth.
function rasterManifest(rowsPerPass: number, passes: number): MotionManifest {
  const builder = manifestBuilder(2);
  for (let pass = 0; pass < passes; pass += 1) {
    for (let row = 0; row < rowsPerPass; row += 1) {
      const y = row * 0.1;
      builder.moveTo({ x: builder.at().x, y, z: 0 }, { x: row % 2 === 0 ? 50 : 0, y, z: 0 });
    }
    builder.moveTo({ x: 0, y: 0, z: 0 });
  }
  return builder.build();
}

// A serpentine photo raster: `rows` 0.1 mm apart, each a step then one block
// per 0.1 mm pixel, as a fill with per-pixel power emits it.
function pixelRasterManifest(rows: number, pixelsPerRow: number): MotionManifest {
  const builder = manifestBuilder(1);
  const widthMm = pixelsPerRow * 0.1;
  for (let row = 0; row < rows; row += 1) {
    const y = row * 0.1;
    builder.moveTo({ x: builder.at().x, y, z: 0 });
    for (let pixel = 1; pixel <= pixelsPerRow; pixel += 1) {
      const x = row % 2 === 0 ? pixel * 0.1 : widthMm - pixel * 0.1;
      builder.moveTo({ x, y, z: 0 });
    }
  }
  return builder.build();
}

// 50k blocks, over twelve windows: long enough that a frozen match or a stale
// earlier pass sits far outside the window. Built once for the tests below.
const ROWS_PER_PASS = 10_000;
const PASSES = 5;
let longRasterCache: MotionManifest | undefined;
const longRaster = (): MotionManifest =>
  (longRasterCache ??= rasterManifest(ROWS_PER_PASS, PASSES));

// Records which blocks had their geometry read, i.e. which ones were scanned.
function countingManifest(manifest: MotionManifest): {
  readonly manifest: MotionManifest;
  readonly scanned: Set<number>;
} {
  const scanned = new Set<number>();
  const blocks = manifest.blocks.map(
    (block, index) =>
      new Proxy(block, {
        get(target, property, receiver) {
          if (property === 'points') scanned.add(index);
          return Reflect.get(target, property, receiver) as unknown;
        },
      }),
  );
  return { manifest: { ...manifest, blocks }, scanned };
}

describe('reconcileReportedPosition execution window', () => {
  it(
    'keeps matched dense-raster progress between the unbounded scan and the head',
    () => {
      // 30 mm rows of 0.1 mm pixels, 0.1 mm apart: the 1.5 mm tolerance still
      // matches rows fifteen back, about 4500 blocks, which is past the window.
      const raster = pixelRasterManifest(90, 300);
      let state = INITIAL_ROUTE_RECONCILIATION;
      let headIndex = 0;
      let narrowedReports = 0;
      for (let report = 1; headIndex + 1_000 < raster.blocks.length; report += 1) {
        // About three rows per 250 ms status (~360 mm/s), with the ceiling up
        // to a grblHAL-default planner depth ahead of the head.
        headIndex += 800 + ((report * 37) % 200);
        const head = raster.blocks[headIndex]!;
        const ceiling = raster.blocks[headIndex + ((report * 53) % 100)]!;
        const input: RouteReconciliationInput = {
          manifest: raster,
          previous: state,
          reportedPosition: head.points.at(-1)!,
          acceptedSendableLines: ceiling.sendableLineIndex + 1,
        };

        const next = reconcileReportedPosition(input);
        const unbounded = legacyReconcileReportedPosition(input);

        expect(next.uncertain).toBe(false);
        expect(next.confirmedRouteMm).toBeGreaterThanOrEqual(unbounded.confirmedRouteMm);
        expect(next.confirmedRouteMm).toBeLessThanOrEqual(head.routeEndMm + 1e-9);
        if (next.confirmedRouteMm > unbounded.confirmedRouteMm) narrowedReports += 1;
        state = next;
      }
      // The window binds while matched: the unbounded scan settled on rows
      // that left the planner, the windowed one on rows nearer the head.
      expect(narrowedReports).toBeGreaterThan(0);
    },
    LONG_JOB_TIMEOUT_MS,
  );

  it(
    'scans at most one window per report while the match stays frozen in a long job',
    () => {
      const raster = longRaster();
      const { manifest, scanned } = countingManifest(raster);
      const frozen: RouteReconciliationState = {
        confirmedRouteMm: raster.blocks[1_000]!.routeStartMm,
        candidates: [],
        uncertain: true,
      };
      const offRouteReport = (acceptedSendableLines: number): RouteReconciliationInput => ({
        manifest,
        previous: frozen,
        reportedPosition: { x: -40, y: 7, z: 0 },
        acceptedSendableLines,
      });
      const scannedAt = (input: RouteReconciliationInput): number => {
        scanned.clear();
        expect(reconcileReportedPosition(input)).toEqual(frozen);
        return scanned.size;
      };

      const midJob = scannedAt(offRouteReport(raster.sendableLineCount / 2));
      const lateJob = scannedAt(offRouteReport(raster.sendableLineCount - 50));

      // Work per report no longer grows with how long the match has been frozen.
      expect(lateJob).toBe(midJob);
      expect(lateJob).toBeLessThanOrEqual(EXECUTION_WINDOW_BLOCKS);
      // The unbounded scan walked every block from the frozen point to the ceiling.
      scanned.clear();
      legacyReconcileReportedPosition(offRouteReport(raster.sendableLineCount - 50));
      expect(scanned.size).toBeGreaterThan(10 * EXECUTION_WINDOW_BLOCKS);
    },
    LONG_JOB_TIMEOUT_MS,
  );

  it(
    'recovers from a frozen match onto the pass the planner is executing',
    () => {
      const raster = longRaster();
      const passBlocks = ROWS_PER_PASS + 1;
      const lastPassStart = raster.blocks[(PASSES - 1) * passBlocks]!;
      const head = raster.blocks[(PASSES - 1) * passBlocks + 6_000]!;
      const frozen: RouteReconciliationState = {
        confirmedRouteMm: raster.blocks[1_000]!.routeStartMm,
        candidates: [],
        uncertain: true,
      };
      const input: RouteReconciliationInput = {
        manifest: raster,
        previous: frozen,
        reportedPosition: head.points.at(-1)!,
        acceptedSendableLines: head.sendableLineIndex + 1 + 2 * 60,
      };

      const result = reconcileReportedPosition(input);

      expect(result.uncertain).toBe(false);
      expect(result.confirmedRouteMm).toBeGreaterThan(lastPassStart.routeStartMm);
      expect(result.confirmedRouteMm).toBeLessThanOrEqual(head.routeEndMm);
      // The same rows in pass one also lie within tolerance of the head, and
      // the unbounded scan settled on them although they left the planner
      // passes ago.
      expect(legacyReconcileReportedPosition(input).confirmedRouteMm).toBeLessThan(
        raster.blocks[passBlocks]!.routeStartMm,
      );
    },
    LONG_JOB_TIMEOUT_MS,
  );
});
