import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, Job } from '../job';
import { cncGrblStrategy } from '../output';
import { buildCncRecoveryEventManifest } from './cnc-recovery-manifest';
import {
  buildCncSupervisedRecoveryJob,
  cncSupervisedRecoveryRunwayProfile,
} from './cnc-supervised-recovery-job';

const sourceGroup: CncGroup = {
  kind: 'cnc',
  layerId: 'profile',
  color: '#000000',
  cutType: 'profile-outside',
  toolId: 'tool-1',
  toolName: '3 mm end mill',
  toolDiameterMm: 3,
  feedMmPerMin: 600,
  plungeMmPerMin: 180,
  spindleRpm: 12_000,
  spindleSpinupSec: 3,
  coolant: 'mist',
  safeZMm: 5,
  passes: [
    {
      kind: 'contour',
      zMm: -1,
      closed: false,
      polyline: [
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 30, y: 10 },
      ],
    },
    {
      kind: 'contour',
      zMm: -2,
      closed: false,
      polyline: [
        { x: 0, y: 10 },
        { x: 30, y: 10 },
      ],
    },
  ],
};

const laterGroup: CncGroup = {
  ...sourceGroup,
  layerId: 'engrave',
  cutType: 'engrave',
  passes: [
    {
      kind: 'contour',
      zMm: -0.5,
      closed: false,
      polyline: [
        { x: 40, y: 10 },
        { x: 50, y: 10 },
      ],
    },
  ],
};

function sourceJob(): Job {
  return { groups: [sourceGroup, laterGroup] };
}

function build(job = sourceJob()) {
  return buildCncSupervisedRecoveryJob({
    job,
    manifest: buildCncRecoveryEventManifest(job),
    uncertaintyEventId: 'cnc-op-1/pass-1/cut-3',
    profile: {
      qualificationId: 'air-cut-2026-07-15',
      minRunwayMm: 12,
      accelerationMmPerSec2: 100,
      safetyMarginMm: 2,
    },
    clearedPathEvidence: {
      kind: 'operator-confirmed-through-event',
      eventId: 'cnc-op-1/pass-1/cut-2',
      proofId: 'review-8',
    },
  });
}

describe('buildCncSupervisedRecoveryJob', () => {
  it('uses a conservative acceleration assumption and requires a qualification reference', () => {
    expect(cncSupervisedRecoveryRunwayProfile(500, ' air-cut-7 ')).toEqual({
      qualificationId: 'air-cut-7',
      minRunwayMm: 5,
      accelerationMmPerSec2: 100,
      safetyMarginMm: 2,
    });
    expect(cncSupervisedRecoveryRunwayProfile(50, 'air-cut-8').accelerationMmPerSec2).toBe(50);
    expect(
      Number.isNaN(cncSupervisedRecoveryRunwayProfile(0, 'air-cut-9').accelerationMmPerSec2),
    ).toBe(true);
  });

  it('re-enters through the cleared tangent and keeps every later pass and operation', () => {
    const result = build();
    expect(result.kind).toBe('recovery-job');
    if (result.kind !== 'recovery-job') throw new Error(`Unexpected ${result.reason}`);

    expect(result.job.groups).toHaveLength(2);
    const first = result.job.groups[0];
    expect(first?.kind).toBe('cnc');
    if (first?.kind !== 'cnc') throw new Error('Expected CNC recovery group.');
    expect(first.passes).toHaveLength(2);
    expect(first.passes[0]).toEqual({
      kind: 'contour',
      zMm: -1,
      closed: false,
      polyline: [
        { x: 8, y: 10 },
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 30, y: 10 },
      ],
    });
    expect(first.passes[1]).toEqual(sourceGroup.passes[1]);
    expect(result.job.groups[1]).toEqual(laterGroup);
  });

  it('emits a fresh-job preamble that retracts before spindle start and plunges only at runway start', () => {
    const result = build();
    if (result.kind !== 'recovery-job') throw new Error(`Unexpected ${result.reason}`);
    const lines = cncGrblStrategy.emit(result.job, DEFAULT_DEVICE_PROFILE).trim().split('\n');
    const retract = lines.indexOf('G0 Z5.000');
    const spindle = lines.indexOf('M3 S12000');
    const moveToRunway = lines.indexOf('G0 X8.000 Y10.000');
    const plunge = lines.indexOf('G1 Z-1.000 F180');
    const uncertainty = lines.indexOf('G1 X30.000 Y10.000 F600');

    expect(retract).toBeGreaterThan(-1);
    expect(spindle).toBeGreaterThan(retract);
    expect(moveToRunway).toBeGreaterThan(spindle);
    expect(plunge).toBeGreaterThan(moveToRunway);
    expect(uncertainty).toBeGreaterThan(plunge);
  });

  it('fails closed when the selected path is not explicitly confirmed clear', () => {
    const job = sourceJob();
    const result = buildCncSupervisedRecoveryJob({
      job,
      manifest: buildCncRecoveryEventManifest(job),
      uncertaintyEventId: 'cnc-op-1/pass-1/cut-3',
      profile: {
        qualificationId: 'air-cut-2026-07-15',
        minRunwayMm: 12,
        accelerationMmPerSec2: 100,
        safetyMarginMm: 2,
      },
      clearedPathEvidence: {
        kind: 'operator-confirmed-through-event',
        eventId: 'cnc-op-1/pass-1/cut-1',
        proofId: 'review-8',
      },
    });
    expect(result).toEqual({ kind: 'error', reason: 'cleared-path-unproved' });
  });
});
