// LHYMicro-GL job encoder (ADR-703): the command stream for a Lihuiyu
// M2/M3 Nano (stock K40) board, from the prepared job. Every move is relative
// to the head, so the stream starts where the head stands: `start` is that
// point in the job's coordinates (machine zero after Home for an Absolute job,
// the job's own zero otherwise). The stream ends with a rapid move back to
// that point, so the head finishes where it started and a Frame of the same
// footprint stays true for the next run. Deterministic: the same job and
// options give the same bytes.
//
// STATUS HONESTY: the grammar follows MeerK40t's MIT driver (see the module
// notes in lhy-writer.ts and lhy-speed-code.ts); the stream round-trips
// through this repo's decoder and simulator only. It is simulator-tested only
// and NOT qualified on hardware.

import type { LihuiyuBoardId } from '../../devices/device-profile';
import type { Job } from '../../job';
import type { ScanOffsetPoint } from '../../devices/scan-offset-profile';
import type { RotaryFeedMatch } from '../../output/rotary-surface-feed';
import {
  lhyLayerBurnSpeed,
  lhyRotaryBurnSpeed,
  lhySlowestMmPerSec,
  type LhyBurnSpeed,
} from './lhy-burn-speed';
import { planLhyPart, type LhyGroup, type LhyMotionPart, type LhyPoint } from './lhy-motion-plan';
import { lhySpeedCode, type LihuiyuBoard } from './lhy-speed-code';
import { LhyWriter, type LhyDirections } from './lhy-writer';

export type LhyBoardSetting = { readonly board: LihuiyuBoard; readonly pwm: boolean };

/** The board a device profile names; absent or unknown is the stock M2 Nano. */
export function lhyBoardSetting(id: LihuiyuBoardId | undefined): LhyBoardSetting {
  if (id === 'M3-pwm') return { board: 'M3', pwm: true };
  return { board: id ?? 'M2', pwm: false };
}

export type LhyEncodeError =
  | { readonly kind: 'empty-job' }
  | { readonly kind: 'cnc-unsupported'; readonly layerId: string }
  | { readonly kind: 'angled-raster-unsupported'; readonly layerId: string }
  | { readonly kind: 'speed-out-of-range'; readonly layerId: string; readonly mmPerMin: number };

export type LhyEncodeOptions = {
  readonly board: LhyBoardSetting;
  /** Full power for an M3 with hardware PWM, in per mille (the profile's maxPowerS). */
  readonly fullPowerPerMille: number;
  readonly start?: LhyPoint;
  /** The machine's bidirectional scan-offset table (Fill and Image rows). */
  readonly scanningOffsets?: ReadonlyArray<ScanOffsetPoint>;
  /** A Y-port rotary's surface-speed match (ADR-127 Amd 2; ADR-703 Amd 1). */
  readonly rotaryFeed?: RotaryFeedMatch;
};

export type LhyEncodeResult =
  | {
      readonly ok: true;
      readonly stream: Uint8Array;
      readonly motion: ReadonlyArray<LhyMotionPart>;
      /** Layers left out because their power is 0 %. */
      readonly zeroPowerLayers: ReadonlyArray<string>;
      /** On a rotary: speed changes per layer, each a stop of the head. */
      readonly rotarySpeedChanges: ReadonlyArray<{
        readonly layerId: string;
        readonly count: number;
      }>;
      /** Per layer: the lowest and highest dose its burns get (ADR-703 Amd 2). */
      readonly layerDoses: ReadonlyArray<LhyLayerDose>;
      /** The board's slowest speed, in mm/s; a slower burn runs at it. */
      readonly slowestMmPerSec: number;
    }
  | { readonly ok: false; readonly error: LhyEncodeError };

export type LhyLayerDose = {
  readonly layerId: string;
  readonly minDose: number;
  readonly maxDose: number;
  readonly rotary: boolean;
};

export function encodeLhyJob(job: Job, options: LhyEncodeOptions): LhyEncodeResult {
  const planned = planLhyJob(job, options.scanningOffsets ?? []);
  if (!planned.ok) return planned;
  if (planned.motion.length === 0) return { ok: false, error: { kind: 'empty-job' } };
  const writer = new LhyWriter(options.start ?? { x: 0, y: 0 });
  let power: number | null = null;
  const rotarySpeedChanges: Array<{ readonly layerId: string; readonly count: number }> = [];
  const doses = new Map<string, LhyLayerDose>();
  const slowestMmPerSec = lhySlowestMmPerSec(options.board.board, true);
  const speedCode = (mmPerSec: number): string =>
    lhySpeedCode(mmPerSec, { ...options.board, suffixC: true });
  for (const part of planned.motion) {
    if (options.board.pwm) {
      const perMille = pwmPerMille(part.group.power, options.fullPowerPerMille);
      if (perMille !== power) writer.pwmPower(perMille);
      power = perMille;
    }
    const burnSpeed = burnSpeedFor(part, options.rotaryFeed, slowestMmPerSec);
    const written = writePart(writer, part, speedCode, burnSpeed);
    const layerId = part.group.layerId;
    if (written.changes > 0) rotarySpeedChanges.push({ layerId, count: written.changes });
    addLayerDose(doses, layerId, written, options.rotaryFeed !== undefined);
  }
  writer.leaveProgram();
  const start = options.start ?? { x: 0, y: 0 };
  writer.rapidMove(start.x - writer.x, start.y - writer.y);
  return {
    ok: true,
    stream: writer.stream(),
    motion: planned.motion,
    zeroPowerLayers: planned.zeroPowerLayers,
    rotarySpeedChanges,
    layerDoses: [...doses.values()],
    slowestMmPerSec,
  };
}

type Planned =
  | {
      readonly ok: true;
      readonly motion: ReadonlyArray<LhyMotionPart>;
      readonly zeroPowerLayers: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly error: LhyEncodeError };

function planLhyJob(job: Job, scanningOffsets: ReadonlyArray<ScanOffsetPoint>): Planned {
  const motion: LhyMotionPart[] = [];
  const zeroPowerLayers: string[] = [];
  for (const group of job.groups) {
    const refusal = groupRefusal(group);
    if (refusal !== null) return { ok: false, error: refusal };
    const laser = group as LhyGroup;
    if (!(laser.power > 0)) {
      if (!zeroPowerLayers.includes(laser.layerId)) zeroPowerLayers.push(laser.layerId);
      continue;
    }
    const part = planLhyPart(laser, motion.length, scanningOffsets);
    if (part !== null) motion.push(part);
  }
  return { ok: true, motion, zeroPowerLayers };
}

function groupRefusal(group: Job['groups'][number]): LhyEncodeError | null {
  if (group.kind === 'cnc') return { kind: 'cnc-unsupported', layerId: group.layerId };
  if (group.kind === 'raster' && group.scanAngleDeg !== undefined) {
    return { kind: 'angled-raster-unsupported', layerId: group.layerId };
  }
  if (!(group.speed > 0) || !Number.isFinite(group.speed)) {
    return { kind: 'speed-out-of-range', layerId: group.layerId, mmPerMin: group.speed };
  }
  return null;
}

type BurnSpeedFor = (from: LhyPoint, to: LhyPoint) => LhyBurnSpeed;

/** How fast each burn of a part runs: the layer speed on a flat bed, or the
 *  surface-matched class on a rotary, held at the board's slowest speed. */
function burnSpeedFor(
  part: LhyMotionPart,
  rotaryFeed: RotaryFeedMatch | undefined,
  slowestMmPerSec: number,
): BurnSpeedFor {
  const layer = lhyLayerBurnSpeed(part.group.speed, slowestMmPerSec);
  if (rotaryFeed === undefined) return () => layer;
  return (from, to) => lhyRotaryBurnSpeed(part.group.speed, from, to, rotaryFeed, slowestMmPerSec);
}

type WrittenPart = { readonly changes: number; readonly minDose: number; readonly maxDose: number };

/** Widens a layer's dose range by one written part (a layer may have several). */
function addLayerDose(
  doses: Map<string, LhyLayerDose>,
  layerId: string,
  written: WrittenPart,
  rotary: boolean,
): void {
  const seen = doses.get(layerId);
  doses.set(layerId, {
    layerId,
    minDose: Math.min(written.minDose, seen?.minDose ?? Number.POSITIVE_INFINITY),
    maxDose: Math.max(written.maxDose, seen?.maxDose ?? 0),
    rotary,
  });
}

/** Writes one part's moves. A burn whose speed differs from the last one
 *  re-enters program mode, which stops the head; on a rotary those changes are
 *  counted. Returns them with the dose range the part's burns get. */
function writePart(
  writer: LhyWriter,
  part: LhyMotionPart,
  speedCode: (mmPerSec: number) => string,
  burnSpeed: BurnSpeedFor,
): WrittenPart {
  let code = speedCode(lhyLayerBurnSpeed(part.group.speed, 0).runsMmPerSec);
  let changes = 0;
  let minDose = Number.POSITIVE_INFINITY;
  let maxDose = 0;
  part.steps.forEach((step, index) => {
    const dx = step.x - writer.x;
    const dy = step.y - writer.y;
    if (dx === 0 && dy === 0) return;
    // A part's first travel always runs in rapid mode; Line parts travel
    // that way throughout, Fill and Image parts cross gaps in program mode.
    if (!step.burn && (part.travel === 'rapid' || index === 0)) {
      writer.rapidMove(dx, dy);
      return;
    }
    if (step.burn) {
      const speed = burnSpeed(writer, step);
      minDose = Math.min(minDose, speed.dose);
      maxDose = Math.max(maxDose, speed.dose);
      const next = speedCode(speed.runsMmPerSec);
      if (next !== code && writer.inProgram) changes += 1;
      code = next;
    }
    writer.enterProgram(code, directionsFor(dx, dy));
    writer.programMove(dx, dy, step.burn);
  });
  return { changes, minDose: Number.isFinite(minDose) ? minDose : 1, maxDose: maxDose || 1 };
}

/** The directions declared on entering program mode: those of the first move,
 *  so the board starts already heading that way. */
export function directionsFor(dx: number, dy: number): LhyDirections {
  return { leftward: dx < 0, topward: dy < 0, horizontalMajor: Math.abs(dx) >= Math.abs(dy) };
}

function pwmPerMille(powerPercent: number, fullPowerPerMille: number): number {
  const full = Math.min(1000, Math.max(0, fullPowerPerMille));
  return Math.round((Math.min(100, Math.max(0, powerPercent)) / 100) * full);
}
