import type { CameraBedFrame } from '../../core/camera/model/camera-bed-frame';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import { jogTravelLimits } from '../../core/controllers/grbl/jog-travel-limits';
import { deriveMachineEnvelope } from '../../core/controllers/grbl/machine-envelope';
import type { ControllerKind, DeviceProfile } from '../../core/devices';
import type { ControllerCommandSet } from '../../core/devices/device-profile';
import {
  nativeBedFrame,
  type NativeBedFrame,
  type NativeXyBounds,
} from '../../core/devices/native-bed-frame';
import type { SessionObservationStamp } from './laser-controller-observation';
import { memoizeOnInputs } from './memoize-on-inputs';
import { isDefinedFinitePositive } from '../../core/util/finite';

export type NativeBedEvidence = {
  readonly controllerSessionEpoch?: number;
  readonly controllerSettings?: ControllerSettingsSnapshot | null;
  readonly controllerSettingsObservation?: SessionObservationStamp | null;
  readonly controllerBuildInfo?: GrblBuildInfo | null;
  readonly controllerBuildInfoObservation?: SessionObservationStamp | null;
  readonly activeControllerKind?: ControllerKind;
  readonly activeControllerCommandSet?: ControllerCommandSet | null | undefined;
  readonly detectedControllerKind?: ControllerKind | null;
  readonly homingState?: string;
};

// Shared placement types must not depend on the live store's application graph.
export function nativeBedEvidenceSnapshot(source: Required<NativeBedEvidence>): NativeBedEvidence {
  return {
    controllerSessionEpoch: source.controllerSessionEpoch,
    controllerSettings: source.controllerSettings,
    controllerSettingsObservation: source.controllerSettingsObservation,
    controllerBuildInfo: source.controllerBuildInfo,
    controllerBuildInfoObservation: source.controllerBuildInfoObservation,
    activeControllerKind: source.activeControllerKind,
    activeControllerCommandSet: source.activeControllerCommandSet,
    detectedControllerKind: source.detectedControllerKind,
    homingState: source.homingState,
  };
}

// The evidence changes only on connect, settings/build reads and homing, yet
// laser-store selectors run on every set (~3 per acknowledged line while a job
// streams). Hand back the same snapshot until one of its fields changes, so
// selectors key on its identity instead of stringifying it per set.
export const selectNativeBedEvidence = memoizeOnInputs(
  (source: Required<NativeBedEvidence>) => [
    source.controllerSessionEpoch,
    source.controllerSettings,
    source.controllerSettingsObservation,
    source.controllerBuildInfo,
    source.controllerBuildInfoObservation,
    source.activeControllerKind,
    source.activeControllerCommandSet,
    source.detectedControllerKind,
    source.homingState,
  ],
  nativeBedEvidenceSnapshot,
);

// Worded for a beginner (UX audit U4-P2-6): the headline says what is not
// known, and the rest says what to look at before Start.
export const UNKNOWN_NATIVE_BED_MESSAGE =
  "KerfDesk can't check where this job sits on your bed. The controller does not report how its coordinates map to the bed, so the canvas shows the artwork, not the bed. The box Frame traces is where it will burn: check that your material is under it and that it clears clamps and no-go zones.";

export function nativeBedCaptureFrameKey(
  device: DeviceProfile,
  evidence: NativeBedEvidence,
): string {
  return JSON.stringify([
    device.origin,
    device.bedWidth,
    device.bedHeight,
    resolveNativeBedFrame(device, evidence)?.nativeToBedOffsetMm ?? null,
  ]);
}

/**
 * The bed frame a camera calibration is fitted in and checked against
 * (rolling audit 12-P2-2): the facts {@link nativeBedCaptureFrameKey} keys
 * Print and Cut's head captures on, with the native offset absent while it is
 * unknown.
 */
export function cameraBedFrameFor(
  device: DeviceProfile,
  evidence: NativeBedEvidence,
): CameraBedFrame {
  const offset = resolveNativeBedFrame(device, evidence)?.nativeToBedOffsetMm;
  return {
    origin: device.origin,
    bedWidthMm: device.bedWidth,
    bedHeightMm: device.bedHeight,
    ...(offset === undefined ? {} : { nativeToBedOffsetMm: { x: offset.x, y: offset.y } }),
  };
}

/** A settings/build snapshot is evidence only for the session that observed it.
 * This affects display and advisories; an unknown mapping never gates Start. */
export function resolveNativeBedFrame(
  device: DeviceProfile,
  evidence: NativeBedEvidence,
): NativeBedFrame | null {
  return nativeBedFrameStatus(device, evidence).frame;
}

/** Why a session has no bed mapping, for the surfaces that tell the operator
 * (annoyance audit A2 B3-P2-2). The firmware comes first: on a family
 * KerfDesk cannot map, "Home first" would be advice that never works. */
export type NativeBedUnknownReason =
  | { readonly kind: 'firmware'; readonly firmware: ControllerKind | 'vendor-mismatch' }
  | { readonly kind: 'homing-off' }
  | { readonly kind: 'not-homed' }
  | { readonly kind: 'settings-unread' }
  | { readonly kind: 'report-incomplete' }
  | { readonly kind: 'bed-differs'; readonly homedArea: HomedArea };

export type HomedArea = { readonly widthMm: number; readonly heightMm: number };

export type NativeBedFrameStatus =
  | { readonly frame: NativeBedFrame; readonly reason: null }
  | { readonly frame: null; readonly reason: NativeBedUnknownReason };

/**
 * The bed mapping, or why there is none. Three kinds of session can earn one,
 * each after a Home confirmed in this connection:
 * - the Falcon A1 Pro command contract (ADR-322 Amendment 3);
 * - stock GRBL 1.1, from this session's `$$` and `$I`;
 * - grblHAL, from this session's `$$` (ADR-322 Amendment 4).
 * FluidNC, Marlin and Smoothieware report nothing that places their homed
 * coordinates on the bed (native-bed-unknown-reason.ts has the sources).
 */
export function nativeBedFrameStatus(
  device: DeviceProfile,
  evidence: NativeBedEvidence,
): NativeBedFrameStatus {
  const family = mappingFamily(device, evidence);
  if (family.kind === 'unsupported') {
    return unknown({ kind: 'firmware', firmware: family.firmware });
  }
  if (!device.homing.enabled) return unknown({ kind: 'homing-off' });
  if (evidence.homingState !== 'confirmed') return unknown({ kind: 'not-homed' });
  if (family.kind === 'vendor') {
    return framed(device, { minX: 0, minY: 0, maxX: device.bedWidth, maxY: device.bedHeight });
  }
  const bounds = reportedNativeBounds(family.kind, evidence);
  return typeof bounds === 'string' ? unknown({ kind: bounds }) : framed(device, bounds);
}

/** The homed envelope this session's reports give, or which evidence is missing. */
function reportedNativeBounds(
  family: 'stock' | 'grblhal',
  evidence: NativeBedEvidence,
): NativeXyBounds | 'settings-unread' | 'report-incomplete' {
  const settings = currentSessionSettings(evidence);
  if (settings === null) return 'settings-unread';
  if (family === 'grblhal') return grblHalNativeBounds(settings) ?? 'report-incomplete';
  const build = currentSessionBuildInfo(evidence);
  if (build === null) return 'settings-unread';
  return stockNativeBounds(settings, build) ?? 'report-incomplete';
}

// Both `$$` readings need the banner that names the firmware they are for.
function currentSessionSettings(evidence: NativeBedEvidence): ControllerSettingsSnapshot | null {
  const epoch = evidence.controllerSessionEpoch;
  const current =
    evidence.detectedControllerKind != null &&
    epoch !== undefined &&
    evidence.controllerSettingsObservation?.sessionEpoch === epoch;
  return current ? (evidence.controllerSettings ?? null) : null;
}

function currentSessionBuildInfo(evidence: NativeBedEvidence): GrblBuildInfo | null {
  const epoch = evidence.controllerSessionEpoch;
  const current =
    epoch !== undefined && evidence.controllerBuildInfoObservation?.sessionEpoch === epoch;
  return current ? (evidence.controllerBuildInfo ?? null) : null;
}

function unknown(reason: NativeBedUnknownReason): NativeBedFrameStatus {
  return { frame: null, reason };
}

function framed(device: DeviceProfile, bounds: NativeXyBounds): NativeBedFrameStatus {
  const frame = nativeBedFrame(device, bounds);
  if (frame !== null) return { frame, reason: null };
  const widthMm = bounds.maxX - bounds.minX;
  const heightMm = bounds.maxY - bounds.minY;
  return Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm > 0 && heightMm > 0
    ? unknown({ kind: 'bed-differs', homedArea: { widthMm, heightMm } })
    : unknown({ kind: 'report-incomplete' });
}

type MappingFamily =
  | { readonly kind: 'vendor' | 'stock' | 'grblhal' }
  | { readonly kind: 'unsupported'; readonly firmware: ControllerKind | 'vendor-mismatch' };

function mappingFamily(device: DeviceProfile, evidence: NativeBedEvidence): MappingFamily {
  if (hasVendorPositiveContract(device, evidence)) return { kind: 'vendor' };
  // A command set whose contract did not hold: neither reading of `$$` applies.
  if (evidence.activeControllerCommandSet != null) {
    return { kind: 'unsupported', firmware: 'vendor-mismatch' };
  }
  const active = evidence.activeControllerKind ?? device.controllerKind ?? 'grbl-v1.1';
  if (active !== 'grbl-v1.1' && active !== 'grblhal') {
    return { kind: 'unsupported', firmware: active };
  }
  return grblFamily(active, evidence.detectedControllerKind ?? null);
}

// The profile's driver is one of the two GRBL families. The greeting must not
// name another firmware: between the two GRBL families the profile's
// controller type is what to correct, and any other family gets its own reason.
function grblFamily(
  active: 'grbl-v1.1' | 'grblhal',
  detected: ControllerKind | null,
): MappingFamily {
  if (detected === null || detected === active) {
    return { kind: active === 'grblhal' ? 'grblhal' : 'stock' };
  }
  const otherGrblFamily = detected === 'grbl-v1.1' || detected === 'grblhal';
  return { kind: 'unsupported', firmware: otherGrblFamily ? 'vendor-mismatch' : detected };
}

function hasVendorPositiveContract(device: DeviceProfile, evidence: NativeBedEvidence): boolean {
  // Creality's official A1 Pro LightBurn device declares NegativeWorkspace=false.
  // This is an explicit vendor command contract, not a guess from a brand label.
  // The same vendor file labels the controller GRBL-LPC. Two published A1 Pro
  // units greet "GrblHAL 1.1f" (rolling audit v6 K3), but other builds were not
  // seen, so a "Grbl ..." banner (stock GRBL, or grblHAL at
  // COMPATIBILITY_LEVEL >= 1) keeps the contract as a grblHAL one does (audit
  // HF-8); another family's banner still withdraws it. The preset's homing is
  // on (ADR-322 Amendment 3), so the frame applies after a Home this session.
  const detected = evidence.detectedControllerKind;
  return (
    device.controllerCommandSet === 'creality-falcon-a1-pro' &&
    evidence.activeControllerCommandSet === 'creality-falcon-a1-pro' &&
    evidence.activeControllerKind === 'grblhal' &&
    (detected == null || detected === 'grblhal' || detected === 'grbl-v1.1')
  );
}

// grblHAL's homed envelope (ADR-322 Amendment 4), from the same model as its
// jog clamp and reported work area (jog-travel-limits.ts, ADR-637 Amendment 4),
// here with nothing assumed: every setting the envelope depends on must have
// been read, and both X and Y must be in a homing pass, because grblHAL keeps
// no envelope for an axis its Home did not cover (grblhal-homing-cycles.ts).
// A build that prints `$22` as 0 or 1 (COMPATIBILITY_LEVEL above 1) reports
// neither force origin nor the passes, and gets no mapping.
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c#L114-L139
function grblHalNativeBounds(settings: ControllerSettingsSnapshot): NativeXyBounds | null {
  const { bedWidth, bedHeight, homingDirectionMask, hardLimitsEnabled, homingPullOffMm } = settings;
  const forceOrigin = settings.homingForceSetOrigin;
  const homedAxes = settings.homingCycleAxesMask;
  if (
    settings.homingEnabled !== true ||
    !isDefinedFinitePositive(bedWidth) ||
    !isDefinedFinitePositive(bedHeight) ||
    homingDirectionMask === undefined ||
    hardLimitsEnabled === undefined ||
    homingPullOffMm === undefined ||
    forceOrigin === undefined ||
    homedAxes === undefined ||
    (homedAxes & 3) !== 3
  ) {
    return null;
  }
  const limits = jogTravelLimits({
    firmware: 'grblhal',
    travelMm: { x: bedWidth, y: bedHeight },
    homingDirectionMask,
    forceOrigin,
    hardLimits: hardLimitsEnabled,
    pullOffMm: homingPullOffMm,
    // The envelope itself, without the jog rounding margin.
    softLimitsEnforced: false,
    stepsPerMm: { x: undefined, y: undefined },
  });
  return limits === null
    ? null
    : { minX: limits.x.minMm, maxX: limits.x.maxMm, minY: limits.y.minMm, maxY: limits.y.maxMm };
}

function stockNativeBounds(
  settings: ControllerSettingsSnapshot,
  build: GrblBuildInfo,
): NativeXyBounds | null {
  if (settings.homingEnabled !== true || !/^1\.1[a-z]$/.test(build.protocolVersion)) return null;
  const x = settings.bedWidth;
  const y = settings.bedHeight;
  const direction = settings.homingDirectionMask;
  if (
    !isDefinedFinitePositive(x) ||
    !isDefinedFinitePositive(y) ||
    direction === undefined ||
    !Number.isInteger(direction) ||
    direction < 0 ||
    direction > 7
  )
    return null;
  const envelope = deriveMachineEnvelope(
    { x, y, z: 1 },
    direction,
    build.optionCodes.includes('Z'),
  );
  return {
    minX: envelope.x.minMm,
    maxX: envelope.x.maxMm,
    minY: envelope.y.minMm,
    maxY: envelope.y.maxMm,
  };
}
