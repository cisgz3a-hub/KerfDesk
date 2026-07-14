import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../job';
import { previewCncContourRunway } from './cnc-contour-runway-preview';
import { buildCncRecoveryEventManifest } from './cnc-recovery-manifest';

function contourJob(): Job {
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
        zMm: -2,
        closed: false,
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 10 },
        ],
      },
    ],
  };
  return { groups: [group] };
}

const parameters = {
  minRunwayMm: 12,
  accelerationMmPerSec2: 100,
  safetyMarginMm: 2,
};

describe('previewCncContourRunway', () => {
  it('refuses illustrative runway geometry that turns immediately before re-entry', () => {
    const job = contourJob();
    const result = previewCncContourRunway({
      job,
      manifest: buildCncRecoveryEventManifest(job),
      uncertaintyEventId: 'cnc-op-1/pass-1/cut-3',
      parameters,
    });
    expect(result).toEqual({
      kind: 'error',
      reason: 'non-tangent-runway',
      requiredRunwayMm: 12,
      availableClearedMm: 0,
    });
  });

  it('refuses a first segment because no preceding runway exists', () => {
    const job = contourJob();
    expect(
      previewCncContourRunway({
        job,
        manifest: buildCncRecoveryEventManifest(job),
        uncertaintyEventId: 'cnc-op-1/pass-1/cut-1',
        parameters,
      }),
    ).toEqual({ kind: 'error', reason: 'first-segment-has-no-runway' });
  });

  it('rejects a forged manifest event', () => {
    const job = contourJob();
    const manifest = buildCncRecoveryEventManifest(job);
    const forged = {
      ...manifest,
      events: manifest.events.map((event) =>
        event.id === 'cnc-op-1/pass-1/cut-3' ? { ...event, toolKey: 'forged' } : event,
      ),
    };
    expect(
      previewCncContourRunway({
        job,
        manifest: forged,
        uncertaintyEventId: 'cnc-op-1/pass-1/cut-3',
        parameters,
      }),
    ).toEqual({ kind: 'error', reason: 'source-mismatch' });
  });
});
