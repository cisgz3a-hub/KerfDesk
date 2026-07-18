import type { StatusReport } from '../core/controllers/grbl';
import type { DeviceProfile } from '../core/devices';
import type { JobOriginPlacement, JobPlacementSettings, JobStartMode } from '../core/job';
import type { MotionBoundsOffset } from '../core/invariants';
import { normalizeReportedMPosToMm } from '../core/controllers/grbl/machine-envelope';
import { hasCustomXyOrigin, type WorkCoordinateOffset } from './state/origin-actions';

export type { JobPlacementSettings };

export const DEFAULT_JOB_PLACEMENT: JobPlacementSettings = {
  startFrom: 'absolute',
  anchor: 'front-left',
};

// Exported so the blocked-Start fix offers can recognize these refusals
// exactly and offer Set origin here in place.
export const USER_ORIGIN_MISSING_MESSAGE =
  'User Origin needs a custom work origin. Click "Set origin here" first.';
export const VERIFIED_ORIGIN_MISSING_MESSAGE =
  'Verified Origin needs a custom work origin. Click "Set origin here" first.';

export function defaultJobPlacementForDevice(
  device: Pick<DeviceProfile, 'homing'>,
): JobPlacementSettings {
  // No-homing machines have no trusted machine position, so the default flow
  // is position the head, Set origin here, then Start — User Origin refuses to
  // start until an origin exists. Current Position stays selectable through the
  // guide for one-off head-relative jobs (ADR-193, 2026-07-16 amendment).
  return {
    ...DEFAULT_JOB_PLACEMENT,
    startFrom: device.homing.enabled ? 'absolute' : 'user-origin',
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

export function jobPlacementAfterProfileSelection(
  current: JobPlacementSettings,
  previousDevice: Pick<DeviceProfile, 'homing'>,
  nextDevice: Pick<DeviceProfile, 'homing'>,
): JobPlacementSettings {
  // A full profile selection establishes a new physical machine context.
  // Never carry the head-relative Current Position mode onto a homing-capable
  // machine implicitly; the operator may still choose it again deliberately.
  // User/Verified Origin are explicit setup workflows, so preserve them.
  if (nextDevice.homing.enabled && current.startFrom === 'current-position') {
    return { ...current, startFrom: 'absolute' };
  }
  return jobPlacementAfterDeviceChange(current, previousDevice, nextDevice);
}

export type MachinePlacementSnapshot = {
  readonly statusReport: StatusReport | null;
  readonly workOriginActive?: boolean;
  readonly wcoCache?: WorkCoordinateOffset | null;
  readonly reportInches?: boolean;
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

// Save G-code is a file export, not a motion command: for every mode except
// Current Position the emitted bytes are independent of the live machine
// state (user/verified origin translate the job anchor to work (0,0);
// absolute passes coordinates through). When the live resolution succeeds we
// keep it — a connected machine still contributes its WCO to the absolute
// bounds preflight — but a failed live resolution must not block the export.
// Falling back drops only the motion offset, so preflight degrades to the
// size-only relative mode that Verified Origin starts already use (ADR-053).
// Current Position is the one mode whose bytes bake in the live head
// position, so it alone keeps its live-machine requirement at export time.
export function resolveExportJobPlacement(
  settings: JobPlacementSettings,
  machine: MachinePlacementSnapshot,
): ResolvedJobPlacement {
  const live = resolveJobPlacement(settings, machine);
  if (live.ok) return live;
  switch (settings.startFrom) {
    case 'absolute':
      return { ok: true };
    case 'user-origin':
      return { ok: true, jobOrigin: { startFrom: 'user-origin', anchor: settings.anchor } };
    case 'verified-origin':
      return { ok: true, jobOrigin: { startFrom: 'verified-origin', anchor: settings.anchor } };
    case 'current-position':
      return live;
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
      messages: [USER_ORIGIN_MISSING_MESSAGE],
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
      messages: [VERIFIED_ORIGIN_MISSING_MESSAGE],
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
    const work = normalizedAxis(report.wPos, machine.reportInches === true);
    // Prefer offsets from THIS frame: MPos−WPos, then the frame's own WCO — both
    // are internally consistent with WPos. Only fall back to the cached WCO when
    // the frame carries neither, since a just-applied G92/G10 can leave the cache
    // a report behind the fresh WPos (C7).
    const sameFrameWco =
      report.wco !== null ? normalizedAxis(report.wco, machine.reportInches === true) : null;
    const offset =
      report.mPos !== null
        ? subtractAxis(normalizedAxis(report.mPos, machine.reportInches === true), work)
        : (sameFrameWco ?? wco ?? defaultWco(machine));
    if (offset === null) return null;
    return { work, offset };
  }
  if (report.mPos === null) return null;
  const offset = wco ?? defaultWco(machine);
  if (offset === null) return null;
  return {
    work: subtractAxis(normalizedAxis(report.mPos, machine.reportInches === true), offset),
    offset,
  };
}

function knownWco(machine: MachinePlacementSnapshot): Axis3 | null {
  const raw = machine.wcoCache ?? machine.statusReport?.wco ?? null;
  return raw === null ? null : normalizedAxis(raw, machine.reportInches === true);
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

function normalizedAxis(axis: Axis3, reportInches: boolean): Axis3 {
  const [x, y, z] = normalizeReportedMPosToMm([axis.x, axis.y, axis.z], reportInches);
  return { x, y, z };
}

function assertNeverStartMode(mode: never): never {
  throw new Error(`Unhandled job start mode: ${String(mode as JobStartMode)}`);
}
