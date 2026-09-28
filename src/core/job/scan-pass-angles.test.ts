import { describe, expect, it } from 'vitest';
import { fillHatchPassRuns, imageScanPassRuns, passAngleStepApplies } from './scan-pass-angles';

describe('scan pass angles (ADR-492)', () => {
  it('keeps one run with every pass when nothing asks for more angles', () => {
    expect(imageScanPassRuns({ passes: 3 })).toEqual([{ angleDeg: 0, passes: 3 }]);
    expect(imageScanPassRuns({ passes: 2, imageScanAngleDeg: 225 })).toEqual([
      { angleDeg: 45, passes: 2 },
    ]);
    expect(fillHatchPassRuns({ passes: 4, hatchAngleDeg: 30 })).toEqual([
      { angleDeg: 30, passes: 4 },
    ]);
  });

  it('ignores a step on a single pass and a step that turns a whole half turn', () => {
    expect(passAngleStepApplies({ passes: 1, passAngleStepDeg: 45 })).toBe(false);
    expect(passAngleStepApplies({ passes: 3, passAngleStepDeg: 180 })).toBe(false);
    expect(passAngleStepApplies({ passes: 3, passAngleStepDeg: 0 })).toBe(false);
    expect(passAngleStepApplies({ passes: 3, passAngleStepDeg: -30 })).toBe(true);
    expect(fillHatchPassRuns({ passes: 3, hatchAngleDeg: 10, passAngleStepDeg: 180 })).toEqual([
      { angleDeg: 10, passes: 3 },
    ]);
  });

  it('turns each pass by the step, folded into one half turn', () => {
    expect(fillHatchPassRuns({ passes: 4, hatchAngleDeg: 0, passAngleStepDeg: 60 })).toEqual([
      { angleDeg: 0, passes: 1 },
      { angleDeg: 60, passes: 1 },
      { angleDeg: 120, passes: 1 },
      { angleDeg: 0, passes: 1 },
    ]);
    expect(imageScanPassRuns({ passes: 2, imageScanAngleDeg: 10, passAngleStepDeg: -20 })).toEqual([
      { angleDeg: 10, passes: 1 },
      { angleDeg: 170, passes: 1 },
    ]);
  });

  it('adds a crossing pass at +90 degrees for every image pass with cross-hatch', () => {
    expect(imageScanPassRuns({ passes: 2, imageScanAngleDeg: 30, imageCrossHatch: true })).toEqual([
      { angleDeg: 30, passes: 1 },
      { angleDeg: 120, passes: 1 },
      { angleDeg: 30, passes: 1 },
      { angleDeg: 120, passes: 1 },
    ]);
  });

  it('merges consecutive passes that land on the same angle', () => {
    expect(fillHatchPassRuns({ passes: 3, hatchAngleDeg: 0, passAngleStepDeg: 90 })).toEqual([
      { angleDeg: 0, passes: 1 },
      { angleDeg: 90, passes: 1 },
      { angleDeg: 0, passes: 1 },
    ]);
    expect(
      imageScanPassRuns({
        passes: 2,
        imageScanAngleDeg: 0,
        imageCrossHatch: true,
        passAngleStepDeg: 90,
      }),
    ).toEqual([
      { angleDeg: 0, passes: 1 },
      { angleDeg: 90, passes: 2 },
      { angleDeg: 0, passes: 1 },
    ]);
  });
});
