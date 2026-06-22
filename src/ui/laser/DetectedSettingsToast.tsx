import { useEffect, useRef } from 'react';
import type { ControllerSettingsSnapshot, GrblSettingRow } from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { describePatch, describeReviewItems } from './DetectedSettingsBanner';

export function DetectedSettingsToast(): null {
  const detected = useLaserStore((s) => s.detectedSettings);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const settingsRows = useLaserStore((s) => s.grblSettingsRows);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const current = useStore((s) => s.project.device);
  const pushToast = useToastStore((s) => s.pushToast);
  const notifiedReadAt = useRef<number | null>(null);

  useEffect(() => {
    if (lastSettingsReadAt === null) return;
    if (notifiedReadAt.current === lastSettingsReadAt) return;
    notifiedReadAt.current = lastSettingsReadAt;
    pushToast(
      describeDetectedSettingsToast({
        patch: detected,
        current,
        controllerSettings,
        settingsRows,
      }),
      'info',
    );
  }, [controllerSettings, current, detected, lastSettingsReadAt, pushToast, settingsRows]);

  return null;
}

export function describeDetectedSettingsToast(args: {
  readonly patch: Partial<DeviceProfile> | null;
  readonly current: DeviceProfile;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly settingsRows: ReadonlyArray<GrblSettingRow>;
}): string {
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
