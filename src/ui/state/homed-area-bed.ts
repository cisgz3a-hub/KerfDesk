// homed-area-bed — a grblHAL profile bed wider than the controller's homed
// area (rolling audit v9 R6-P2-3, ADR-637 Amendment 5).
//
// 1.0.28 offered `$130` × `$131` as the bed, so a Falcon A1 Pro profile that
// took it keeps 363 × 273 mm while grblHAL's homed envelope is 358 × 268 mm.
// Jog and Move laser here stop at the envelope (Amendment 4), but Frame and an
// Absolute job follow the saved bed, and `$20=0` stops neither. Correcting the
// bed is not done for the operator: on a front origin the machine Y of every
// placed object is measured from the bed's far edge, so a smaller bed moves a
// job already placed. Connect names the correction once, and until it is
// taken a Frame or Start whose route leaves the envelope says so by name.

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import { jogTravelLimits } from '../../core/controllers/grbl/jog-travel-limits';
import {
  reportedWorkArea,
  travelEnvelopeFirmware,
} from '../../core/controllers/grbl/reported-work-area';
import type { DeviceProfile } from '../../core/devices';
import type { NativeXyBounds } from '../../core/devices/native-bed-frame';
import { currentSessionSettings } from './manual-motion-limits';
import type { NativeBedEvidence } from './native-bed-frame';

export type BedSize = { readonly widthMm: number; readonly heightMm: number };

export type WidenedBed = {
  readonly bed: BedSize;
  readonly homedArea: BedSize;
};

/** The homed area this session's `$$` gives, when the profile bed is the
 *  controller's whole travel and that area is smaller: a grblHAL bed widened
 *  to `$130` × `$131`. Null on stock GRBL, FluidNC and every other family, and
 *  on a bed that fits. */
export function bedWiderThanHomedArea(
  device: DeviceProfile,
  evidence: NativeBedEvidence,
): WidenedBed | null {
  const settings = currentSessionSettings(evidence);
  const firmware = travelEnvelopeFirmware(
    evidence.activeControllerKind,
    evidence.detectedControllerKind,
  );
  if (settings === null || firmware !== 'grblhal') return null;
  const area = reportedWorkArea(settings, firmware);
  if (area === null) return null;
  if (device.bedWidth !== settings.bedWidth || device.bedHeight !== settings.bedHeight) return null;
  if (area.widthMm >= device.bedWidth && area.heightMm >= device.bedHeight) return null;
  return {
    bed: { widthMm: device.bedWidth, heightMm: device.bedHeight },
    homedArea: area,
  };
}

/** grblHAL's homed envelope in native machine coordinates, from this
 *  session's `$$` after this session's Home, without the jog rounding margin;
 *  null otherwise and on every other family. */
export function grblHalHomedEnvelope(evidence: NativeBedEvidence): NativeXyBounds | null {
  if (evidence.homingState !== 'confirmed') return null;
  const firmware = travelEnvelopeFirmware(
    evidence.activeControllerKind,
    evidence.detectedControllerKind,
  );
  const settings = currentSessionSettings(evidence);
  if (firmware !== 'grblhal' || settings === null) return null;
  const limits = envelopeLimits(settings);
  return limits === null
    ? null
    : { minX: limits.x.minMm, maxX: limits.x.maxMm, minY: limits.y.minMm, maxY: limits.y.maxMm };
}

function envelopeLimits(settings: ControllerSettingsSnapshot) {
  const { bedWidth, bedHeight, homingDirectionMask } = settings;
  if (bedWidth === undefined || bedHeight === undefined || homingDirectionMask === undefined)
    return null;
  return jogTravelLimits({
    firmware: 'grblhal',
    travelMm: { x: bedWidth, y: bedHeight },
    homingDirectionMask,
    forceOrigin: settings.homingForceSetOrigin ?? null,
    hardLimits: settings.hardLimitsEnabled,
    pullOffMm: settings.homingPullOffMm,
    softLimitsEnforced: false,
    stepsPerMm: { x: undefined, y: undefined },
  });
}

/** What a smaller bed does to artwork already placed: the machine axis that
 *  is measured from the bed's far edge moves by the difference. */
export function bedCorrectionShift(origin: DeviceProfile['origin'], change: WidenedBed): string {
  const dx = change.bed.widthMm - change.homedArea.widthMm;
  const dy = change.bed.heightMm - change.homedArea.heightMm;
  const x = origin.endsWith('-right') ? dx : origin === 'center' ? dx / 2 : 0;
  const y = origin.startsWith('front-') ? dy : origin === 'center' ? dy / 2 : 0;
  const moves = [
    ...(x === 0 ? [] : [`${formatMm(x)} mm in machine X`]),
    ...(y === 0 ? [] : [`${formatMm(y)} mm in machine Y`]),
  ];
  return moves.length === 0
    ? 'Artwork already placed keeps its machine position.'
    : `Artwork already placed moves ${moves.join(' and ')}.`;
}

export function formatBed(size: BedSize): string {
  return `${formatMm(size.widthMm)} × ${formatMm(size.heightMm)} mm`;
}

function formatMm(value: number): string {
  return Number(value.toFixed(3)).toString();
}
