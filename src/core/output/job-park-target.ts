// resolveJobParkTarget — where a compiled Job's postamble park rapid will
// land, resolved with the SAME precedence the emitters use so review surfaces
// (the Job Review park disclosure) and emission can never disagree. The GRBL
// laser postamble consumes laserParkTarget directly, and the CNC branch reuses
// the emitter's own parkTarget on the same last-group selection the strategy
// walks; null means the program ends with no park move at all.

import { resolveGrblDialect, type DeviceProfile, type GrblGcodeDialect } from '../devices';
import type { Job } from '../job';
import type { MachineKind, Vec2 } from '../scene';
import { collectIndexedCncGroups } from './cnc-grbl-job-groups';
import { parkTarget } from './cnc-grbl-transitions';
import type { OutputEmitOptions } from './output-strategy';

/** The laser postamble's park point: an explicit finish position wins, else
 * the dialect's park-at-origin policy sends the head to work 0,0, else the
 * program simply stops where the last burn ended. */
export function laserParkTarget(
  dialect: GrblGcodeDialect,
  finishPosition: OutputEmitOptions['finishPosition'],
): Vec2 | null {
  return finishPosition ?? (dialect.parkAtOriginAfterJob ? { x: 0, y: 0 } : null);
}

/** Resolve the final park rapid's target for either machine kind. An empty
 * CNC job emits no program at all, so it has no park rapid either. */
export function resolveJobParkTarget(
  job: Job,
  device: DeviceProfile,
  machineKind: MachineKind,
  finishPosition: OutputEmitOptions['finishPosition'],
): Vec2 | null {
  if (machineKind === 'cnc') {
    const cncGroups = collectIndexedCncGroups(job);
    const last = cncGroups[cncGroups.length - 1];
    return last === undefined ? null : parkTarget(last.group, finishPosition);
  }
  return laserParkTarget(resolveGrblDialect(device), finishPosition);
}
