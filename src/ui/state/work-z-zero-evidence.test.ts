import { describe, expect, it } from 'vitest';
import {
  captureControllerWorkZEvidence,
  CONTROLLER_WORK_Z_FRESHNESS_MS,
  isWorkZEvidenceFreshForStart,
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

  it('is current only inside the owned session and freshness window', () => {
    expect(isWorkZEvidenceFreshForStart(evidence, 7, 3, observedAtMs + 1)).toBe(true);
    expect(isWorkZEvidenceFreshForStart(evidence, 7, 4, observedAtMs + 1)).toBe(false);
    expect(
      isWorkZEvidenceFreshForStart(
        evidence,
        7,
        3,
        observedAtMs + CONTROLLER_WORK_Z_FRESHNESS_MS + 1,
      ),
    ).toBe(false);
  });
});
