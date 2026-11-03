// planVelocities in columns, for totals-only timing (performance audit
// S3-P2-3, ADR-244 Amendment 2).
//
// planVelocities keeps a Block, its direction and a PlanEntry object for every
// move, about 180 bytes each: 1.3-1.5 GB for the 8 million moves of a
// bed-sized photo. This planner keeps the same plan in typed columns (distance,
// target speed, entry speed, a cut flag and, only when it varies, the
// acceleration: 25 to 33 bytes a move) that grow as blocks arrive, so a parser
// can feed it without knowing how many will come. It runs the same passes in
// the same order with the same expressions, so every entry, exit and block
// time is the very same double:
//  - capJunctionEntries as each block is added, since it reads only that
//    block and the one before it;
//  - capPlannerWindowEntries from the same running prefix sums of distance,
//    kept in a ring of plannerBlocks + 1 values instead of one per block. Each
//    entry is capped once its window's end is known, after its junction cap;
//  - backwardPass, then forwardPass, which hands each block to the caller as
//    it finishes it: no later pass changes a block's entry or exit.
// No exit column is needed: backwardPass sets each exit to the next block's
// entry, and forwardPass reads that exit before it changes that entry.

import type { MachineKinematics } from '../devices/device-profile';
import type { Block, BlockKind } from './block';
import { ChunkedColumn } from './chunked-column';
import { junctionVelocity } from './junction';
import { blockAcceleration, junctionPlanningLimits } from './planner-kinematics';

/** The parts of a block its planned time and accounting read. */
export type PlannedBlock = Pick<Block, 'kind' | 'distance' | 'targetVelocity'>;

/**
 * One finished block. `block` is reused for the next call, so read it during
 * the call and do not keep it.
 */
export type PlannedBlockVisit = (
  index: number,
  block: PlannedBlock,
  entryV: number,
  exitV: number,
  accel: number,
) => void;

type PlannedBlockScratch = { kind: BlockKind; distance: number; targetVelocity: number };

const float64 = (length: number) => new Float64Array(length);

export class ColumnarPlan {
  private readonly distance = new ChunkedColumn(float64);
  private readonly targetVelocity = new ChunkedColumn(float64);
  private readonly entryV = new ChunkedColumn(float64);
  private readonly cut = new ChunkedColumn((length) => new Uint8Array(length));
  // Started on the first block planned at another acceleration; until then
  // every block's is `accel` (always so on a Cartesian machine).
  private accels: ChunkedColumn<Float64Array> | null = null;
  private readonly window: PlannerWindow | null;
  private previous: Block | null = null;

  constructor(
    private readonly accel: number,
    private readonly jd: number,
    plannerBlocks: number | undefined,
    private readonly kinematics: MachineKinematics = 'cartesian',
  ) {
    this.window = isPlannerWindow(plannerBlocks) ? new PlannerWindow(plannerBlocks - 1) : null;
  }

  get length(): number {
    return this.distance.length;
  }

  /** Adds the next block. */
  push(block: Block): void {
    const i = this.distance.length;
    this.distance.push(block.distance);
    this.targetVelocity.push(block.targetVelocity);
    this.cut.push(block.kind === 'cut' ? 1 : 0);
    this.pushAccel(i, blockAcceleration(block, this.accel, this.kinematics));
    const prev = this.previous;
    let entryV = 0; // The first block enters from rest.
    if (prev !== null) {
      // capJunctionEntries.
      const corner = junctionPlanningLimits(prev, block, this.accel, this.jd, this.kinematics);
      const vJunction = junctionVelocity(prev, block, corner.accel, corner.jd);
      entryV = Math.min(prev.targetVelocity, block.targetVelocity, vJunction);
    }
    this.entryV.push(entryV);
    this.previous = block;
    this.window?.add(block.distance, i, (index, roomMm) => this.capWindowEntry(index, roomMm));
  }

  /** Plans the blocks added and visits each in order with its entry and exit. */
  finish(visit: PlannedBlockVisit): void {
    const n = this.length;
    this.window?.finish((index, roomMm) => this.capWindowEntry(index, roomMm));
    this.backwardPass(n);
    this.forwardPass(n, visit);
  }

  private accelAt(i: number): number {
    return this.accels === null ? this.accel : this.accels.get(i);
  }

  private pushAccel(i: number, value: number): void {
    if (this.accels === null) {
      if (Object.is(value, this.accel)) return;
      this.accels = new ChunkedColumn(float64);
      for (let earlier = 0; earlier < i; earlier += 1) this.accels.push(this.accel);
    }
    this.accels.push(value);
  }

  // capPlannerWindowEntries, for one entry.
  private capWindowEntry(i: number, roomMm: number): void {
    this.entryV.set(i, Math.min(this.entryV.get(i), Math.sqrt(2 * this.accelAt(i) * roomMm)));
  }

  // backwardPass. The last block exits to rest.
  private backwardPass(n: number): void {
    for (let i = n - 1; i >= 0; i -= 1) {
      const exit = i === n - 1 ? 0 : this.entryV.get(i + 1);
      const maxEntry = Math.sqrt(exit * exit + 2 * this.accelAt(i) * this.distance.get(i));
      this.entryV.set(i, Math.min(this.entryV.get(i), maxEntry));
    }
  }

  // forwardPass; each block is final once it has run.
  private forwardPass(n: number, visit: PlannedBlockVisit): void {
    const block: PlannedBlockScratch = { kind: 'travel', distance: 0, targetVelocity: 0 };
    let previousExit = 0;
    for (let i = 0; i < n; i += 1) {
      const accel = this.accelAt(i);
      block.kind = this.cut.get(i) === 1 ? 'cut' : 'travel';
      block.distance = this.distance.get(i);
      block.targetVelocity = this.targetVelocity.get(i);
      // backwardPass left this block's exit at the next block's entry.
      const backwardExit = i === n - 1 ? 0 : this.entryV.get(i + 1);
      const entry = i === 0 ? 0 : previousExit;
      const entryV = Math.min(this.entryV.get(i), entry, block.targetVelocity);
      const maxExit = Math.sqrt(entryV ** 2 + 2 * accel * block.distance);
      const exitV = Math.min(backwardExit, maxExit, block.targetVelocity);
      this.entryV.set(i, entryV);
      previousExit = exitV;
      visit(i, block, entryV, exitV, accel);
    }
  }
}

function isPlannerWindow(plannerBlocks: number | undefined): plannerBlocks is number {
  return plannerBlocks !== undefined && Number.isInteger(plannerBlocks) && plannerBlocks >= 1;
}

type CapWindowEntry = (index: number, roomMm: number) => void;

// The running sums planVelocities keeps in distanceBefore, where
// distanceBefore[k] is the distance of blocks 0..k-1. Entry i (from 1) is
// capped by the room to stop from distanceBefore[i] to
// distanceBefore[min(n, i + stoppingBlocks)], so only the last
// stoppingBlocks + 2 sums are ever read again (the one before entry i, while
// a one-block planner caps entry i as block i arrives). The ring grows to
// that size before it first wraps, so a huge planner costs only what a span
// uses.
class PlannerWindow {
  private ring = new Float64Array(2);
  private readonly ringLength: number;
  private sumCount = 1; // distanceBefore[0] = 0 is in ring[0].
  private nextEntry = 1;

  constructor(private readonly stoppingBlocks: number) {
    this.ringLength = stoppingBlocks + 2;
  }

  /** Block `index`'s distance, once its junction cap is set. */
  add(distance: number, index: number, cap: CapWindowEntry): void {
    const k = this.sumCount;
    if (k >= this.ring.length && this.ring.length < this.ringLength) {
      const grown = new Float64Array(Math.min(this.ringLength, this.ring.length * 2));
      grown.set(this.ring);
      this.ring = grown;
    }
    this.ring[k % this.ring.length] = this.sumAt(k - 1) + distance;
    this.sumCount += 1;
    while (this.nextEntry <= index && this.nextEntry + this.stoppingBlocks <= k) {
      this.capNext(this.nextEntry + this.stoppingBlocks, cap);
    }
  }

  /** The entries whose window reaches past the last block. */
  finish(cap: CapWindowEntry): void {
    const n = this.sumCount - 1;
    while (this.nextEntry < n) this.capNext(n, cap);
  }

  private capNext(windowEnd: number, cap: CapWindowEntry): void {
    const i = this.nextEntry;
    cap(i, Math.max(0, this.sumAt(windowEnd) - this.sumAt(i)));
    this.nextEntry += 1;
  }

  private sumAt(k: number): number {
    return this.ring[k % this.ring.length] ?? 0;
  }
}
