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
import { legacyReconcileReportedPosition } from './live-route-reconciliation-oracle.test-support';

// Six parsed jobs and an unbounded oracle per report; on a 2-vCPU CI runner
// or a loaded full-suite worker this can exceed vitest's 5 s default.
const FUZZ_TIMEOUT_MS = 60_000;

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

// toEqual over up to 64 candidates per report dominated the fuzz's run time,
// so reports compare field by field and only a mismatch pays for toEqual's
// diff. Object.is keeps toEqual's strictness on -0 and NaN.
function sameState(a: RouteReconciliationState, b: RouteReconciliationState): boolean {
  if (!Object.is(a.confirmedRouteMm, b.confirmedRouteMm) || a.uncertain !== b.uncertain) {
    return false;
  }
  if (a.candidates.length !== b.candidates.length) return false;
  return a.candidates.every((candidate, index) => sameCandidate(candidate, b.candidates[index]!));
}

function sameCandidate(a: RouteCandidate, b: RouteCandidate): boolean {
  return (
    a.blockIndex === b.blockIndex &&
    a.segmentIndex === b.segmentIndex &&
    Object.is(a.routeMm, b.routeMm) &&
    Object.is(a.distanceMm, b.distanceMm)
  );
}

type StreamTally = { reports: number; matched: number; pastOneWindow: number };

// Streams one job as the controller would: acks arrive in bursts, the head
// trails the ceiling by up to a grblHAL-default planner depth and never moves
// backwards, and one report in ten is off route. Every report must match the
// unbounded oracle exactly.
function streamAgainstOracle(
  manifest: MotionManifest,
  random: () => number,
  numbered: boolean,
  tally: StreamTally,
): void {
  let state = INITIAL_ROUTE_RECONCILIATION;
  let accepted = 0;
  let endIndex = 0;
  let headIndex = 0;
  while (accepted < manifest.sendableLineCount) {
    accepted = Math.min(manifest.sendableLineCount, accepted + 1 + Math.floor(random() * 60));
    while ((manifest.blocks[endIndex]?.sendableLineIndex ?? Infinity) < accepted) endIndex += 1;
    if (endIndex === 0) continue;
    headIndex = Math.max(headIndex, endIndex - 1 - Math.floor(random() * Math.min(endIndex, 100)));
    const head = manifest.blocks[headIndex]!;
    const offRoute = random() < 0.1;
    const reported = pointOnBlock(head, random, offRoute ? 0 : 0.6);
    const input: RouteReconciliationInput = {
      manifest,
      previous: state,
      reportedPosition: offRoute ? { ...reported, x: reported.x + 25 } : reported,
      acceptedSendableLines: accepted,
      ...(numbered ? { executingLineNumber: head.programLineNumber } : {}),
    };
    const next = reconcileReportedPosition(input);
    const unbounded = legacyReconcileReportedPosition(input);
    if (!sameState(next, unbounded)) expect(next, `accepted ${accepted}`).toEqual(unbounded);
    state = next;
    tally.reports += 1;
    if (!next.uncertain) tally.matched += 1;
    if (endIndex > EXECUTION_WINDOW_BLOCKS) tally.pastOneWindow += 1;
  }
}

describe('reconcileReportedPosition execution window fuzz', () => {
  it(
    'matches the unbounded scan report-for-report across fuzzed streamed jobs',
    () => {
      const tally: StreamTally = { reports: 0, matched: 0, pastOneWindow: 0 };
      for (let seed = 1; seed <= 6; seed += 1) {
        const random = seededRandom(seed);
        const numbered = seed % 3 === 0;
        const manifest = buildMotionManifest(fuzzProgram(random, 6_000, numbered), {
          machineKind: 'laser',
        });
        streamAgainstOracle(manifest, random, numbered, tally);
      }
      // Guard the fuzz itself: it must mostly exercise real matches, not a
      // trivially uncertain stream, and reach ceilings past one window.
      expect(tally.matched / tally.reports).toBeGreaterThan(0.8);
      expect(tally.pastOneWindow).toBeGreaterThan(100);
    },
    FUZZ_TIMEOUT_MS,
  );
});
