import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceProfile } from '../../core/devices';
import {
  convertDraftScanOffsetFormat,
  NATIVE_SCAN_OFFSET_MEASUREMENT_FORMAT,
  rowsFromScanOffsetProfile,
  validateMeasuredScanOffsets,
  type DraftScanOffsetMeasurement,
  type ScanOffsetMeasurementFormat,
} from './scan-offset-measurement-draft';

/** Keep measurement text and exact canonical values attached to the machine/document owner. */
export function useMeasuredScanOffsetDraft(device: DeviceProfile, documentEpoch: number) {
  const [format, setFormat] = useState<ScanOffsetMeasurementFormat>(
    NATIVE_SCAN_OFFSET_MEASUREMENT_FORMAT,
  );
  const [rows, setRows] = useState<ReadonlyArray<DraftScanOffsetMeasurement>>(() =>
    rowsFromScanOffsetProfile(device, NATIVE_SCAN_OFFSET_MEASUREMENT_FORMAT),
  );
  const fingerprint = scanOffsetProfileFingerprint(device, documentEpoch);
  const priorFingerprint = useRef(fingerprint);
  const validation = useMemo(
    () => validateMeasuredScanOffsets(rows, device, format),
    [rows, device, format],
  );
  useEffect(() => {
    if (priorFingerprint.current === fingerprint) return;
    priorFingerprint.current = fingerprint;
    setRows(rowsFromScanOffsetProfile(device, format));
  }, [device, format, fingerprint]);
  const handleFormatChange = (next: ScanOffsetMeasurementFormat): void => {
    setRows((current) => convertDraftScanOffsetFormat(current, format, next));
    setFormat(next);
  };
  return { format, rows, setRows, validation, handleFormatChange };
}

function scanOffsetProfileFingerprint(device: DeviceProfile, documentEpoch: number): string {
  const head = device.laserSubProfile;
  // Cosmetic names/notes do not change ownership. These head fields mirror the
  // interactive profile calibration identity; include bed constraints and the
  // document epoch even when both old and new profiles have an empty table.
  return JSON.stringify([
    documentEpoch,
    device.profileId,
    device.maxFeed,
    device.scanningOffsets,
    device.bedWidth,
    device.bedHeight,
    device.controllerKind ?? 'grbl-v1.1',
    device.gcodeDialect.dialectId,
    head?.model,
    head?.technology,
    head?.opticalPowerW,
    head?.wavelengthNm,
    head?.spotSizeMm,
  ]);
}
