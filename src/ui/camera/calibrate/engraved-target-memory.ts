// The calibration target last engraved on each machine (ADR-441 Amendment 4),
// remembered on this computer like the other camera choices. The rings carry
// no position of their own: "Target already engraved" has to know the layout
// the laser used, and rebuilding it from the wizard's settings, which start
// from the defaults after every restart, matched a target engraved with
// another margin to the wrong bed positions. The bed frame it was engraved in
// goes with it, so a calibration from it records that frame (rolling audit
// 12-P2-2). Unreadable storage means nothing is remembered.

import {
  normalizeCameraBedFrame,
  type CameraBedFrame,
} from '../../../core/camera/model/camera-bed-frame';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import { DEFAULT_RING_DIAMETER_MM } from '../../../core/camera/target/bed-target';
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
  /** The bed frame the rings were placed in; absent on targets remembered before it was kept. */
  readonly bedFrame?: CameraBedFrame;
  /** Put on the canvas for the operator to engrave, rather than engraved by the wizard. */
  readonly onCanvas?: true;
  /** Outer diameter of its rings, mm; absent on targets remembered before ring sizes (10 mm). */
  readonly ringDiameterMm?: number;
};

/**
 * The bed frame `target` was engraved in. A target remembered without one
 * keeps its bed size and takes today's origin, with the native offset unknown.
 */
export function engravedTargetBedFrame(
  target: EngravedTarget,
  now: CameraBedFrame,
): CameraBedFrame {
  return (
    target.bedFrame ?? {
      origin: now.origin,
      bedWidthMm: target.bedWidthMm,
      bedHeightMm: target.bedHeightMm,
    }
  );
}

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
  readonly ringDiameterMm?: number;
} {
  const bed = rememberedEngravedTarget(device, false);
  const head = rememberedEngravedTarget(device, true);
  // The fixed camera's ring size: the one a recalibration most likely reuses.
  const ring = bed?.ringDiameterMm ?? (bed === null ? undefined : DEFAULT_RING_DIAMETER_MM);
  return {
    ...(bed === null ? {} : { marginMm: bed.layoutMm }),
    ...(head === null ? {} : { headTargetSizeMm: head.layoutMm }),
    ...(ring === undefined ? {} : { ringDiameterMm: ring }),
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
  const bedFrame =
    value['bedFrame'] === undefined ? undefined : normalizeCameraBedFrame(value['bedFrame']);
  if (value['bedFrame'] !== undefined && bedFrame === undefined) return null;
  return {
    area: { x, y, width, height },
    bedWidthMm,
    bedHeightMm,
    layoutMm,
    engravedAt,
    ...(bedFrame === undefined ? {} : { bedFrame }),
    ...targetExtras(value),
  };
}

// How the target was placed and how large its rings are, when remembered.
function targetExtras(
  value: Record<string, unknown>,
): Pick<EngravedTarget, 'onCanvas' | 'ringDiameterMm'> {
  const ring = value['ringDiameterMm'];
  return {
    ...(value['onCanvas'] === true ? { onCanvas: true as const } : {}),
    ...(isFiniteNumber(ring) && ring > 0 ? { ringDiameterMm: ring } : {}),
  };
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
