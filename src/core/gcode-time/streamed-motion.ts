// The totals-only program clock, planned as the parser reads the program
// (performance audit S3-P2-3, ADR-244 Amendment 2).
//
// The ETA used to keep the whole render model (positions, kinds, feeds,
// powers, lines and lengths: about 50 bytes a move, 408 MB for a bed-sized
// photo) only to plan it once. This takes each move from the parser instead
// and keeps nothing of it but the planner's columns. A line's moves wait until
// the line has been read, when its events are known, then join the current
// span exactly as motionSpans splits the model's moves. Each move is timed
// from the values the model would have stored (Float32 positions, feed, power
// and route ends; Uint8 kind and motion; Uint32 line), so every second is the
// same double buildProgramTime gives.

import { SEG_MOTION, type ProgramEvent } from '../gcode-view';
import type {
  FinishedSegments,
  SegmentBuilder,
  SegmentRecord,
} from '../gcode-view/segment-builder';
import type { Block } from '../motion-planner';
import { ChunkedColumn } from '../motion-planner/chunked-column';
import { ColumnarPlan } from '../motion-planner/columnar-plan';
import { sanitizeLimits, type MotionLimits } from './motion-limits';
import {
  segmentPrecedesBoundary,
  synchronizationBoundaries,
  type SynchronizationBoundary,
} from './motion-spans';
import {
  isCuttingMove,
  motionContext,
  MotionTally,
  totalDwellSeconds,
  type MotionContext,
  type ProgramMotionTotals,
} from './program-time';
import type { ProgramTimingOptions } from './program-timing-options';
import { storedSegmentBlock } from './segment-blocks';

const CUTTING = 1;
const RAPID = 2;

type PendingMove = { readonly block: Block; readonly line: number; readonly flags: number };

type Span = {
  readonly plan: ColumnarPlan;
  readonly lines: ChunkedColumn<Uint32Array>;
  readonly flags: ChunkedColumn<Uint8Array>;
};

export class StreamedMotion {
  /** Hand these two to createGcodeRenderModelBuilder. */
  readonly segments: SegmentBuilder;
  readonly events: ProgramEvent[] = [];
  /** Seconds of motion per raw line, once finish() has run. */
  readonly lineSeconds = new ChunkedColumn((length) => new Float64Array(length));
  private readonly limits: MotionLimits;
  private readonly context: MotionContext;
  private readonly tally: MotionTally;
  private readonly boundaries: SynchronizationBoundary[] = [];
  private boundaryIndex = 0;
  private eventsRead = 0;
  private readonly pending: PendingMove[] = [];
  private span: Span | null = null;
  private count = 0;
  private routeMm = 0;
  private routeEndMm = 0; // As segRouteEndMm stores it.
  private firstMissingFeedLine: number | null = null;

  constructor(rawLimits: MotionLimits, options: ProgramTimingOptions) {
    this.limits = sanitizeLimits(rawLimits);
    this.context = motionContext(options, undefined);
    this.tally = new MotionTally(this.context);
    this.segments = {
      push: (segment) => this.push(segment),
      count: () => this.count,
      copyRange: () => ({ positions: new Float32Array(0), segKind: new Uint8Array(0) }),
      // The model keeps no moves: they were timed as they came.
      finish: () => noSegments(this.routeMm),
    };
  }

  /** Call once after each line is pushed to the builder. */
  endLine(): void {
    this.lineSeconds.push(0);
    if (this.events.length > this.eventsRead) this.addBoundaries();
    for (const move of this.pending) this.commit(move);
    this.pending.length = 0;
  }

  /** The line firstMissingFeedSegment would report, for timingUnavailableReason. */
  missingFeedLine(): number | null {
    return this.firstMissingFeedLine;
  }

  /** Plans the last span and returns the motion totals. */
  finish(): ProgramMotionTotals {
    for (const move of this.pending) this.commit(move);
    this.pending.length = 0;
    this.closeSpan();
    return this.tally.totals(totalDwellSeconds(this.events), this.limits.accelMmPerSec2);
  }

  private push(segment: SegmentRecord): void {
    const motion = segment.motion & 0xff; // As a Uint8Array stores it.
    const feed = Math.fround(segment.feed);
    const routeStartMm = this.count === 0 ? 0 : this.routeEndMm;
    this.routeMm += segment.lengthMm;
    this.routeEndMm = Math.fround(this.routeMm);
    const block = storedSegmentBlock(
      {
        dx: Math.fround(segment.x1) - Math.fround(segment.x0),
        dy: Math.fround(segment.y1) - Math.fround(segment.y0),
        dz: Math.fround(segment.z1) - Math.fround(segment.z0),
        motion,
        kind: segment.kind & 0xff,
        feed,
        lengthMm: segment.lengthMm,
        routeStartMm,
        routeEndMm: this.routeEndMm,
      },
      this.limits,
    );
    const line = segment.line >>> 0;
    const rapid = motion === SEG_MOTION.rapid;
    if (this.firstMissingFeedLine === null && !rapid && !(Number.isFinite(feed) && feed > 0)) {
      this.firstMissingFeedLine = line;
    }
    const power = Math.fround(segment.power);
    const cutting = isCuttingMove(rapid, block.kind, this.context.machineKind, power);
    this.pending.push({ block, line, flags: (cutting ? CUTTING : 0) | (rapid ? RAPID : 0) });
    this.count += 1;
  }

  // The builder pushes every event of a line while it reads that line, so a
  // line's boundaries all sort after those of the lines before it.
  private addBoundaries(): void {
    const added = synchronizationBoundaries(this.events.slice(this.eventsRead));
    this.eventsRead = this.events.length;
    const last = this.boundaries[this.boundaries.length - 1];
    const first = added[0];
    if (last !== undefined && first !== undefined && compareBoundaries(first, last) < 0) {
      throw new Error('Program events arrived out of line order.');
    }
    this.boundaries.push(...added);
  }

  // motionSpans' merge of moves and boundaries, one move at a time.
  private commit(move: PendingMove): void {
    let boundary = this.boundaries[this.boundaryIndex];
    while (boundary !== undefined && !segmentPrecedesBoundary(move.line, boundary)) {
      this.closeSpan();
      this.boundaryIndex += 1;
      boundary = this.boundaries[this.boundaryIndex];
    }
    this.span ??= {
      plan: new ColumnarPlan(
        this.limits.accelMmPerSec2,
        this.limits.junctionDeviationMm,
        this.context.plannerBlocks,
        this.limits.kinematics ?? 'cartesian',
      ),
      lines: new ChunkedColumn((length) => new Uint32Array(length)),
      flags: new ChunkedColumn((length) => new Uint8Array(length)),
    };
    this.span.plan.push(move.block);
    this.span.lines.push(move.line);
    this.span.flags.push(move.flags);
  }

  private closeSpan(): void {
    const span = this.span;
    if (span === null) return;
    this.span = null;
    span.plan.finish((index, block, entryV, exitV, accel) => {
      const flags = span.flags.get(index);
      const cutting = (flags & CUTTING) !== 0;
      const seconds = this.tally.add(block, entryV, exitV, accel, cutting, (flags & RAPID) !== 0);
      const line = span.lines.get(index);
      this.lineSeconds.set(line, this.lineSeconds.get(line) + seconds);
    });
  }
}

// synchronizationBoundaries' sort order.
function compareBoundaries(left: SynchronizationBoundary, right: SynchronizationBoundary): number {
  return left.line - right.line || Number(right.isBeforeMotion) - Number(left.isBeforeMotion);
}

function noSegments(totalRouteMm: number): FinishedSegments {
  return {
    segmentCount: 0,
    positions: new Float32Array(0),
    segKind: new Uint8Array(0),
    segMotion: new Uint8Array(0),
    segLine: new Uint32Array(0),
    segFeed: new Float32Array(0),
    segPower: new Float32Array(0),
    segRouteEndMm: new Float32Array(0),
    segLengthMm: new Float64Array(0),
    totalRouteMm,
  };
}
