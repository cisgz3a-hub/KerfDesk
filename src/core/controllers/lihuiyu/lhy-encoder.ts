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
};

export type LhyEncodeResult =
  | {
      readonly ok: true;
      readonly stream: Uint8Array;
      readonly motion: ReadonlyArray<LhyMotionPart>;
      /** Layers left out because their power is 0 %. */
      readonly zeroPowerLayers: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly error: LhyEncodeError };

export function encodeLhyJob(job: Job, options: LhyEncodeOptions): LhyEncodeResult {
  const planned = planLhyJob(job);
  if (!planned.ok) return planned;
  if (planned.motion.length === 0) return { ok: false, error: { kind: 'empty-job' } };
  const writer = new LhyWriter(options.start ?? { x: 0, y: 0 });
  let power: number | null = null;
  for (const part of planned.motion) {
    if (options.board.pwm) {
      const perMille = pwmPerMille(part.group.power, options.fullPowerPerMille);
      if (perMille !== power) writer.pwmPower(perMille);
      power = perMille;
    }
    writePart(
      writer,
      part,
      lhySpeedCode(part.group.speed / 60, { ...options.board, suffixC: true }),
    );
  }
  writer.leaveProgram();
  const start = options.start ?? { x: 0, y: 0 };
  writer.rapidMove(start.x - writer.x, start.y - writer.y);
  return {
    ok: true,
    stream: writer.stream(),
    motion: planned.motion,
    zeroPowerLayers: planned.zeroPowerLayers,
  };
}

type Planned =
  | {
      readonly ok: true;
      readonly motion: ReadonlyArray<LhyMotionPart>;
      readonly zeroPowerLayers: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly error: LhyEncodeError };

function planLhyJob(job: Job): Planned {
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
    const part = planLhyPart(laser, motion.length);
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

function writePart(writer: LhyWriter, part: LhyMotionPart, speedCode: string): void {
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
    writer.enterProgram(speedCode, directionsFor(dx, dy));
    writer.programMove(dx, dy, step.burn);
  });
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
