// The last machine (ADR-500) is the operator's own machine, saved here from
// Machine Setup. Restoring it must not treat its verified scan offsets like a
// file from elsewhere, or a Neotronics 4040 that requires verified offsets
// quietly scans one way only (audit D-5). A file import still marks them pending.

import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, type DeviceProfile } from '../../core/devices';
import { resolveEffectiveScanDirection } from '../../core/job/scan-direction-policy';
import { deserializeMachineProfileDocument } from '../../io/machine-profile';
import {
  LAST_MACHINE_STORAGE_KEY,
  loadLastMachine,
  rememberLastMachine,
} from './last-machine-persistence';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

function calibratedMachine(status: DeviceProfile['scanOffsetCalibrationStatus']): DeviceProfile {
  return {
    ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    scanningOffsets: [
      { speedMmPerMin: 1000, offsetMm: 0.05 },
      { speedMmPerMin: 3000, offsetMm: 0.12 },
    ],
    scanOffsetCalibrationStatus: status,
  };
}

describe('the last machine keeps its scan-offset calibration', () => {
  it('comes back verified, so bidirectional scanning stays on', () => {
    const verified = calibratedMachine('verified');
    const storage = memoryStorage();
    expect(rememberLastMachine(storage, verified)).toBe(true);

    const restored = loadLastMachine(storage);

    expect(restored?.scanOffsetCalibrationStatus).toBe('verified');
    expect(restored === null ? null : resolveEffectiveScanDirection(restored, true)).toEqual(
      resolveEffectiveScanDirection(verified, true),
    );
    expect(resolveEffectiveScanDirection(verified, true).bidirectional).toBe(true);
  });

  it('keeps pending offsets pending and offsets saved without a status as they were', () => {
    const storage = memoryStorage();
    rememberLastMachine(storage, calibratedMachine('pending'));
    expect(loadLastMachine(storage)?.scanOffsetCalibrationStatus).toBe('pending');

    rememberLastMachine(storage, calibratedMachine(undefined));
    const restored = loadLastMachine(storage);
    expect(restored?.scanningOffsets).toHaveLength(2);
    expect(restored?.scanOffsetCalibrationStatus).toBeUndefined();
  });

  it('still imports the same text as a file with its offsets pending', () => {
    const storage = memoryStorage();
    rememberLastMachine(storage, calibratedMachine('verified'));
    const text = storage.getItem(LAST_MACHINE_STORAGE_KEY);
    expect(text).not.toBeNull();

    const imported = deserializeMachineProfileDocument(text ?? '');

    expect(imported.kind).toBe('ok');
    if (imported.kind !== 'ok') return;
    expect(imported.document.profile.scanOffsetCalibrationStatus).toBe('pending');
    expect(imported.document.reviewNotes).toContainEqual(
      expect.stringContaining('verification pending'),
    );
  });
});
