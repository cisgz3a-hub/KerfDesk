// The calibration target last engraved on each machine (ADR-441 Amendment 4),
// remembered on this computer like the other camera choices. The rings carry
// no position of their own: "Target already engraved" has to know the layout
// the laser used, and rebuilding it from the wizard's settings, which start
// from the defaults after every restart, matched a target engraved with
// another margin to the wrong bed positions. Unreadable storage means nothing
// is remembered.

import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { DeviceProfile } from '../../../core/devices';

export type EngravedTarget = {
  /** Where the rings were engraved, bed mm. */
  readonly area: BedArea;
  /** The bed it was laid out on, mm. */
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  /** The margin it was laid out with or, for a head camera, the square's side, mm. */
  readonly layoutMm: number;
  readonly engravedAt: string;
};

type MachineTargets = { readonly bed?: EngravedTarget; readonly head?: EngravedTarget };

const ENGRAVED_TARGETS_KEY = 'kerfdesk.camera.engraved-targets.v1';

/** The target last engraved on this machine for this kind of camera, or null. */
export function rememberedEngravedTarget(
  device: Pick<DeviceProfile, 'profileId' | 'name'>,
  headCamera: boolean,
): EngravedTarget | null {
  const targets = loadAll()[machineKey(device)];
  return (headCamera ? targets?.head : targets?.bed) ?? null;
}

/**
 * The margin and head-target size of the targets last engraved on this
 * machine, which the wizard fills in when it opens; absent when none is known.
 */
export function rememberedLayoutSettings(device: Pick<DeviceProfile, 'profileId' | 'name'>): {
  readonly marginMm?: number;
  readonly headTargetSizeMm?: number;
} {
  const bed = rememberedEngravedTarget(device, false);
  const head = rememberedEngravedTarget(device, true);
  return {
    ...(bed === null ? {} : { marginMm: bed.layoutMm }),
    ...(head === null ? {} : { headTargetSizeMm: head.layoutMm }),
  };
}

export function rememberEngravedTarget(
  device: Pick<DeviceProfile, 'profileId' | 'name'>,
  headCamera: boolean,
  target: EngravedTarget,
): void {
  const all = loadAll();
  const key = machineKey(device);
  const next = { ...all, [key]: { ...all[key], [headCamera ? 'head' : 'bed']: target } };
  try {
    localStorage.setItem(ENGRAVED_TARGETS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the layout is only known until the app closes.
  }
}

// The machine's committed profile identity, as the setup nudge keys it; the
// bed size is left out because a changed bed does not move rings already
// engraved.
function machineKey(device: Pick<DeviceProfile, 'profileId' | 'name'>): string {
  return device.profileId ?? device.name;
}

function loadAll(): Record<string, MachineTargets> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(localStorage.getItem(ENGRAVED_TARGETS_KEY) ?? '{}');
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const all: Record<string, MachineTargets> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue;
    const bed = parseTarget(value['bed']);
    const head = parseTarget(value['head']);
    all[key] = { ...(bed === null ? {} : { bed }), ...(head === null ? {} : { head }) };
  }
  return all;
}

function parseTarget(value: unknown): EngravedTarget | null {
  if (!isRecord(value) || !isRecord(value['area'])) return null;
  const area = value['area'];
  const numbers = [
    area['x'],
    area['y'],
    area['width'],
    area['height'],
    value['bedWidthMm'],
    value['bedHeightMm'],
    value['layoutMm'],
  ];
  const engravedAt = value['engravedAt'];
  if (!allFinite(numbers) || typeof engravedAt !== 'string') return null;
  const [x, y, width, height, bedWidthMm, bedHeightMm, layoutMm] = numbers;
  if (!(width > 0 && height > 0)) return null;
  return { area: { x, y, width, height }, bedWidthMm, bedHeightMm, layoutMm, engravedAt };
}

type SevenNumbers = readonly [number, number, number, number, number, number, number];

function allFinite(values: ReadonlyArray<unknown>): values is SevenNumbers {
  return values.length === 7 && values.every(isFiniteNumber);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
