import { describe, expect, it } from 'vitest';
import { buildMotionManifest, type MotionBlock, type MotionManifest } from './motion-manifest';
import type { MotionPoint } from './motion-manifest';
import {
  EXECUTION_WINDOW_BLOCKS,
  INITIAL_ROUTE_RECONCILIATION,
  reconcileReportedPosition,
  type RouteCandidate,
  type RouteReconciliationInput,
  type RouteReconciliationState,
} from './live-route-reconciliation';

// The unbounded scan this module shipped before the execution window, kept
// verbatim as the oracle: while confirmed progress is within one window of the
// acknowledged ceiling the windowed scan must reproduce it exactly.
function legacyReconcile(input: RouteReconciliationInput): RouteReconciliationState {
  const tolerance = input.toleranceMm ?? 1.5;
  const candidates: RouteCandidate[] = [];
  const lineCeiling = Math.max(-1, input.acceptedSendableLines - 1);
  const hasNumbers = input.manifest.blocks.some((block) => block.programLineNumber !== null);
  const blocks = input.manifest.blocks;
  let startIndex = 0;
  let high = blocks.length;
  while (startIndex < high) {
    const middle = Math.floor((startIndex + high) / 2);
    const block = blocks[middle];
    if (block !== undefined && block.routeEndMm >= input.previous.confirmedRouteMm - 0.2) {
      high = middle;
    } else startIndex = middle + 1;
  }
  for (let blockIndex = startIndex; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (block === undefined) continue;
    if (block.sendableLineIndex > lineCeiling) break;
    if (!legacyMayBeExecuting(block, hasNumbers, input)) continue;
    legacyCollect(block, blockIndex, input, tolerance, candidates);
  }
  candidates.sort((a, b) => a.routeMm - b.routeMm || a.distanceMm - b.distanceMm);
  const feasible = candidates.slice(0, 64);
  if (feasible.length === 0) return { ...input.previous, candidates: [], uncertain: true };
  return {
    confirmedRouteMm: Math.max(input.previous.confirmedRouteMm, feasible[0]?.routeMm ?? 0),
    candidates: feasible,
    uncertain: false,
  };
}

function legacyMayBeExecuting(
  block: MotionBlock,
  hasNumbers: boolean,
  input: RouteReconciliationInput,
): boolean {
  if (!hasNumbers || input.executingLineNumber == null) return true;
  if (input.executingLineNumber <= 0 || block.programLineNumber === null) return true;
  return block.programLineNumber <= input.executingLineNumber;
}

function legacyCollect(
  block: MotionBlock,
  blockIndex: number,
  input: RouteReconciliationInput,
  toleranceMm: number,
  output: RouteCandidate[],
): void {
  const point = input.reportedPosition;
  let blockDistance = 0;
  for (let index = 1; index < block.points.length; index += 1) {
    const from = block.points[index - 1]!;
    const to = block.points[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const denominator = dx * dx + dy * dy + dz * dz;
    const raw =
      denominator <= Number.EPSILON
        ? 0
        : ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) /
          denominator;
    const t = Math.max(0, Math.min(1, raw));
    const distanceMm = Math.hypot(
      point.x - (from.x + dx * t),
      point.y - (from.y + dy * t),
      point.z - (from.z + dz * t),
    );
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const routeMm = block.routeStartMm + blockDistance + t * segmentLength;
    blockDistance += segmentLength;
    if (routeMm + 0.2 < input.previous.confirmedRouteMm) continue;
    if (distanceMm > toleranceMm) continue;
    output.push({ blockIndex, segmentIndex: index - 1, routeMm, distanceMm });
  }
}

// Mulberry32. A fixed seed keeps the fuzz reproducible - a failure is always
// re-runnable.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (value: number): string => value.toFixed(3);

// Mixes the shapes that make route matching ambiguous: serpentine raster rows
// 0.1 mm apart, a square cut in repeated passes, arcs, Z moves, and
// non-motion/comment lines so sendable line indices outpace block indices.
function fuzzProgram(random: () => number, lineCount: number, numbered: boolean): string {
  const lines = ['G21', 'G90', 'M3 S0'];
  let lineNumber = 10;
  let x = 0;
  let y = 0;
  const emit = (code: string): void => {
    lines.push(numbered ? `N${lineNumber} ${code}` : code);
    lineNumber += 10;
  };
  while (lines.length < lineCount) {
    const shape = random();
    if (shape < 0.3) {
      const width = 2 + random() * 30;
      for (let row = 0; row < 5 + Math.floor(random() * 40); row += 1) {
        x += row % 2 === 0 ? width : -width;
        emit(`G1 X${f(x)} S${Math.floor(random() * 1000)}`);
        y += 0.1;
        emit(`G1 Y${f(y)}`);
      }
    } else if (shape < 0.45) {
      const side = 1 + random() * 8;
      for (let pass = 0; pass < 2 + Math.floor(random() * 4); pass += 1) {
        emit(`G1 X${f(x + side)} Y${f(y)} Z${f(-0.5 * pass)}`);
        emit(`G1 X${f(x + side)} Y${f(y + side)}`);
        emit(`G1 X${f(x)} Y${f(y + side)}`);
        emit(`G1 X${f(x)} Y${f(y)}`);
      }
    } else if (shape < 0.6) {
      const i = (random() - 0.5) * 20;
      const j = (random() - 0.5) * 20;
      const angle = random() * Math.PI * 2;
      x += i + Math.hypot(i, j) * Math.cos(angle);
      y += j + Math.hypot(i, j) * Math.sin(angle);
      emit(`${random() < 0.5 ? 'G2' : 'G3'} X${f(x)} Y${f(y)} I${f(i)} J${f(j)}`);
    } else if (shape < 0.7) {
      lines.push('; layer comment');
      emit(`S${Math.floor(random() * 1000)}`);
      emit(random() < 0.5 ? 'M3' : 'G90');
    } else {
      x += (random() - 0.5) * 40;
      y += (random() - 0.5) * 40;
      emit(`${random() < 0.3 ? 'G0' : 'G1'} X${f(x)} Y${f(y)} Z${f(-random())}`);
    }
  }
  return lines.join('\n');
}

function pointOnBlock(block: MotionBlock, random: () => number, jitterMm: number): MotionPoint {
  const segment = Math.floor(random() * (block.points.length - 1));
  const from = block.points[segment]!;
  const to = block.points[segment + 1]!;
  const t = random();
  return {
    x: from.x + (to.x - from.x) * t + (random() - 0.5) * jitterMm,
    y: from.y + (to.y - from.y) * t + (random() - 0.5) * jitterMm,
    z: from.z + (to.z - from.z) * t,
  };
}

// A serpentine raster, `passes` identical passes of `rowsPerPass` rows 0.1 mm
// apart, one block per row plus a return travel per pass, and a non-motion
// line between rows — the shape of a long fill job repeated for depth.
function rasterManifest(rowsPerPass: number, passes: number): MotionManifest {
  const blocks: MotionBlock[] = [];
  let routeMm = 0;
  let line = 0;
  let from: MotionPoint = { x: 0, y: 0, z: 0 };
  const push = (points: ReadonlyArray<MotionPoint>): void => {
    let lengthMm = 0;
    for (let i = 1; i < points.length; i += 1) {
      lengthMm += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
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
    line += 2;
    from = points.at(-1)!;
  };
  for (let pass = 0; pass < passes; pass += 1) {
    for (let row = 0; row < rowsPerPass; row += 1) {
      const y = row * 0.1;
      push([from, { x: from.x, y, z: 0 }, { x: row % 2 === 0 ? 50 : 0, y, z: 0 }]);
    }
    push([from, { x: 0, y: 0, z: 0 }]);
  }
  return {
    blocks,
    totalRouteMm: routeMm,
    sendableLineCount: line,
    firstProcessPoint: blocks[0]?.points[0] ?? null,
    finalPoint: from,
  };
}

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
  it('matches the unbounded scan report-for-report across fuzzed streamed jobs', () => {
    let matchedReports = 0;
    let reports = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = seededRandom(seed);
      const numbered = seed % 4 === 0;
      const manifest = buildMotionManifest(fuzzProgram(random, 9_000, numbered), {
        machineKind: 'laser',
      });
      let state = INITIAL_ROUTE_RECONCILIATION;
      let accepted = 0;
      let endIndex = 0;
      let headIndex = 0;
      while (accepted < manifest.sendableLineCount) {
        accepted = Math.min(manifest.sendableLineCount, accepted + 1 + Math.floor(random() * 60));
        while (
          manifest.blocks[endIndex] !== undefined &&
          manifest.blocks[endIndex]!.sendableLineIndex < accepted
        ) {
          endIndex += 1;
        }
        if (endIndex === 0) continue;
        // The head trails the ceiling by up to a grblHAL-default planner depth
        // and never moves backwards; one report in ten is off route.
        const depth = Math.floor(random() * Math.min(endIndex, 100));
        headIndex = Math.max(headIndex, endIndex - 1 - depth);
        const head = manifest.blocks[headIndex]!;
        const offRoute = random() < 0.1;
        const reported = pointOnBlock(head, random, offRoute ? 0 : 0.6);
        const executingLineNumber = numbered ? head.programLineNumber : undefined;
        const input: RouteReconciliationInput = {
          manifest,
          previous: state,
          reportedPosition: offRoute ? { ...reported, x: reported.x + 25 } : reported,
          acceptedSendableLines: accepted,
          ...(executingLineNumber === undefined ? {} : { executingLineNumber }),
        };
        const next = reconcileReportedPosition(input);
        expect(next, `seed ${seed} accepted ${accepted}`).toEqual(legacyReconcile(input));
        state = next;
        reports += 1;
        if (!next.uncertain) matchedReports += 1;
      }
    }
    // Guard the fuzz itself: it must mostly exercise real matches, not a
    // trivially uncertain stream.
    expect(matchedReports / reports).toBeGreaterThan(0.8);
  });

  it('scans at most one window per report while the match stays frozen in a long job', () => {
    const raster = rasterManifest(20_000, 10);
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
    legacyReconcile(offRouteReport(raster.sendableLineCount - 50));
    expect(scanned.size).toBeGreaterThan(190_000);
  });

  it('recovers from a frozen match onto the pass the planner is executing', () => {
    const raster = rasterManifest(20_000, 10);
    const lastPassStart = raster.blocks[9 * 20_001]!;
    const head = raster.blocks[9 * 20_001 + 12_000]!;
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
    // nine passes ago.
    expect(legacyReconcile(input).confirmedRouteMm).toBeLessThan(
      raster.blocks[20_001]!.routeStartMm,
    );
  });
});
