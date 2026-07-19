import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { LaserState } from '../laser-store';
import {
  computeExecutionProvenanceEnvelopeSha256,
  createExecutionProvenance,
  isExecutionProvenance,
  sha256Utf8,
} from './execution-provenance';
import { ordinaryExecutionEvidence } from './execution-workflow-evidence';

const ARCHIVED_OBSERVATION = {
  settings: { laserModeEnabled: true, maxPowerS: 1000 },
  observedAtIso: '2026-07-19T03:00:00.000Z',
  wco: { x: 1, y: 2, z: 3 },
  overrides: { feed: 100, rapid: 100, spindle: 100 },
} as const;

describe('execution provenance', () => {
  it('hashes the exact UTF-8 G-code bytes with portable SHA-256', async () => {
    await expect(sha256Utf8('abc')).resolves.toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('captures build, profile, transport, controller, settings, and exact review evidence', async () => {
    const profile = {
      ...DEFAULT_DEVICE_PROFILE,
      profileId: 'test-profile',
      profileSource: 'custom' as const,
      scanningOffsets: [
        { speedMmPerMin: 5000, offsetMm: 0.2 },
        { speedMmPerMin: 1000, offsetMm: 0.04 },
      ],
    };
    const laser = {
      capabilities: { transport: 'serial' },
      serialPortInfo: { usbVendorId: 0x1a86, usbProductId: 0x7523 },
      controllerSessionEpoch: 9,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'fluidnc',
      controllerQualification: { kind: 'qualified', epoch: 9, settings: 'verified' },
      controllerBuildInfo: null,
      controllerBuildInfoRawLines: ['[VER:non-stock]'],
      controllerBuildInfoObservation: { sessionEpoch: 9, observedAt: 1234 },
      controllerSettingsObservation: { sessionEpoch: 9, observedAt: 1200 },
      grblSettingsRows: [{ code: '$32', rawValue: '1' }],
    } as unknown as LaserState;

    const provenance = await createExecutionProvenance({
      gcode: 'G21\nM5\n',
      profile,
      laser,
      archivedControllerObservation: ARCHIVED_OBSERVATION,
      ...ordinaryExecutionEvidence({
        reviewedAtIso: '2026-07-19T03:00:00.000Z',
        warningsShown: ['Check the calibration coupon.'],
        acknowledgement: { kind: 'laser-unverified', prompt: 'Confirm $32.' },
        laserModeStartEvidence: {
          controllerSessionEpoch: 9,
          settingsCapability: 'grbl-dollar',
          settingsObservation: { sessionEpoch: 9, observedAt: 1200 },
          laserModeEnabled: true,
          maxPowerS: 1000,
          controllerBuildInfo: null,
          buildInfoObservation: { sessionEpoch: 9, observedAt: 1234 },
          expectedMaxPowerS: 1000,
          m7Required: false,
          unverifiedAcknowledged: true,
        },
      }),
    });

    expect(provenance.build).toMatchObject({ gitSha: expect.any(String) });
    expect(provenance.content).toMatchObject({
      profileId: 'test-profile',
      profileName: profile.name,
      gcodeSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      canonicalProfileSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(provenance.transport.serialPortInfo).toEqual({
      usbVendorId: 0x1a86,
      usbProductId: 0x7523,
    });
    expect(provenance.controller).toMatchObject({
      sessionEpoch: 9,
      activeKind: 'grbl-v1.1',
      detectedKind: 'fluidnc',
      buildInfo: {
        parsed: null,
        rawLines: ['[VER:non-stock]'],
        observation: { sessionEpoch: 9, observedAt: 1234 },
      },
      settingsRows: [{ code: '$32', rawValue: '1' }],
    });
    expect(provenance.review).toMatchObject({
      warningsShown: ['Check the calibration coupon.'],
      acknowledgement: { kind: 'laser-unverified', prompt: 'Confirm $32.' },
      laserModeStartEvidence: { unverifiedAcknowledged: true },
    });
    expect(provenance.workflow).toEqual({ kind: 'ordinary-start' });
    expect(provenance.archivedControllerObservationSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(provenance.envelopeSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(isExecutionProvenance(provenance)).toBe(true);
  });

  it('canonicalizes profile table and provenance property ordering before hashing', async () => {
    const baseLaser = {
      capabilities: { transport: 'serial' },
      controllerSessionEpoch: 1,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: null,
      controllerQualification: { kind: 'qualified', epoch: 1, settings: 'verified' },
      controllerBuildInfo: null,
      controllerBuildInfoRawLines: [],
      controllerBuildInfoObservation: null,
      controllerSettingsObservation: null,
      grblSettingsRows: [],
    } as unknown as LaserState;
    const common = {
      gcode: 'M5\n',
      laser: baseLaser,
      archivedControllerObservation: ARCHIVED_OBSERVATION,
      ...ordinaryExecutionEvidence({
        reviewedAtIso: '2026-07-19T03:00:00.000Z',
        warningsShown: [],
        acknowledgement: { kind: 'laser-verified' },
        laserModeStartEvidence: {
          controllerSessionEpoch: 1,
          settingsCapability: 'grbl-dollar',
          settingsObservation: null,
          laserModeEnabled: undefined,
          maxPowerS: undefined,
          controllerBuildInfo: null,
          buildInfoObservation: null,
          expectedMaxPowerS: 1000,
          m7Required: false,
          unverifiedAcknowledged: false,
        },
      }),
    };
    const left = await createExecutionProvenance({
      ...common,
      profile: {
        ...DEFAULT_DEVICE_PROFILE,
        scanningOffsets: [
          { speedMmPerMin: 5000, offsetMm: 0.2 },
          { speedMmPerMin: 1000, offsetMm: 0.04 },
        ],
      },
    });
    const right = await createExecutionProvenance({
      ...common,
      profile: {
        ...DEFAULT_DEVICE_PROFILE,
        scanningOffsets: [
          { speedMmPerMin: 1000, offsetMm: 0.04 },
          { speedMmPerMin: 5000, offsetMm: 0.2 },
        ],
      },
    });
    expect(left.content.canonicalProfileSha256).toBe(right.content.canonicalProfileSha256);
    const observationSha256 = left.archivedControllerObservationSha256;
    if (observationSha256 === undefined) throw new Error('Expected current observation binding.');
    const reorderedEnvelope = {
      review: reverseRecordOrder(left.review),
      workflow: reverseRecordOrder(left.workflow),
      controller: reverseRecordOrder(left.controller),
      transport: reverseRecordOrder(left.transport),
      content: reverseRecordOrder(left.content),
      build: reverseRecordOrder(left.build),
      archivedControllerObservationSha256: observationSha256,
      schemaVersion: left.schemaVersion,
    };
    await expect(computeExecutionProvenanceEnvelopeSha256(reorderedEnvelope)).resolves.toBe(
      left.envelopeSha256,
    );
    const jsonRoundTrip = JSON.parse(JSON.stringify(left)) as typeof left;
    await expect(computeExecutionProvenanceEnvelopeSha256(jsonRoundTrip)).resolves.toBe(
      left.envelopeSha256,
    );
  });
});

function reverseRecordOrder<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T;
}
