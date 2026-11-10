import type { CameraBedFrame } from '../../core/camera/model/camera-bed-frame';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
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
  if (!device.homing.enabled || evidence.homingState !== 'confirmed') return null;
  if (hasVendorPositiveContract(device, evidence)) {
    return nativeBedFrame(device, {
      minX: 0,
      minY: 0,
      maxX: device.bedWidth,
      maxY: device.bedHeight,
    });
  }
  if (!hasCurrentStockEvidence(evidence)) return null;
  const settings = evidence.controllerSettings;
  const build = evidence.controllerBuildInfo;
  if (settings == null || build == null) return null;
  const bounds = stockNativeBounds(settings, build);
  return bounds === null ? null : nativeBedFrame(device, bounds);
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

function hasCurrentStockEvidence(evidence: NativeBedEvidence): boolean {
  const epoch = evidence.controllerSessionEpoch;
  return (
    evidence.activeControllerKind === 'grbl-v1.1' &&
    evidence.detectedControllerKind === 'grbl-v1.1' &&
    evidence.activeControllerCommandSet == null &&
    epoch !== undefined &&
    evidence.controllerSettingsObservation?.sessionEpoch === epoch &&
    evidence.controllerBuildInfoObservation?.sessionEpoch === epoch
  );
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
