import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../job';
import { buildCncRecoveryEventManifest } from './cnc-recovery-manifest';
import type { CncContourRunwayPlan, CncRunwayProfile } from './cnc-contour-runway';
import type {
  CncRecoveryPackageInput,
  CncSupervisedRecoveryPackageInput,
} from './cnc-recovery-package';
import {
  cncRecoveryPackageIdentitiesEqual,
  createCncRecoveryPackageIdentity,
  createCncSupervisedRecoveryPackageIdentity,
} from './cnc-recovery-package';
const group: CncGroup = {
  kind: 'cnc',
  layerId: 'layer-a',
  color: '#000000',
  cutType: 'profile-outside',
  toolId: 'tool-1',
  toolDiameterMm: 3.175,
  feedMmPerMin: 600,
  plungeMmPerMin: 180,
  spindleRpm: 12_000,
  spindleSpinupSec: 3,
  safeZMm: 5,
  passes: [
    {
      kind: 'contour',
      zMm: -1,
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    },
  ],
};
const job: Job = { groups: [group] };
const manifest = buildCncRecoveryEventManifest(job);
const input: CncRecoveryPackageInput = {
  job,
  gcode: 'G21\nG90\nM5\n',
  manifest,
  lineSpans: [{ eventId: 'cnc-op-1/pass-1/cut-1', firstRawLine: 2, lastRawLine: 2 }],
  emitterRevision: 'cnc-grbl-v1',
  machineProfileFingerprint: 'machine:4040',
  toolPlanFingerprint: 'tool:3.175-endmill',
  wcsFingerprint: 'G54:x0:y0:z0',
  jobOriginFingerprint: 'absolute',
  stockFingerprint: 'stock:300x200x12',
  fixtureFingerprint: 'clamps:v2',
};

async function identityFor(value: CncRecoveryPackageInput): Promise<string> {
  const result = await createCncRecoveryPackageIdentity(value);
  expect(result.kind).toBe('ok');
  return result.kind === 'ok' ? result.identity.digest : '';
}

describe('createCncRecoveryPackageIdentity', () => {
  it('creates a deterministic SHA-256 identity', async () => {
    const first = await createCncRecoveryPackageIdentity(input);
    const second = await createCncRecoveryPackageIdentity(input);
    expect(first).toEqual(second);
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok' || second.kind !== 'ok') return;
    expect(first.identity.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(cncRecoveryPackageIdentitiesEqual(first.identity, second.identity)).toBe(true);
  });

  it('changes when any safety-bound package field changes', async () => {
    const original = await identityFor(input);
    const mutations: ReadonlyArray<CncRecoveryPackageInput> = [
      { ...input, gcode: `${input.gcode}; changed` },
      { ...input, emitterRevision: 'cnc-grbl-v2' },
      { ...input, machineProfileFingerprint: 'machine:other' },
      { ...input, toolPlanFingerprint: 'tool:6mm-endmill' },
      { ...input, wcsFingerprint: 'G54:x1:y0:z0' },
      { ...input, jobOriginFingerprint: 'current-position:10,20' },
      { ...input, stockFingerprint: 'stock:300x200x18' },
      { ...input, fixtureFingerprint: 'clamps:v3' },
      {
        ...input,
        lineSpans: [{ eventId: 'cnc-op-1/pass-1/cut-1', firstRawLine: 3, lastRawLine: 3 }],
      },
    ];
    for (const mutation of mutations) expect(await identityFor(mutation)).not.toBe(original);
  });

  it('refuses to hash an invalid or incomplete line sidecar', async () => {
    await expect(createCncRecoveryPackageIdentity({ ...input, lineSpans: [] })).resolves.toEqual({
      kind: 'error',
      reason: 'invalid-line-map',
    });
    await expect(
      createCncRecoveryPackageIdentity({
        ...input,
        lineSpans: [{ eventId: 'missing', firstRawLine: 2, lastRawLine: 2 }],
      }),
    ).resolves.toEqual({ kind: 'error', reason: 'invalid-line-map' });
  });

  it('refuses a manifest that was not canonically rebuilt from the exact job', async () => {
    const forgedManifest = {
      ...manifest,
      events: manifest.events.map((event) =>
        event.intent === 'cut' ? { ...event, toolKey: 'forged-tool' } : event,
      ),
    };
    await expect(
      createCncRecoveryPackageIdentity({ ...input, manifest: forgedManifest }),
    ).resolves.toEqual({ kind: 'error', reason: 'invalid-manifest' });
  });
});

const supervisedPlan: CncContourRunwayPlan = {
  kind: 'review-plan',
  executable: false,
  eventId: 'cnc-op-1/pass-1/cut-3',
  operationId: 'cnc-op-1',
  passId: 'cnc-op-1/pass-1',
  requiredRunwayMm: 12,
  availableClearedMm: 20,
  runwayPolyline: [
    { x: 8, y: 0 },
    { x: 20, y: 0 },
  ],
  recoveryPolyline: [
    { x: 8, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ],
  uncertaintyStartPointIndex: 1,
  source: { groupIndex: 0, passIndex: 0, segmentIndex: 2 },
  motion: {
    cutZMm: -2,
    safeZMm: 5,
    feedMmPerMin: 600,
    plungeMmPerMin: 180,
    spindleRpm: 12_000,
    spindleSpinupSec: 3,
    coolant: 'off',
    toolKey: 'tool-1',
  },
};
const supervisedProfile: CncRunwayProfile = {
  qualificationId: 'air-cut-2026-07-15',
  minRunwayMm: 5,
  accelerationMmPerSec2: 100,
  safetyMarginMm: 2,
};
const supervisedInput: CncSupervisedRecoveryPackageInput = {
  sourceGcode: 'G21\nG90\nG54\nM3 S12000\n',
  recoveryGcode: 'G21\nG90\nG54\nG0 Z5\nM3 S12000\n',
  plan: supervisedPlan,
  profile: supervisedProfile,
  reviewId: 'review-8',
  clearedPathProofId: 'review-8/cleared-through-cut-2',
  completedPrefixProofId: 'review-8/complete-before-cut-3',
};

async function supervisedIdentity(value: CncSupervisedRecoveryPackageInput): Promise<string> {
  const result = await createCncSupervisedRecoveryPackageIdentity(value);
  expect(result.kind).toBe('ok');
  return result.kind === 'ok' ? result.identity.digest : '';
}

describe('createCncSupervisedRecoveryPackageIdentity', () => {
  it('binds the original program, generated recovery program, semantic plan, and qualification', async () => {
    const first = await supervisedIdentity(supervisedInput);
    const second = await supervisedIdentity(supervisedInput);
    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('changes when any execution-critical recovery field changes', async () => {
    const original = await supervisedIdentity(supervisedInput);
    const mutations: ReadonlyArray<CncSupervisedRecoveryPackageInput> = [
      { ...supervisedInput, sourceGcode: `${supervisedInput.sourceGcode}; changed` },
      { ...supervisedInput, recoveryGcode: `${supervisedInput.recoveryGcode}; changed` },
      {
        ...supervisedInput,
        plan: { ...supervisedPlan, eventId: 'cnc-op-1/pass-1/cut-4' },
      },
      {
        ...supervisedInput,
        profile: { ...supervisedProfile, qualificationId: 'different-air-cut' },
      },
      { ...supervisedInput, reviewId: 'different-review' },
      { ...supervisedInput, clearedPathProofId: 'different-review' },
      { ...supervisedInput, completedPrefixProofId: 'different-prefix-proof' },
    ];
    for (const mutation of mutations) {
      expect(await supervisedIdentity(mutation)).not.toBe(original);
    }
  });
});
