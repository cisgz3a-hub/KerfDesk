import type { DeviceProfile } from '../devices';
import { buildProgramTimeline, type ProgramTimeline } from '../gcode-time';
import { deviceProgramTimingOptions } from '../gcode-time/program-timing-options';
import { cncGrblStrategy, selectOutputStrategy } from '../output';
import type { Vec2 } from '../scene';
import type { Job } from './job';

export { formatDuration } from './format-duration';

export type JobDurationBreakdown = {
  readonly cutSeconds: number;
  readonly travelSeconds: number;
  readonly rapidTravelSeconds?: number;
  readonly feedTravelSeconds?: number;
  /** Fixed emitted G4 timing; cut/travel calibration never scales this. */
  readonly dwellSeconds?: number;
  /** Serial delivery time which cannot overlap earlier motion or dwell. */
  readonly transportSeconds?: number;
};

export type JobDurationEstimate = {
  readonly totalSeconds: number;
  readonly breakdown: JobDurationBreakdown;
  readonly unavailableReason?: string;
  /** Operator time at manual tool changes is not predictable. */
  readonly manualPauseCount?: number;
};

export type JobDurationEstimateOptions = {
  readonly initialPosition?: Vec2 & { readonly z?: number };
  readonly finishPosition?: Vec2 | null;
  /** Review can reuse the exact program and clock prepared for Start. */
  readonly gcode?: string;
  readonly timeline?: ProgramTimeline;
};

/** Estimates the emitted moves, including rounding, pecks, arcs, Z and waits. */
export function estimateJobDuration(
  job: Job,
  device: DeviceProfile,
  options: JobDurationEstimateOptions = {},
): JobDurationEstimate {
  if (options.timeline !== undefined) return durationFromTimeline(options.timeline);
  if (job.groups.length === 0 && options.gcode === undefined) return emptyDuration();
  try {
    return estimateEmittedJob(job, device, options);
  } catch (error) {
    return {
      ...emptyDuration(),
      unavailableReason: error instanceof Error ? error.message : String(error),
    };
  }
}

function estimateEmittedJob(
  job: Job,
  device: DeviceProfile,
  options: JobDurationEstimateOptions,
): JobDurationEstimate {
  const machineKind = job.groups.some((group) => group.kind === 'cnc') ? 'cnc' : 'laser';
  const strategy = machineKind === 'cnc' ? cncGrblStrategy : selectOutputStrategy(device);
  const gcode =
    options.gcode ??
    strategy.emit(
      job,
      device,
      options.finishPosition === undefined ? {} : { finishPosition: options.finishPosition },
    );
  if (gcode.trim() === '') return emptyDuration();
  const result = buildProgramTimeline(
    gcode,
    {
      accelMmPerSec2: device.accelMmPerSec2,
      junctionDeviationMm: device.junctionDeviationMm,
      maxFeedMmPerMin: device.maxFeed,
    },
    {
      ...deviceProgramTimingOptions(device, machineKind),
      initialPositionMm: initialPosition(options),
    },
  );
  return result.kind === 'ok'
    ? durationFromTimeline(result.timeline)
    : { ...emptyDuration(), unavailableReason: result.reason };
}

function initialPosition(options: JobDurationEstimateOptions) {
  return {
    x: options.initialPosition?.x ?? 0,
    y: options.initialPosition?.y ?? 0,
    z: options.initialPosition?.z ?? 0,
  };
}

function durationFromTimeline(timeline: ProgramTimeline): JobDurationEstimate {
  const { cutSeconds, rapidTravelSeconds, feedTravelSeconds } = timeline.breakdown;
  return {
    totalSeconds: timeline.totalSeconds,
    breakdown: {
      cutSeconds,
      travelSeconds: rapidTravelSeconds + feedTravelSeconds,
      rapidTravelSeconds,
      feedTravelSeconds,
      dwellSeconds: timeline.dwellSeconds,
      transportSeconds: timeline.transportSeconds,
    },
    ...(timeline.pauseBarriers.length === 0
      ? {}
      : { manualPauseCount: timeline.pauseBarriers.length }),
  };
}

function emptyDuration(): JobDurationEstimate {
  return {
    totalSeconds: 0,
    breakdown: {
      cutSeconds: 0,
      travelSeconds: 0,
      rapidTravelSeconds: 0,
      feedTravelSeconds: 0,
      dwellSeconds: 0,
      transportSeconds: 0,
    },
  };
}
