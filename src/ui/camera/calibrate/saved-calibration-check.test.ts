import { describe, expect, it } from 'vitest';
import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import { bedPoint, projectWorldPoint } from '../../../core/camera/model/camera-model';
import type { PhotographedMark } from '../../../core/camera/model/model-drift';
import { lookAt, savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { checkSavedCalibration, savedCalibrationVerdict } from './saved-calibration-check';

const capture: CameraCaptureBinding = {
  version: 1,
  sourceKind: 'usb',
  sourceId: 'overhead',
  width: 1280,
  height: 720,
  resizeMode: 'none',
};
const saved = savedCameraModel(capture);

function photographedBy(pose: typeof saved.pose): PhotographedMark[] {
  const marks: PhotographedMark[] = [];
  for (let y = 25; y <= 385; y += 40) {
    for (let x = 25; x <= 385; x += 40) {
      const pixel = projectWorldPoint(saved.lens, pose, bedPoint(x, y, 3));
      if (pixel !== null) marks.push({ x, y, pixel, rejected: false });
    }
  }
  return marks;
}

function check(marks: ReadonlyArray<PhotographedMark>, binding = capture) {
  return checkSavedCalibration({
    saved,
    capture: binding,
    frameWidth: binding.width,
    frameHeight: binding.height,
    marks,
    targetHeightMm: 3,
  });
}

describe('checkSavedCalibration', () => {
  it('says the camera has not moved when the saved model still fits the rings', () => {
    const result = check(photographedBy(saved.pose));
    expect(result.kind).toBe('measured');
    if (result.kind !== 'measured') return;
    expect(savedCalibrationVerdict(result)).toMatchObject({
      moved: false,
      headline: 'The camera has not moved since it was calibrated.',
    });
  });

  it('says how far and which way the picture is off when the camera has moved', () => {
    const [cx, cy, cz] = [200, 200, -400] as const;
    const straight = { ...saved, pose: lookAt([cx, cy, cz], [cx, cy + 0.001, 0]) };
    const moved = lookAt([cx, cy + 3, cz], [cx, cy + 3.001, 0]);
    const result = checkSavedCalibration({
      saved: straight,
      capture,
      frameWidth: 1280,
      frameHeight: 720,
      marks: photographedBy(moved),
      targetHeightMm: 3,
    });
    expect(result.kind).toBe('measured');
    if (result.kind !== 'measured') return;
    const verdict = savedCalibrationVerdict(result);
    expect(verdict.moved).toBe(true);
    expect(verdict.headline).toBe('The saved calibration is off by about 3.0 mm.');
    expect(verdict.detail).toContain('3.0 mm higher');
  });

  it('does not compare a photo from another camera', () => {
    const result = check(photographedBy(saved.pose), { ...capture, sourceId: 'lid' });
    expect(result).toEqual({
      kind: 'not-comparable',
      message: expect.stringContaining('belongs to a different camera'),
    });
  });
});
