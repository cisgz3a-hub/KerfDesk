import type { StatusReport } from '../core/controllers/grbl';
import type { DeviceProfile } from '../core/devices';
import type { JobOriginPlacement, JobPlacementSettings, JobStartMode } from '../core/job';
import type { MotionBoundsOffset } from '../core/invariants';
import { hasCustomXyOrigin, type WorkCoordinateOffset } from './state/origin-actions';

export type { JobPlacementSettings };

export const DEFAULT_JOB_PLACEMENT: JobPlacementSettings = {
  startFrom: 'absolute',
  anchor: 'front-left',
};

export function defaultJobPlacementForDevice(
  device: Pick<DeviceProfile, 'homing'>,
): JobPlacementSettings {
  return {
    ...DEFAULT_JOB_PLACEMENT,
    startFrom: device.homing.enabled ? 'absolute' : 'current-position',
  };
}

export function jobPlacementAfterDeviceChange(
  current: JobPlacementSettings,
  previousDevice: Pick<DeviceProfile, 'homing'>,
  nextDevice: Pick<DeviceProfile, 'homing'>,
): JobPlacementSettings {
  const previousDefault = defaultJobPlacementForDevice(previousDevice).startFrom;
  if (current.startFrom !== previousDefault) return current;
  return {
    ...current,
    startFrom: defaultJobPlacementForDevice(nextDevice).startFrom,
  };
}

export type MachinePlacementSnapshot = {
  readonly statusReport: StatusReport | null;
  readonly workOriginActive?: boolean;
  readonly wcoCache?: WorkCoordinateOffset | null;
};

export type ResolvedJobPlacement =
  | {
      readonly ok: true;
      readonly jobOrigin?: JobOriginPlacement;
      readonly preflightMotionOffset?: MotionBoundsOffset;
    }
  | {
      readonly ok: false;
      readonly messages: ReadonlyArray<string>;
    };

type Axis3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

const ZERO_WCO: Axis3 = { x: 0, y: 0, z: 0 };

export function resolveJobPlacement(
  settings: JobPlacementSettings,
  machine: MachinePlacementSnapshot,
): ResolvedJobPlacement {
  switch (settings.startFrom) {
    case 'absolute':
      return resolveAbsolute(machine);
    case 'current-position':
      return resolveCurrentPosition(settings, machine);
    case 'user-origin':
      return resolveUserOrigin(settings, machine);
    case 'verified-origin':
      return resolveVerifiedOrigin(settings, machine);
    default:
      return assertNeverStartMode(settings.startFrom);
  }
}

export function trustedMotionOffsetForPreflight(
  device: DeviceProfile,
  placement: Extract<ResolvedJobPlacement, { ok: true }>,
): MotionBoundsOffset | undefined {
  // Verified Origin is set by hand, so GRBL's machine position is fiction even
  // on a homing-capable machine — never trust an absolute offset for it, which
  // forces the size-only relative preflight regardless of homing (ADR-053).
  if (placement.jobOrigin?.startFrom === 'verified-origin') return undefined;
  if (!device.homing.enabled) return undefined;
  return placement.preflightMotionOffset;
}

function resolveAbsolute(machine: MachinePlacementSnapshot): ResolvedJobPlacement {
  if (!customOriginIsActive(machine)) return { ok: true };
  return {
    ok: false,
    messages: [
      'Absolute Coordinates requires the custom work origin to be cleared. Reset origin first, or choose User Origin.',
    ],
  };
}

function resolveCurrentPosition(
  settings: JobPlacementSettings,
  machine: MachinePlacementSnapshot,
): ResolvedJobPlacement {
  const current = currentWorkPosition(machine);
  if (current === null) {
    return {
      ok: false,
      messages: [
        'Current Position needs a live machine position and work-coordinate offset. Wait for an Idle status report, or choose Absolute Coordinates.',
      ],
    };
  }
  return {
    ok: true,
    jobOrigin: {
      startFrom: 'current-position',
      anchor: settings.anchor,
      currentPosition: { x: current.work.x, y: current.work.y },
    },
    preflightMotionOffset: xyOffset(current.offset),
  };
}

function resolveUserOrigin(
  settings: JobPlacementSettings,
  machine: MachinePlacementSnapshot,
): ResolvedJobPlacement {
  const wco = knownWco(machine);
  if (!customOriginIsActive(machine)) {
    return {
      ok: false,
      messages: ['User Origin needs a custom work origin. Click "Set origin here" first.'],
    };
  }
  if (wco === null) {
    return {
      ok: false,
      messages: [
        'Custom origin is active, but its physical machine location is not known yet. Wait for an Idle/WCO status report or reset origin before continuing.',
      ],
    };
  }
  return {
    ok: true,
    jobOrigin: { startFrom: 'user-origin', anchor: settings.anchor },
    preflightMotionOffset: xyOffset(wco),
  };
}

function resolveVerifiedOrigin(
  settings: JobPlacementSettings,
  machine: MachinePlacementSnapshot,
): ResolvedJobPlacement {
  // Only a custom work origin is required — NOT a known WCO. Verified Origin
  // never uses an absolute offset (see trustedMotionOffsetForPreflight), so the
  // job is size-checked, not position-checked. Where on the bed the origin sits
  // is unknowable after a hand-set origin; the mandatory Verified Frame (P2) is
  // the physical bounds check that replaces it (ADR-053).
  if (!customOriginIsActive(machine)) {
    return {
      ok: false,
      messages: ['Verified Origin needs a custom work origin. Click "Set origin here" first.'],
    };
  }
  return {
    ok: true,
    jobOrigin: { startFrom: 'verified-origin', anchor: settings.anchor },
  };
}

function currentWorkPosition(
  machine: MachinePlacementSnapshot,
): { readonly work: Axis3; readonly offset: Axis3 } | null {
  const report = machine.statusReport;
  if (report === null) return null;
  const wco = knownWco(machine);
  if (report.wPos !== null) {
    const offset =
      report.mPos !== null ? subtractAxis(report.mPos, report.wPos) : (wco ?? defaultWco(machine));
    if (offset === null) return null;
    return { work: report.wPos, offset };
  }
  if (report.mPos === null) return null;
  const offset = wco ?? defaultWco(machine);
  if (offset === null) return null;
  return { work: subtractAxis(report.mPos, offset), offset };
}

function knownWco(machine: MachinePlacementSnapshot): Axis3 | null {
  return machine.wcoCache ?? machine.statusReport?.wco ?? null;
}

function defaultWco(machine: MachinePlacementSnapshot): Axis3 | null {
  return machine.workOriginActive === true ? null : ZERO_WCO;
}

function customOriginIsActive(machine: MachinePlacementSnapshot): boolean {
  return machine.workOriginActive === true || hasCustomXyOrigin(knownWco(machine));
}

function xyOffset(offset: Axis3): MotionBoundsOffset {
  return { x: offset.x, y: offset.y };
}

function subtractAxis(a: Axis3, b: Axis3): Axis3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function assertNeverStartMode(mode: never): never {
  throw new Error(`Unhandled job start mode: ${String(mode as JobStartMode)}`);
}
