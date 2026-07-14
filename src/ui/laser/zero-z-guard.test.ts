import { describe, expect, it } from 'vitest';
import type { WorkZZeroEvidence } from '../state/work-z-zero-evidence';
import {
  currentWorkZMm,
  ZERO_Z_OVERWRITE_WARNING_THRESHOLD_MM,
  zeroZOverwriteWarning,
} from './zero-z-guard';

const EPOCH = 4;
const probeEvidence: WorkZZeroEvidence = {
  source: 'probe',
  referenceEpoch: EPOCH,
  probePlateRemoved: true,
};
const manualEvidence: WorkZZeroEvidence = { source: 'manual-zero', referenceEpoch: EPOCH };

describe('zeroZOverwriteWarning', () => {
  it('stays silent for a first-time zero (no current evidence)', () => {
    expect(
      zeroZOverwriteWarning({ evidence: null, referenceEpoch: EPOCH, workZMm: 20 }),
    ).toBeNull();
  });

  it('stays silent when the evidence belongs to a stale reference epoch', () => {
    expect(
      zeroZOverwriteWarning({ evidence: probeEvidence, referenceEpoch: EPOCH + 1, workZMm: 20 }),
    ).toBeNull();
  });

  // The reported bug: probe parks the bit at plateThickness+retract (~20 mm),
  // the Start gate pushes the operator to Zero Z, and one click moved Z0 20 mm
  // into the air with no warning.
  it('warns before overwriting a probed zero from the post-probe park height', () => {
    const warning = zeroZOverwriteWarning({
      evidence: probeEvidence,
      referenceEpoch: EPOCH,
      workZMm: 20,
    });
    expect(warning).toContain('a touch-plate probe');
    expect(warning).toContain('20.0 mm above');
    expect(warning).toContain('cut 20.0 mm in the air');
  });

  it('warns before overwriting a manual zero from the post-frame safe-Z park', () => {
    const warning = zeroZOverwriteWarning({
      evidence: manualEvidence,
      referenceEpoch: EPOCH,
      workZMm: 3.81,
    });
    expect(warning).toContain('Zero Z');
    expect(warning).toContain('3.8 mm above');
  });

  it('names the below-zero direction when the bit sits under the old zero', () => {
    const warning = zeroZOverwriteWarning({
      evidence: manualEvidence,
      referenceEpoch: EPOCH,
      workZMm: -2,
    });
    expect(warning).toContain('2.0 mm below');
    expect(warning).toContain('too deep');
  });

  it('treats a bit within the threshold of the old zero as a silent correction', () => {
    expect(
      zeroZOverwriteWarning({
        evidence: probeEvidence,
        referenceEpoch: EPOCH,
        workZMm: ZERO_Z_OVERWRITE_WARNING_THRESHOLD_MM,
      }),
    ).toBeNull();
  });

  it('defends a probed zero even when the current height is unknown', () => {
    const warning = zeroZOverwriteWarning({
      evidence: probeEvidence,
      referenceEpoch: EPOCH,
      workZMm: null,
    });
    expect(warning).toContain('height is unknown');
    expect(warning).toContain('Replace the probed work zero?');
  });

  it('stays silent for a manual zero when the current height is unknown', () => {
    expect(
      zeroZOverwriteWarning({ evidence: manualEvidence, referenceEpoch: EPOCH, workZMm: null }),
    ).toBeNull();
  });
});

describe('currentWorkZMm', () => {
  it('reads WPos directly when reported', () => {
    expect(currentWorkZMm({ wPos: { x: 1, y: 2, z: 7.5 }, mPos: null }, null)).toBe(7.5);
  });

  it('derives work Z from MPos minus the cached work offset', () => {
    expect(
      currentWorkZMm({ wPos: null, mPos: { x: 0, y: 0, z: -10 } }, { x: 0, y: 0, z: -30 }),
    ).toBe(20);
  });

  it('is unknowable from MPos without a cached offset, or with no report', () => {
    expect(currentWorkZMm({ wPos: null, mPos: { x: 0, y: 0, z: -10 } }, null)).toBeNull();
    expect(currentWorkZMm(null, { x: 0, y: 0, z: -30 })).toBeNull();
  });
});
