// F-7: describe auto-detected machine settings from the `$$` dump for the
// connection toast (DetectedSettingsToast) and Machine Setup's automatic lane
// (DeviceSetupAutoDetect). Safe numeric profile values are listed as updates;
// hardware capability hints stay review-only until the operator confirms the
// machine.

import type { ControllerSettingsSnapshot, GrblSettingRow } from '../../core/controllers/grbl';
import {
  profileSupportsCapability,
  type DeviceProfile,
  type ProfileCapability,
} from '../../core/devices';
import { numbersClose } from '../../core/util';
import type { HelpTopicId } from '../help/help-topics';

type Row = {
  readonly label: string;
  readonly oldText: string;
  readonly newText: string;
  readonly changed: boolean;
};

type ReviewItem = {
  readonly label: string;
  readonly detail: string;
  readonly action?: ReviewAction;
};

type ReviewAction = {
  readonly label: string;
  readonly title: string;
  readonly patch: Partial<DeviceProfile>;
  readonly helpId: HelpTopicId;
};

type ReviewSummary = {
  readonly needsReview: ReadonlyArray<ReviewItem>;
  readonly ignored: ReadonlyArray<ReviewItem>;
};

export function describePatch(
  patch: Partial<DeviceProfile>,
  current: DeviceProfile,
): ReadonlyArray<Row> {
  const rows: Row[] = [];
  pushNumericRow(rows, 'Bed width', patch.bedWidth, current.bedWidth, formatMm);
  pushNumericRow(rows, 'Bed height', patch.bedHeight, current.bedHeight, formatMm);
  pushOptionalNumericRow(rows, 'Z travel', patch.zTravelMm, current.zTravelMm, formatMm);
  pushNumericRow(rows, 'Max feed', patch.maxFeed, current.maxFeed, formatFeed);
  pushNumericRow(rows, 'Max power (S)', patch.maxPowerS, current.maxPowerS, formatInt);
  pushNumericRow(rows, 'Min power (S)', patch.minPowerS, current.minPowerS, formatInt);
  pushBooleanRow(
    rows,
    'Laser mode ($32)',
    patch.laserModeEnabled,
    current.laserModeEnabled,
    formatLaserMode,
  );
  pushNumericRow(rows, 'Acceleration', patch.accelMmPerSec2, current.accelMmPerSec2, formatAccel);
  pushNumericRow(
    rows,
    'Junction deviation',
    patch.junctionDeviationMm,
    current.junctionDeviationMm,
    formatMm,
  );
  return rows;
}

export function describeReviewItems(
  patch: Partial<DeviceProfile>,
  current: DeviceProfile,
  controller: ControllerSettingsSnapshot,
  settingsRows: ReadonlyArray<GrblSettingRow>,
): ReviewSummary {
  const needsReview: ReviewItem[] = [];
  const ignored: ReviewItem[] = [];
  const detectedZTravelMm = controller.zTravelMm ?? patch.zTravelMm;
  if (
    isPositive(controller.zMaxFeed) &&
    isPositive(detectedZTravelMm) &&
    !profileSupportsCapability(current, 'z-axis')
  ) {
    needsReview.push({
      label: 'Powered Z jog',
      detail:
        'Controller reports Z travel and Z max rate. Confirm the machine has a motorized Z/focus axis before enabling Z jog buttons.',
      action: {
        label: 'Mark profile as powered Z',
        title: 'Adds powered Z capability but keeps Z jog blocked until travel is confirmed.',
        helpId: 'control:laser.detected-settings.powered-z',
        patch: {
          capabilities: addCapability(current.capabilities, 'z-axis'),
          zTravelMm: detectedZTravelMm,
          zTravelConfirmed: false,
        },
      },
    });
  }
  pushBooleanReview(
    needsReview,
    'Soft limits ($20)',
    controller.softLimitsEnabled,
    'Firmware soft-limit behavior is controller-side. Confirm bed size, origin, and homing before relying on it.',
  );
  pushBooleanReview(
    needsReview,
    'Hard limits ($21)',
    controller.hardLimitsEnabled,
    'Physical limit switch behavior cannot be verified from $$ alone.',
  );
  pushBooleanReview(
    needsReview,
    'Homing cycle ($22)',
    controller.homingEnabled,
    'Confirm switch wiring and home direction before enabling homing-dependent workflows.',
  );
  if (controller.homingDirectionMask !== undefined) {
    needsReview.push({
      label: 'Homing direction mask ($23)',
      detail: `Controller reports mask ${controller.homingDirectionMask}. Review the machine documentation before mapping this to a KerfDesk home corner.`,
    });
  }
  for (const row of settingsRows) {
    if (row.known) continue;
    ignored.push({
      label: row.code,
      detail: 'Unknown GRBL setting was read but not applied to the KerfDesk profile.',
    });
  }
  return { needsReview, ignored };
}

function pushBooleanReview(
  rows: ReviewItem[],
  label: string,
  value: boolean | undefined,
  suffix: string,
): void {
  if (value === undefined) return;
  rows.push({
    label,
    detail: `Controller reports ${value ? 'enabled' : 'disabled'}. ${suffix}`,
  });
}

function pushBooleanRow(
  rows: Row[],
  label: string,
  next: boolean | undefined,
  prev: boolean,
  format: (value: boolean) => string,
): void {
  if (next === undefined) return;
  if (next === prev) return;
  rows.push({
    label,
    oldText: format(prev),
    newText: format(next),
    changed: true,
  });
}

function pushNumericRow(
  rows: Row[],
  label: string,
  next: number | undefined,
  prev: number,
  format: (n: number) => string,
): void {
  if (next === undefined) return;
  if (numbersClose(next, prev)) return;
  rows.push({
    label,
    oldText: format(prev),
    newText: format(next),
    changed: true,
  });
}

function pushOptionalNumericRow(
  rows: Row[],
  label: string,
  next: number | undefined,
  prev: number | undefined,
  format: (n: number) => string,
): void {
  if (next === undefined) return;
  if (prev !== undefined && numbersClose(next, prev)) return;
  rows.push({
    label,
    oldText: prev === undefined ? 'Not set' : format(prev),
    newText: format(next),
    changed: true,
  });
}

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function addCapability(
  capabilities: ReadonlyArray<ProfileCapability> | undefined,
  capability: ProfileCapability,
): ReadonlyArray<ProfileCapability> {
  if (capabilities?.includes(capability) === true) return capabilities;
  return [...(capabilities ?? []), capability];
}

function formatMm(n: number): string {
  return `${n.toFixed(3)} mm`;
}

function formatFeed(n: number): string {
  return `${Math.round(n)} mm/min`;
}

function formatInt(n: number): string {
  return `${Math.round(n)}`;
}

function formatAccel(n: number): string {
  return `${Math.round(n)} mm/s^2`;
}

function formatLaserMode(enabled: boolean): string {
  return enabled ? 'Enabled' : 'Disabled';
}
