// ADR-127 Amendment 7 (code quality audit C2 verify E1-P2-2): on a Ruida rotary
// the job runs as the .rd file's route, which burns strokes in speed-class
// parts with laser-off moves between them, so the Time tile and Job Review
// time that route instead of the G-code emission. Both estimate sites go
// through here so they cannot differ.

import type { DeviceProfile } from '../../core/devices';
import { ruidaRotaryTimingProgram } from '../../core/controllers/ruida/rd-rotary-timing';
import type { Job } from '../../core/job';
import type { JobDurationEstimateOptions } from '../../core/job/estimate-duration';

/** `options`, timing the .rd route when `job` is a Ruida rotary job. A
 *  supplied program or timeline is G-code the .rd does not run, and the route
 *  is no program a preview can reuse, so both give way to it. */
export function withRuidaRotaryRoute<T extends JobDurationEstimateOptions>(
  job: Job,
  device: DeviceProfile,
  options: T,
): T {
  const route = ruidaRotaryTimingProgram(job, device);
  if (route === undefined) return options;
  const { timeline: _timeline, onEmittedProgram: _onEmitted, ...rest } = options;
  return { ...rest, gcode: route } as T;
}
