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

export const UNKNOWN_NATIVE_BED_MESSAGE =
  'The controller-to-bed coordinate mapping is unverified. The canvas is artwork-relative; physical bed position and no-go-zone clearance must be checked at the machine.';

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
  return (
    device.controllerCommandSet === 'creality-falcon-a1-pro' &&
    evidence.activeControllerCommandSet === 'creality-falcon-a1-pro' &&
    evidence.activeControllerKind === 'grblhal' &&
    (evidence.detectedControllerKind == null || evidence.detectedControllerKind === 'grblhal')
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
    !positiveTravel(x) ||
    !positiveTravel(y) ||
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

function positiveTravel(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
