import { useEffect, useRef } from 'react';
import type { ControllerSettingsSnapshot, GrblSettingRow } from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { describePatch, describeReviewItems } from './DetectedSettingsBanner';
import { deviceProfileSignature } from './device-setup/device-setup-nudge';

type DetectedSettingsArgs = {
  readonly patch: Partial<DeviceProfile> | null;
  readonly current: DeviceProfile;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly settingsRows: ReadonlyArray<GrblSettingRow>;
};

// The review items each machine profile last announced in this run. A
// reconnect that reads the same settings again announces nothing (ADR-611
// Amendment 2); a reload starts afresh, so the first read still confirms.
const announcedReviews = new Map<string, string>();

export function DetectedSettingsToast(): null {
  const detected = useLaserStore((s) => s.detectedSettings);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const settingsRows = useLaserStore((s) => s.grblSettingsRows);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const current = useStore((s) => s.project.device);
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const pushToast = useToastStore((s) => s.pushToast);
  const notifiedReadAt = useRef<number | null>(null);

  useEffect(() => {
    if (lastSettingsReadAt === null) return;
    if (notifiedReadAt.current === lastSettingsReadAt) return;
    notifiedReadAt.current = lastSettingsReadAt;
    const args = { patch: detected, current, controllerSettings, settingsRows };
    if (!shouldAnnounceDetectedSettings(deviceProfileSignature(current, machineKind), args)) {
      return;
    }
    pushToast(describeDetectedSettingsToast(args), 'info');
  }, [
    controllerSettings,
    current,
    detected,
    lastSettingsReadAt,
    machineKind,
    pushToast,
    settingsRows,
  ]);

  return null;
}

/**
 * A settings read is announced when it offers profile updates, or when its
 * review items differ from the last read announced for this machine profile.
 * Records the read it lets through.
 */
export function shouldAnnounceDetectedSettings(
  profileSignature: string,
  args: DetectedSettingsArgs,
): boolean {
  const patch = args.patch ?? {};
  const review = describeReviewItems(
    patch,
    args.current,
    args.controllerSettings ?? {},
    args.settingsRows,
  );
  const reviewKey = JSON.stringify([
    review.needsReview.map((item) => [item.label, item.detail]),
    review.ignored.map((item) => item.label),
  ]);
  const hasUpdates = describePatch(patch, args.current).length > 0;
  if (!hasUpdates && announcedReviews.get(profileSignature) === reviewKey) return false;
  announcedReviews.set(profileSignature, reviewKey);
  return true;
}

/** Test seam: forget which reads this run already announced. */
export function resetAnnouncedDetectedSettings(): void {
  announcedReviews.clear();
}

export function describeDetectedSettingsToast(args: DetectedSettingsArgs): string {
  const patch = args.patch ?? {};
  const safeRows = describePatch(patch, args.current);
  const review = describeReviewItems(
    patch,
    args.current,
    args.controllerSettings ?? {},
    args.settingsRows,
  );
  const reviewCount = review.needsReview.length + review.ignored.length;
  if (safeRows.length > 0 && reviewCount > 0) {
    return 'Machine settings detected: profile updates and review items are ready in Machine Setup.';
  }
  if (safeRows.length > 0) {
    return 'Machine settings detected: safe profile updates are ready in Machine Setup.';
  }
  if (review.needsReview.length > 0) {
    return 'Machine settings detected: review controller homing and limit settings in Machine Setup.';
  }
  if (review.ignored.length > 0) {
    return 'Machine settings detected: unknown GRBL settings were read; review Machine Setup.';
  }
  return 'Machine settings detected: controller settings were read successfully in Machine Setup.';
}
