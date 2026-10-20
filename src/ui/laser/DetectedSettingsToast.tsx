import { useEffect, useRef } from 'react';
import type { ControllerSettingsSnapshot, GrblSettingRow } from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import type { SerialPortIdentity } from '../../platform/types';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { describePatch, describeReviewItems } from './DetectedSettingsBanner';

type DetectedSettingsRead = {
  readonly patch: Partial<DeviceProfile> | null;
  readonly current: DeviceProfile;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly settingsRows: ReadonlyArray<GrblSettingRow>;
};

// What the last read on each port reported, for this run of the app. A read
// that finds nothing new stays quiet: its plain result is in the log and in
// Controller info (ADR-648, controller audit 2026-10-19 F-5).
const itemsReadByPort = new Map<string, ReadonlySet<string>>();

export function DetectedSettingsToast(): null {
  const detected = useLaserStore((s) => s.detectedSettings);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const settingsRows = useLaserStore((s) => s.grblSettingsRows);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const portInfo = useLaserStore((s) => s.serialPortInfo);
  const current = useStore((s) => s.project.device);
  const pushToast = useToastStore((s) => s.pushToast);
  const notifiedReadAt = useRef<number | null>(null);

  useEffect(() => {
    if (lastSettingsReadAt === null) return;
    if (notifiedReadAt.current === lastSettingsReadAt) return;
    notifiedReadAt.current = lastSettingsReadAt;
    const message = announceDetectedSettings(
      { patch: detected, current, controllerSettings, settingsRows },
      itemsReadByPort,
      detectedSettingsPortKey(portInfo),
    );
    if (message !== null) pushToast(message, 'info');
  }, [
    controllerSettings,
    current,
    detected,
    lastSettingsReadAt,
    portInfo,
    pushToast,
    settingsRows,
  ]);

  return null;
}

export function detectedSettingsPortKey(port: SerialPortIdentity | null | undefined): string {
  return `${port?.transport ?? 'serial'}:${port?.usbVendorId ?? '-'}:${port?.usbProductId ?? '-'}`;
}

/** The toast for a completed read, or null when it found no profile update or
 * review item that the last read on this port did not already report. The
 * read is remembered for the port either way. */
export function announceDetectedSettings(
  read: DetectedSettingsRead,
  itemsByPort: Map<string, ReadonlySet<string>>,
  portKey: string,
): string | null {
  const items = detectedSettingsItems(read);
  const previous = itemsByPort.get(portKey);
  itemsByPort.set(portKey, new Set([...items.updates, ...items.review, ...items.ignored]));
  const isNew = (key: string): boolean => previous?.has(key) !== true;
  return describeDetectedSettingsToast(
    items.updates.filter(isNew).length,
    items.review.filter(isNew).length,
    items.ignored.filter(isNew).length,
  );
}

function detectedSettingsItems(read: DetectedSettingsRead): {
  readonly updates: ReadonlyArray<string>;
  readonly review: ReadonlyArray<string>;
  readonly ignored: ReadonlyArray<string>;
} {
  const patch = read.patch ?? {};
  const review = describeReviewItems(
    patch,
    read.current,
    read.controllerSettings ?? {},
    read.settingsRows,
  );
  return {
    updates: describePatch(patch, read.current).map((row) => `update:${row.label}=${row.newText}`),
    review: review.needsReview.map((item) => `review:${item.label}:${item.detail}`),
    ignored: review.ignored.map((item) => `ignored:${item.label}`),
  };
}

function describeDetectedSettingsToast(
  updates: number,
  review: number,
  ignored: number,
): string | null {
  if (updates > 0 && review + ignored > 0) {
    return 'Machine settings detected: profile updates and review items are ready in Machine Setup.';
  }
  if (updates > 0) {
    return 'Machine settings detected: safe profile updates are ready in Machine Setup.';
  }
  if (review > 0) {
    return 'Machine settings detected: review controller homing and limit settings in Machine Setup.';
  }
  if (ignored > 0) {
    return 'Machine settings detected: unknown GRBL settings were read; review Machine Setup.';
  }
  return null;
}
