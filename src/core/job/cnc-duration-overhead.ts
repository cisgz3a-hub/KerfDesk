import {
  formatCncCoordinateMm,
  representedCncCoordinateMm,
} from '../cnc/coordinate-representation';
import { cncPassCanEmit } from '../cnc/output-representation';
import { cncSpindleTransition, type CncSpindleState } from '../cnc/spindle-transition';
import type { DeviceProfile } from '../devices';
import { effectiveGcodeFeedMmPerMin } from '../gcode/feed-word';
import { cncPassEntryDepthMm, type CncGroup, type Job } from './job';

const SECONDS_PER_MINUTE = 60;

export function cncDurationOverhead(
  job: Job,
  device: DeviceProfile,
): {
  readonly plungeSeconds: number;
  readonly retractSeconds: number;
  readonly dwellSeconds: number;
} {
  const groups = job.groups.filter((group): group is CncGroup => group.kind === 'cnc');
  let plungeSeconds = 0;
  let retractSeconds = 0;
  for (const group of groups) {
    const plungeFeed = effectiveGcodeFeedMmPerMin(group.plungeMmPerMin);
    const retractFeed = Math.max(1, device.maxFeed);
    const safeZMm = representedCncCoordinateMm(Math.max(0, group.safeZMm));
    for (const pass of group.passes) {
      if (!cncPassCanEmit(pass)) continue;
      const travelZMm = safeZMm + Math.abs(cncPassEntryDepthMm(pass));
      plungeSeconds += (travelZMm / plungeFeed) * SECONDS_PER_MINUTE;
      retractSeconds += (travelZMm / retractFeed) * SECONDS_PER_MINUTE;
    }
  }
  return { plungeSeconds, retractSeconds, dwellSeconds: spindleDwellSeconds(groups) };
}

function spindleDwellSeconds(groups: ReadonlyArray<CncGroup>): number {
  const first = groups[0];
  if (first === undefined) return 0;
  const state: CncSpindleState = {
    isMultiTool: new Set(groups.map((group) => group.toolId ?? '')).size > 1,
    currentRpm: first.spindleRpm,
    currentToolKey: first.toolId ?? '',
  };
  let seconds = representedDwellSeconds(first.spindleSpinupSec);
  for (const group of groups) {
    const transition = cncSpindleTransition(group, state);
    if (transition === 'none') continue;
    seconds += representedDwellSeconds(group.spindleSpinupSec);
    state.currentRpm = group.spindleRpm;
    if (transition === 'tool-change') state.currentToolKey = group.toolId ?? '';
  }
  return seconds;
}

function representedDwellSeconds(seconds: number): number {
  // appendSpindleStart writes G4 P using this exact decimal representation.
  // Zero/negative delays emit no dwell; manual M0 tool-change time is unknown.
  return seconds > 0 ? Number(formatCncCoordinateMm(seconds)) : 0;
}
