// Moshi job encoder (ADR-705): a prepared machine-space Job becomes the list
// of programs a Moshiboard runs one after another. Each Line or Fill group is
// one vector program (a speed change ends a program in MeerK40t too:
// driver.py `plot_start` L304-313 calls `rapid_mode`, which commits). Each
// Image group is one raster program followed by MeerK40t's home program,
// because "Finished is required between rasters since it's an absolute home"
// (driver.py `finished_mode` L521-539). Deterministic: the same Job and
// profile give the same bytes. Coordinates are absolute from the board's
// home corner: a Moshi program has no relative placement.
//
// STATUS HONESTY: simulator-tested only, not qualified on hardware. Bytes
// follow MeerK40t's builder; no Moshiboard has run them.

import type { DeviceProfile } from '../../devices';
import type { Group, Job } from '../../job';
import { rotaryFeedMatchFor, type RotaryFeedMatch } from '../../output/rotary-surface-feed';
import { MOSHI_VECTOR_SPEED_MAX_MM_S } from './moshi-program';
import { writeHomeProgram, writeRasterProgram, writeVectorProgram } from './moshi-programs';
import { planRasterGroupSteps } from './moshi-raster-plan';
import { moshiSurfaceSpeedRuns } from './moshi-rotary-feed';
import {
  isMoshiPosition,
  milsToMm,
  MOSHI_MAX_POSITION_MILS,
  stepBounds,
  unionMoshiBounds,
  type MoshiBounds,
  type MoshiStep,
} from './moshi-units';
import { planFillGroupSteps } from './moshi-fill-plan';
import { planCutGroupSteps } from './moshi-vector-plan';

/** Raster speed is one byte of cm/s (builder.py L408-411). */
const MOSHI_RASTER_SPEED_MAX_MM_S = 2560;

export type MoshiJobProgram = {
  readonly kind: 'vector' | 'raster' | 'home';
  readonly layerId: string;
  readonly bytes: Uint8Array;
};

/** One group's planned moves, for the post-compile checks. */
export type MoshiMotionPart = {
  readonly group: Exclude<Group, { readonly kind: 'cnc' }>;
  readonly steps: ReadonlyArray<MoshiStep>;
  readonly bounds: MoshiBounds;
};

export type MoshiEncodeError =
  | { readonly kind: 'empty-job' }
  | { readonly kind: 'cnc-unsupported'; readonly layerId: string }
  | { readonly kind: 'angled-raster-unsupported'; readonly layerId: string }
  | {
      readonly kind: 'coordinate-out-of-range';
      readonly layerId: string;
      readonly xMm: number;
      readonly yMm: number;
    };

export type MoshiEncodeResult =
  | {
      readonly ok: true;
      readonly programs: ReadonlyArray<MoshiJobProgram>;
      readonly motion: ReadonlyArray<MoshiMotionPart>;
      /** Where the job runs: the union of every planned move, in mils. */
      readonly footprint: MoshiBounds;
      readonly notes: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly error: MoshiEncodeError };

export function encodeMoshiJob(job: Job, device: DeviceProfile): MoshiEncodeResult {
  // A Y-port rotary needs the surface speed matched per move (ADR-705 Amd 1).
  const rotaryFeed = rotaryFeedMatchFor(job, device.maxFeed);
  const programs: MoshiJobProgram[] = [];
  const motion: MoshiMotionPart[] = [];
  const notes = new Set<string>();
  for (const group of job.groups) {
    if (group.kind === 'cnc')
      return { ok: false, error: { kind: 'cnc-unsupported', layerId: group.layerId } };
    if (group.kind === 'raster' && group.scanAngleDeg !== undefined)
      return { ok: false, error: { kind: 'angled-raster-unsupported', layerId: group.layerId } };
    const planned = planGroup(group, device, notes);
    const bounds = stepBounds(planned);
    if (bounds === null) continue;
    const outside = planned.find((step) => !isMoshiPosition(step.x) || !isMoshiPosition(step.y));
    if (outside !== undefined) return { ok: false, error: outOfRange(group.layerId, outside) };
    motion.push({ group, steps: planned, bounds });
    programs.push(...groupPrograms(group, planned, bounds, notes, rotaryFeed));
  }
  const footprint = unionMoshiBounds(motion.map((part) => part.bounds));
  if (footprint === null || !motion.some((part) => part.steps.some((step) => step.cut)))
    return { ok: false, error: { kind: 'empty-job' } };
  return { ok: true, programs, motion, footprint, notes: [...notes] };
}

function planGroup(
  group: Exclude<Group, { readonly kind: 'cnc' }>,
  device: DeviceProfile,
  notes: Set<string>,
): MoshiStep[] {
  if (group.kind === 'cut') return planCutGroupSteps(group);
  if (group.kind === 'fill') return planFillGroupSteps(group, device);
  const raster = planRasterGroupSteps(group, device);
  if (raster.greyLevels)
    notes.add(
      `Layer ${group.layerId}: a Moshiboard has no power control, so every grey pixel burns at the machine's dial power. Dither the image for shading.`,
    );
  return [...raster.steps];
}

function groupPrograms(
  group: Exclude<Group, { readonly kind: 'cnc' }>,
  steps: ReadonlyArray<MoshiStep>,
  bounds: MoshiBounds,
  notes: Set<string>,
  rotaryFeed: RotaryFeedMatch | undefined,
): MoshiJobProgram[] {
  const speedMmS = group.speed / 60;
  if (group.kind !== 'raster' && rotaryFeed !== undefined)
    return rotaryVectorPrograms(group, steps, rotaryFeed, notes);
  if (group.kind !== 'raster') {
    if (speedMmS > MOSHI_VECTOR_SPEED_MAX_MM_S)
      notes.add(
        `Layer ${group.layerId}: ${Math.round(speedMmS)} mm/s is above the Moshi vector limit; it runs at ${MOSHI_VECTOR_SPEED_MAX_MM_S} mm/s.`,
      );
    return [{ kind: 'vector', layerId: group.layerId, bytes: writeVectorProgram(steps, speedMmS) }];
  }
  if (speedMmS > MOSHI_RASTER_SPEED_MAX_MM_S)
    notes.add(
      `Layer ${group.layerId}: ${Math.round(speedMmS)} mm/s is above the Moshi raster limit; it runs at ${MOSHI_RASTER_SPEED_MAX_MM_S} mm/s.`,
    );
  return [
    {
      kind: 'raster',
      layerId: group.layerId,
      bytes: writeRasterProgram(steps, Math.min(speedMmS, MOSHI_RASTER_SPEED_MAX_MM_S), bounds),
    },
    { kind: 'home', layerId: group.layerId, bytes: writeHomeProgram() },
  ];
}

/** One program per run of moves that share a surface-matched speed. */
function rotaryVectorPrograms(
  group: Exclude<Group, { readonly kind: 'cnc' | 'raster' }>,
  steps: ReadonlyArray<MoshiStep>,
  rotaryFeed: RotaryFeedMatch,
  notes: Set<string>,
): MoshiJobProgram[] {
  const { runs, minDose, maxDose } = moshiSurfaceSpeedRuns(steps, group.speed, rotaryFeed);
  if (runs.length > 1)
    notes.add(
      `Layer ${group.layerId}: on the rotary it runs as ${runs.length} programs, one per surface speed, so the head pauses between them.`,
    );
  if (minDose < 0.95 || maxDose > 1.05)
    notes.add(
      `Layer ${group.layerId}: on the rotary, strokes burn between ${percent(minDose)} and ${percent(maxDose)} of the set dose: a Moshiboard runs whole mm/s from 1 to ${MOSHI_VECTOR_SPEED_MAX_MM_S}, within Max feed.`,
    );
  return runs.map((run) => ({
    kind: 'vector',
    layerId: group.layerId,
    bytes: writeVectorProgram(run.steps, run.speedMmS),
  }));
}

function percent(share: number): string {
  return `${Math.round(share * 100)} %`;
}

function outOfRange(layerId: string, step: MoshiStep): MoshiEncodeError {
  return {
    kind: 'coordinate-out-of-range',
    layerId,
    xMm: milsToMm(step.x),
    yMm: milsToMm(step.y),
  };
}

export function describeMoshiEncodeError(error: MoshiEncodeError): string {
  switch (error.kind) {
    case 'empty-job':
      return 'Nothing to run — enable Output on at least one layer with geometry and power above 0.';
    case 'cnc-unsupported':
      return 'A CNC router job cannot run on a Moshiboard laser controller. Switch the project to Laser mode.';
    case 'angled-raster-unsupported':
      return `Layer ${error.layerId} scans at an angle. A Moshiboard rasters along X only; set the scan angle to 0.`;
    case 'coordinate-out-of-range':
      return `Layer ${error.layerId} reaches X ${error.xMm.toFixed(1)} Y ${error.yMm.toFixed(1)} mm, outside the Moshiboard's range of 0 to ${milsToMm(MOSHI_MAX_POSITION_MILS).toFixed(0)} mm from its home corner. Nothing was sent.`;
  }
}
