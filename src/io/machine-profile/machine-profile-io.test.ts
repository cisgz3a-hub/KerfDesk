import { describe, expect, it } from 'vitest';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  type MachineProfileDocument,
  deserializeMachineProfileDocument,
  serializeCanonicalDeviceProfile,
  serializeMachineProfileDocument,
} from './machine-profile-io';

function profileWithCalibration(): DeviceProfile {
  return {
    ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    profileSource: 'custom',
    baudRate: 250000,
    cameraModel: savedCameraModel(),
    fireControl: { enabled: true, maxPowerPercent: 1.5 },
    estimateCutTimeScale: 1.18,
    estimateTravelTimeScale: 1.07,
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

function deserializeProfilePatch(patch: Record<string, unknown>) {
  return deserializeMachineProfileDocument(
    JSON.stringify({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: {
        ...profileWithCalibration(),
        ...patch,
      },
      source: { kind: 'custom', label: 'Bad import' },
      reviewNotes: [],
    }),
  );
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
        gcodeDialect: { dialectId: 'neotronics-4040-safe' },
        streamingMode: 'char-counted',
        rxBufferBytes: 120,
        controlledLaserOffTravelFeedMmPerMin: 800,
        baudRate: 250000,
        cameraModel: {
          version: 1,
          accuracy: { rmsErrorMm: 0.08, foundMarks: 96, expectedMarks: 100 },
        },
        fireControl: { enabled: true, maxPowerPercent: 1.5 },
        estimateCutTimeScale: 1.18,
        estimateTravelTimeScale: 1.07,
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

  it('roundtrips transport, camera calibration, scan offsets, and no-go zones', () => {
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
    expect(result.document.profile.scanOffsetCalibrationStatus).toBe('pending');
    expect(result.document.reviewNotes).toContainEqual(
      expect.stringContaining('verification pending'),
    );
    expect(result.document.profile.gcodeDialect.dialectId).toBe('neotronics-4040-safe');
    expect(result.document.profile.streamingMode).toBe('char-counted');
    expect(result.document.profile.rxBufferBytes).toBe(120);
    expect(result.document.profile.controlledLaserOffTravelFeedMmPerMin).toBe(800);
    expect(result.document.profile.baudRate).toBe(250000);
    expect(result.document.profile.cameraModel).toEqual(profileWithCalibration().cameraModel);
    expect(result.document.profile.fireControl).toEqual({ enabled: true, maxPowerPercent: 1.5 });
    expect(result.document.profile.estimateCutTimeScale).toBe(1.18);
    expect(result.document.profile.estimateTravelTimeScale).toBe(1.07);
    expect(result.document.profile.noGoZones).toHaveLength(1);
  });

  it('rejects an invalid bidirectional scan policy', () => {
    expect(deserializeProfilePatch({ bidirectionalScanPolicy: 'guess' })).toEqual({
      kind: 'invalid',
      reason: 'profile.bidirectionalScanPolicy is invalid',
    });
  });

  it('round-trips the optional firmware-trait flags and refuses a junk value', () => {
    // Absent must stay absent, and malformed values must gain no authority.
    const set = deserializeProfilePatch({
      airAssistRestartUnreliable: true,
      workerHostedStreaming: true,
    });
    const junk = deserializeProfilePatch({ airAssistRestartUnreliable: 'yes' });

    if (set.kind !== 'ok' || junk.kind !== 'ok') throw new Error('expected both to parse');
    expect(set.document.profile.airAssistRestartUnreliable).toBe(true);
    expect(set.document.profile.workerHostedStreaming).toBe(true);
    expect(serializeCanonicalDeviceProfile(set.document.profile)).toContain(
      '"airAssistRestartUnreliable": true',
    );
    expect('airAssistRestartUnreliable' in junk.document.profile).toBe(false);
    expect('workerHostedStreaming' in junk.document.profile).toBe(false);
  });

  it('roundtrips pending status and marks statusless imported calibration pending', () => {
    const pending = deserializeProfilePatch({ scanOffsetCalibrationStatus: 'pending' });
    const legacy = deserializeProfilePatch({ scanOffsetCalibrationStatus: undefined });

    expect(pending.kind).toBe('ok');
    if (pending.kind === 'ok') {
      expect(pending.document.profile.scanOffsetCalibrationStatus).toBe('pending');
      expect(JSON.parse(serializeMachineProfileDocument(pending.document)).profile).toMatchObject({
        scanOffsetCalibrationStatus: 'pending',
      });
    }
    expect(legacy.kind).toBe('ok');
    if (legacy.kind === 'ok') {
      expect(legacy.document.profile.scanOffsetCalibrationStatus).toBe('pending');
      expect(legacy.document.reviewNotes).toContainEqual(
        expect.stringContaining('verification pending'),
      );
    }
  });

  it('roundtrips explicit profile streaming settings', () => {
    const original = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: {
        ...profileWithCalibration(),
        streamingMode: 'ping-pong',
        rxBufferBytes: 96,
      },
      source: { kind: 'custom', label: 'Small-buffer bench profile' },
      reviewNotes: [],
    });

    const result = deserializeMachineProfileDocument(original);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.streamingMode).toBe('ping-pong');
    expect(result.document.profile.rxBufferBytes).toBe(96);
  });

  it('roundtrips hybrid output capability and machine-wide CNC settings', () => {
    const profile: DeviceProfile = {
      ...profileWithCalibration(),
      capabilities: [
        ...(profileWithCalibration().capabilities ?? []),
        'laser-output',
        'cnc-output',
      ],
      cncSubProfile: {
        safeZMm: 9,
        spindleMaxRpm: 24000,
        spindleSpinupSec: 4,
        coolant: 'mist',
        parkXMm: 5,
        parkYMm: 390,
      },
    };
    const result = deserializeMachineProfileDocument(
      serializeMachineProfileDocument({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile,
        source: { kind: 'custom', label: 'Hybrid machine' },
        reviewNotes: [],
      }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.capabilities).toEqual(
      expect.arrayContaining(['laser-output', 'cnc-output']),
    );
    expect(result.document.profile.cncSubProfile).toEqual(profile.cncSubProfile);
  });

  it('keeps a malformed imported CNC sub-profile reviewable with disclosed editable recovery', () => {
    const result = deserializeProfilePatch({
      cncSubProfile: {
        safeZMm: 7,
        spindleMaxRpm: 18000,
        spindleSpinupSec: 2,
        coolant: 'liquid-nitrogen',
        parkXMm: 'left',
        parkYMm: 390,
      },
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.cncSubProfile).toEqual({
      safeZMm: 7,
      spindleMaxRpm: 18000,
      spindleSpinupSec: 2,
      coolant: 'off',
      parkYMm: 390,
    });
    expect(result.document.reviewNotes.join(' ')).toContain('profile.cncSubProfile.coolant');
    expect(result.document.reviewNotes.join(' ')).toContain('profile.cncSubProfile.parkXMm');
    expect(result.document.reviewNotes.join(' ')).toContain('Review in Device Setup');
  });

  it('backfills legacy machine profiles without explicit streaming settings', () => {
    const profile = profileWithCalibration();
    const {
      streamingMode: _streamingMode,
      rxBufferBytes: _rxBufferBytes,
      ...legacyProfile
    } = profile;

    const result = deserializeMachineProfileDocument(
      JSON.stringify({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile: legacyProfile,
        source: { kind: 'custom', label: 'Legacy profile' },
        reviewNotes: [],
      }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.streamingMode).toBe('char-counted');
    expect(result.document.profile.rxBufferBytes).toBe(120);
  });

  it('rejects malformed machine profile documents instead of guessing safety data', () => {
    const result = deserializeProfilePatch({
      scanningOffsets: [{ speedMmPerMin: 0, offsetMm: 'bad' }],
    });

    expect(result).toEqual({ kind: 'invalid', reason: 'profile.scanningOffsets is invalid' });
  });

  it('rejects offsets beyond the profile-relative physical safety bound', () => {
    const result = deserializeProfilePatch({
      scanningOffsets: [{ speedMmPerMin: 3000, offsetMm: 1e308 }],
    });

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toMatch(/scanningOffsets/);
  });

  it('rejects malformed machine-profile streaming settings', () => {
    expect(deserializeProfilePatch({ streamingMode: 'burst' })).toEqual({
      kind: 'invalid',
      reason: 'profile.streamingMode is invalid',
    });
    expect(deserializeProfilePatch({ rxBufferBytes: 0 })).toEqual({
      kind: 'invalid',
      reason: 'profile.rxBufferBytes is invalid',
    });
    expect(deserializeProfilePatch({ baudRate: 115200.5 })).toEqual({
      kind: 'invalid',
      reason: 'profile.baudRate must be a positive integer',
    });
    expect(deserializeProfilePatch({ controlledLaserOffTravelFeedMmPerMin: 0 })).toEqual({
      kind: 'invalid',
      reason: 'profile.controlledLaserOffTravelFeedMmPerMin must be positive',
    });
    expect(
      deserializeProfilePatch({
        maxFeed: 1000,
        controlledLaserOffTravelFeedMmPerMin: 1001,
      }),
    ).toEqual({
      kind: 'invalid',
      reason: 'profile.controlledLaserOffTravelFeedMmPerMin must not exceed maxFeed',
    });
    expect(deserializeProfilePatch({ estimateCutTimeScale: 0 })).toEqual({
      kind: 'invalid',
      reason: 'profile.estimateCutTimeScale must be between 0.1 and 5',
    });
    expect(deserializeProfilePatch({ estimateTravelTimeScale: 'fast' })).toEqual({
      kind: 'invalid',
      reason: 'profile.estimateTravelTimeScale must be between 0.1 and 5',
    });
  });

  it('rejects malformed nested machine profile fields before canonicalizing', () => {
    expect(deserializeProfilePatch({ homing: null })).toEqual({
      kind: 'invalid',
      reason: 'profile.homing is invalid',
    });
    expect(deserializeProfilePatch({ capabilities: ['grbl', 'macro-runner'] })).toEqual({
      kind: 'invalid',
      reason: 'profile.capabilities is invalid',
    });
    expect(deserializeProfilePatch({ autofocusCommand: 42 })).toEqual({
      kind: 'invalid',
      reason: 'profile.autofocusCommand must be a string',
    });
    expect(
      deserializeProfilePatch({
        laserSubProfile: {
          ...profileWithCalibration().laserSubProfile,
          technology: 'plasma',
          metadataConfidence: 'guessed',
        },
      }),
    ).toEqual({
      kind: 'invalid',
      reason: 'profile.laserSubProfile is invalid',
    });
    expect(
      deserializeProfilePatch({
        cameraModel: { ...savedCameraModel(), lens: { imageWidth: 1280 } },
      }),
    ).toEqual({
      kind: 'invalid',
      reason: 'profile.cameraModel is invalid',
    });
    expect(
      deserializeProfilePatch({ fireControl: { enabled: true, maxPowerPercent: 50 } }),
    ).toEqual({
      kind: 'invalid',
      reason: 'profile.fireControl is invalid',
    });
  });

  it('imports an older profile without its checkerboard calibration or bed alignment', () => {
    const { cameraModel: _model, ...withoutModel } = profileWithCalibration();
    const result = deserializeMachineProfileDocument(
      JSON.stringify({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile: {
          ...withoutModel,
          cameraCalibration: { imageWidth: 1280 },
          cameraAlignment: { homography: [1, 0, 0] },
        },
        source: { kind: 'custom', label: 'Older KerfDesk' },
        reviewNotes: [],
      }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile).not.toHaveProperty('cameraCalibration');
    expect(result.document.profile).not.toHaveProperty('cameraAlignment');
    expect(result.document.profile.cameraModel).toBeUndefined();
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
