import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  type MachineProfileDocument,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from './machine-profile-io';

function profileWithCalibration(): DeviceProfile {
  return {
    ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    profileSource: 'custom',
    scanningOffsets: [
      { speedMmPerMin: 6000, offsetMm: 0.18 },
      { speedMmPerMin: 3000, offsetMm: 0.09 },
    ],
    noGoZones: [
      {
        id: 'front-rail',
        name: 'Front rail clamp',
        enabled: true,
        x: 0,
        y: 0,
        width: 400,
        height: 12,
      },
    ],
  };
}

describe('LaserForge machine profile documents', () => {
  it('serializes deterministic .lfmachine.json with canonical profile safety fields', () => {
    const document: MachineProfileDocument = {
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: profileWithCalibration(),
      source: {
        kind: 'custom' as const,
        label: 'Bench calibration',
      },
      reviewNotes: ['Calibrated from test grid.'],
    };

    const text = serializeMachineProfileDocument(document);

    expect(text).toBe(serializeMachineProfileDocument(document));
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toMatchObject({
      format: 'laserforge-machine-profile',
      schemaVersion: 1,
      profile: {
        profileId: 'neotronics-4040-max-lt4lds-v2-20w',
        scanningOffsets: [
          { speedMmPerMin: 3000, offsetMm: 0.09 },
          { speedMmPerMin: 6000, offsetMm: 0.18 },
        ],
        noGoZones: [{ id: 'front-rail', enabled: true }],
      },
      source: { kind: 'custom', label: 'Bench calibration' },
      reviewNotes: ['Calibrated from test grid.'],
    });
  });

  it('roundtrips calibrated scan offsets and no-go zones', () => {
    const original = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: profileWithCalibration(),
      source: { kind: 'custom', label: 'Bench calibration' },
      reviewNotes: [],
    });

    const result = deserializeMachineProfileDocument(original);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.scanningOffsets).toEqual([
      { speedMmPerMin: 3000, offsetMm: 0.09 },
      { speedMmPerMin: 6000, offsetMm: 0.18 },
    ]);
    expect(result.document.profile.noGoZones).toHaveLength(1);
  });

  it('rejects malformed machine profile documents instead of guessing safety data', () => {
    const result = deserializeMachineProfileDocument(
      JSON.stringify({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile: {
          ...profileWithCalibration(),
          scanningOffsets: [{ speedMmPerMin: 0, offsetMm: 'bad' }],
        },
        source: { kind: 'custom', label: 'Bad import' },
        reviewNotes: [],
      }),
    );

    expect(result).toEqual({ kind: 'invalid', reason: 'profile.scanningOffsets is invalid' });
  });

  it('rejects unsupported formats and newer schemas clearly', () => {
    expect(deserializeMachineProfileDocument('[]')).toEqual({
      kind: 'invalid',
      reason: 'top-level value is not an object',
    });
    expect(
      deserializeMachineProfileDocument(
        JSON.stringify({
          format: MACHINE_PROFILE_FORMAT,
          schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION + 1,
          profile: profileWithCalibration(),
          source: { kind: 'custom', label: 'Future' },
          reviewNotes: [],
        }),
      ),
    ).toEqual({ kind: 'schema-too-new', sawVersion: MACHINE_PROFILE_SCHEMA_VERSION + 1 });
  });
});
