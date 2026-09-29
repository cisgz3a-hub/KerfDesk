// Reading a machine profile document as a file import or as a restore of the
// machine the app saved for itself (ADR-500). Both validate the document the
// same way; only the import marks scan offsets pending (audit D-5).

import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  type MachineProfileReadMode,
} from './machine-profile-io';

function documentText(
  profilePatch: Record<string, unknown>,
  top: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile: {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [
        { speedMmPerMin: 1000, offsetMm: 0.05 },
        { speedMmPerMin: 3000, offsetMm: 0.12 },
      ],
      scanOffsetCalibrationStatus: 'verified',
      ...profilePatch,
    },
    source: { kind: 'custom', label: 'Shop Neotronics' },
    reviewNotes: [],
    ...top,
  });
}

describe('machine profile read modes', () => {
  it('restores the saved calibration status without an import note', () => {
    for (const status of ['verified', 'pending'] as const) {
      const result = deserializeMachineProfileDocument(
        documentText({ scanOffsetCalibrationStatus: status }),
        'restore',
      );
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.document.profile.scanOffsetCalibrationStatus).toBe(status);
      expect(result.document.reviewNotes).toEqual([]);
    }
  });

  it('imports saved offsets as pending with a note, by default or when asked', () => {
    const modes: ReadonlyArray<MachineProfileReadMode | undefined> = [undefined, 'import'];
    for (const mode of modes) {
      const result = deserializeMachineProfileDocument(documentText({}), mode);
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.document.profile.scanOffsetCalibrationStatus).toBe('pending');
      expect(result.document.reviewNotes).toContainEqual(
        expect.stringContaining('verification pending'),
      );
    }
  });

  it('validates a restore the same way as an import', () => {
    const invalid = [
      documentText({ scanOffsetCalibrationStatus: 'trusted' }),
      documentText({ scanningOffsets: [] }),
      documentText({ scanningOffsets: [{ speedMmPerMin: 0, offsetMm: 'bad' }] }),
      documentText({ origin: 'middle' }),
      documentText({}, { format: 'something-else' }),
    ];
    for (const text of invalid) {
      expect(deserializeMachineProfileDocument(text, 'restore').kind).toBe('invalid');
      expect(deserializeMachineProfileDocument(text).kind).toBe('invalid');
    }
    const newer = documentText({}, { schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION + 1 });
    expect(deserializeMachineProfileDocument(newer, 'restore').kind).toBe('schema-too-new');
  });
});
