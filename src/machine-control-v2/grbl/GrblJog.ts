import type { ControllerProfile } from '../ControllerProfile';
import type { Axis } from '../MachineIntent';

export interface PlannedJog {
  readonly accepted: boolean;
  readonly command: string;
  readonly reason?: string;
  readonly parserStateIndependent: boolean;
}

export function planGrblJog(args: {
  profile: ControllerProfile;
  axis: Axis;
  distanceMm: number;
  feedMmPerMin: number;
  absolute: boolean;
}): PlannedJog {
  const { profile, axis, distanceMm, feedMmPerMin, absolute } = args;

  if (!Number.isFinite(distanceMm) || distanceMm === 0) {
    return rejected('Jog distance must be non-zero.');
  }
  if (!Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) {
    return rejected('Jog feed must be positive.');
  }

  const maxFeed = profile.maxFeedMmPerMin[axis];
  if (maxFeed !== null && feedMmPerMin > maxFeed) {
    return rejected(`Jog feed exceeds ${axis} maximum.`);
  }

  const travel = profile.travelMm[axis];
  if (
    !absolute &&
    profile.softLimitsEnabled &&
    travel !== null &&
    Math.abs(distanceMm) > travel
  ) {
    return rejected(`Jog exceeds ${axis} travel.`);
  }

  const mode = absolute ? 'G90' : 'G91';

  return {
    accepted: true,
    command: `$J=${mode} G21 ${axis}${formatNumber(distanceMm)} F${formatNumber(feedMmPerMin)}`,
    parserStateIndependent: true,
  };
}

function rejected(reason: string): PlannedJog {
  return {
    accepted: false,
    command: '',
    reason,
    parserStateIndependent: true,
  };
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
