// device-setup-readiness.ts — the pure "ready to cut" checklist shown on the
// wizard's final step (ADR-092). From the draft profile plus whatever the
// controller reported, it answers whether the operator has supplied the few
// facts a safe first cut needs, or is about to Finish an untouched generic
// default. No React, no I/O.

import {
  DEFAULT_DEVICE_PROFILE,
  type DeviceProfile,
  type LaserSubProfile,
  type Origin,
} from '../../../core/devices';
import type { MachineKind } from '../../../core/scene';

export type SetupChecklistItemId =
  | 'identity'
  | 'bed'
  | 'power-scale'
  | 'spindle'
  | 'laser-head'
  | 'origin'
  | 'homing';

export type SetupChecklistItem = {
  readonly id: SetupChecklistItemId;
  readonly label: string;
  readonly status: 'confirmed' | 'needs-attention';
  // Blocking items must be confirmed before the machine reports ready.
  // Identity, origin, and homing are informational rows: useful review context,
  // but not reasons to block a deliberate generic/custom profile.
  readonly blocking: boolean;
  readonly detail: string;
};

export type SetupReadiness = {
  readonly items: ReadonlyArray<SetupChecklistItem>;
  readonly ready: boolean;
};

const ORIGIN_LABELS: Record<Origin, string> = {
  'front-left': 'Front left',
  'front-right': 'Front right',
  'rear-left': 'Rear left',
  'rear-right': 'Rear right',
  center: 'Center',
};

export function computeSetupReadiness(
  draft: DeviceProfile,
  detected: Partial<DeviceProfile> | null,
  machineKind: MachineKind = 'laser',
): SetupReadiness {
  const patch = detected ?? {};
  // "The operator told us which machine this is" — picking any non-default
  // catalog profile counts as having left the generic starter behind, even
  // when its numbers happen to match the default (e.g. another 400×400).
  const pickedRealProfile = draft.profileId !== DEFAULT_DEVICE_PROFILE.profileId;
  const items: ReadonlyArray<SetupChecklistItem> = [
    identityItem(draft),
    bedItem(draft, patch, pickedRealProfile),
    ...(machineKind === 'cnc'
      ? [spindleItem(patch, pickedRealProfile)]
      : [powerScaleItem(draft, patch, pickedRealProfile), laserHeadItem(draft)]),
    originItem(draft),
    homingItem(draft),
  ];
  const ready = items.every((item) => !item.blocking || item.status === 'confirmed');
  return { items, ready };
}

function spindleItem(
  patch: Partial<DeviceProfile>,
  pickedRealProfile: boolean,
): SetupChecklistItem {
  const spindleMaxRpm = patch.maxPowerS;
  const confirmed = pickedRealProfile || (spindleMaxRpm !== undefined && spindleMaxRpm > 0);
  return {
    id: 'spindle',
    label: 'Spindle maximum ($30)',
    status: confirmed ? 'confirmed' : 'needs-attention',
    blocking: true,
    detail:
      spindleMaxRpm === undefined
        ? 'Not reported. Confirm the spindle maximum in CNC Setup.'
        : `${spindleMaxRpm} RPM`,
  };
}

function identityItem(draft: DeviceProfile): SetupChecklistItem {
  return {
    id: 'identity',
    label: 'Machine identity',
    status: 'confirmed',
    blocking: false,
    detail: draft.name,
  };
}

function bedItem(
  draft: DeviceProfile,
  patch: Partial<DeviceProfile>,
  pickedRealProfile: boolean,
): SetupChecklistItem {
  // Confirmed when the operator picked a real machine, the controller
  // reported the bed via $$, or the value was edited off the default. In the
  // live flow `detected` is already overlaid into the draft, so `reported`
  // matters mainly when the reported value happens to equal the default.
  const reported = patch.bedWidth !== undefined && patch.bedHeight !== undefined;
  const changed =
    draft.bedWidth !== DEFAULT_DEVICE_PROFILE.bedWidth ||
    draft.bedHeight !== DEFAULT_DEVICE_PROFILE.bedHeight;
  const confirmed = pickedRealProfile || reported || changed;
  return {
    id: 'bed',
    label: 'Work area',
    status: confirmed ? 'confirmed' : 'needs-attention',
    blocking: true,
    detail: `${draft.bedWidth} × ${draft.bedHeight} mm`,
  };
}

function powerScaleItem(
  draft: DeviceProfile,
  patch: Partial<DeviceProfile>,
  pickedRealProfile: boolean,
): SetupChecklistItem {
  const reported = patch.maxPowerS !== undefined;
  const changed = draft.maxPowerS !== DEFAULT_DEVICE_PROFILE.maxPowerS;
  const confirmed = pickedRealProfile || reported || changed;
  return {
    id: 'power-scale',
    label: 'Power scale ($30)',
    status: confirmed ? 'confirmed' : 'needs-attention',
    blocking: true,
    detail: `Max S ${draft.maxPowerS}${draft.laserModeEnabled ? ', laser mode on' : ', laser mode OFF'}`,
  };
}

function laserHeadItem(draft: DeviceProfile): SetupChecklistItem {
  const head = draft.laserSubProfile;
  if (head === undefined) {
    return {
      id: 'laser-head',
      label: 'Laser head',
      status: 'needs-attention',
      blocking: false,
      detail: 'No laser head metadata. Material matching will use generic recipes.',
    };
  }
  const known =
    head.technology !== undefined &&
    head.technology !== 'unknown' &&
    (head.opticalPowerW !== undefined || head.wavelengthNm !== undefined);
  const verified =
    head.metadataConfidence === 'researched' ||
    head.metadataConfidence === 'user-confirmed' ||
    head.metadataConfidence === 'imported';
  return {
    id: 'laser-head',
    label: 'Laser head',
    status: known && verified ? 'confirmed' : 'needs-attention',
    blocking: false,
    detail:
      known && verified
        ? laserHeadLabel(head)
        : `${laserHeadLabel(head)}. Confirm power and wavelength before trusting recipe matches.`,
  };
}

function originItem(draft: DeviceProfile): SetupChecklistItem {
  return {
    id: 'origin',
    label: 'Origin corner',
    status: 'confirmed',
    blocking: false,
    detail: ORIGIN_LABELS[draft.origin],
  };
}

function homingItem(draft: DeviceProfile): SetupChecklistItem {
  return {
    id: 'homing',
    label: 'Homing',
    status: 'confirmed',
    blocking: false,
    detail: draft.homing.enabled
      ? `Enabled — homes ${ORIGIN_LABELS[draft.homing.direction]}`
      : 'Disabled',
  };
}

function laserHeadLabel(head: LaserSubProfile): string {
  const parts = [head.model];
  if (head.technology !== undefined) parts.push(head.technology);
  if (head.opticalPowerW !== undefined) parts.push(`${head.opticalPowerW} W`);
  if (head.wavelengthNm !== undefined) parts.push(`${head.wavelengthNm} nm`);
  return parts.join(', ');
}
