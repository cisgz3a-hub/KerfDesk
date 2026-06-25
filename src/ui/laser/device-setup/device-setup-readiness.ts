// device-setup-readiness.ts — the pure "ready to cut" checklist shown on the
// wizard's final step (ADR-092). From the draft profile plus whatever the
// controller reported, it answers whether the operator has supplied the few
// facts a safe first cut needs, or is about to Finish an untouched generic
// default. No React, no I/O.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from '../../../core/devices';

export type SetupChecklistItemId = 'identity' | 'bed' | 'power-scale' | 'origin' | 'homing';

export type SetupChecklistItem = {
  readonly id: SetupChecklistItemId;
  readonly label: string;
  readonly status: 'confirmed' | 'needs-attention';
  // Blocking items must be confirmed before the machine reports ready. Origin
  // and homing are informational rows (valid defaults exist), shown so the
  // operator can review them without gating Finish.
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
): SetupReadiness {
  const patch = detected ?? {};
  // "The operator told us which machine this is" — picking any non-default
  // catalog profile counts as having left the generic starter behind, even
  // when its numbers happen to match the default (e.g. another 400×400).
  const pickedRealProfile = draft.profileId !== DEFAULT_DEVICE_PROFILE.profileId;
  const items: ReadonlyArray<SetupChecklistItem> = [
    identityItem(draft, pickedRealProfile),
    bedItem(draft, patch, pickedRealProfile),
    powerScaleItem(draft, patch, pickedRealProfile),
    originItem(draft),
    homingItem(draft),
  ];
  const ready = items.every((item) => !item.blocking || item.status === 'confirmed');
  return { items, ready };
}

function identityItem(draft: DeviceProfile, pickedRealProfile: boolean): SetupChecklistItem {
  const confirmed = pickedRealProfile || draft.name !== DEFAULT_DEVICE_PROFILE.name;
  return {
    id: 'identity',
    label: 'Machine identity',
    status: confirmed ? 'confirmed' : 'needs-attention',
    blocking: true,
    detail: confirmed ? draft.name : 'Still the generic starter — pick or name your machine.',
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
