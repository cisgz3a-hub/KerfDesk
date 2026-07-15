import { describe, expect, it } from 'vitest';
import {
  captureControllerWorkZEvidence,
  isWorkZEvidenceCurrentForStart,
} from './work-z-zero-evidence';

describe('controller-readback Work-Z evidence', () => {
  const observedAtMs = 10_000;
  const evidence = captureControllerWorkZEvidence({
    referenceEpoch: 7,
    controllerSessionEpoch: 3,
    toolId: 'tool-1',
    activeWcs: 'G54',
    offsetZMm: -12.5,
    observedAtMs,
  });

  it('remains current for the owned session without a wall-clock expiry', () => {
    expect(isWorkZEvidenceCurrentForStart(evidence, 7, 3)).toBe(true);
    expect(isWorkZEvidenceCurrentForStart(evidence, 8, 3)).toBe(false);
    expect(isWorkZEvidenceCurrentForStart(evidence, 7, 4)).toBe(false);

    const dayOldEvidence = { ...evidence, observedAtMs: observedAtMs - 24 * 60 * 60 * 1000 };
    expect(isWorkZEvidenceCurrentForStart(dayOldEvidence, 7, 3)).toBe(true);
  });
});
