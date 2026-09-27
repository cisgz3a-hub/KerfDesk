import { describe, expect, it } from 'vitest';
import { bedPoint, projectWorldPoint, type CameraPose, type Vec2 } from './camera-model';
import { modelDriftOnMarks, type PhotographedMark } from './model-drift';
import { lookAt, overheadPose, wideLens } from './model-fixtures';

const lens = wideLens(960);
const HEIGHT = 3;

// Rings photographed by a camera at `truth`, each where it really is.
function photographed(truth: CameraPose): PhotographedMark[] {
  const marks: PhotographedMark[] = [];
  for (let y = 25; y <= 385; y += 40) {
    for (let x = 25; x <= 385; x += 40) {
      const pixel = projectWorldPoint(lens, truth, bedPoint(x, y, HEIGHT));
      if (pixel !== null) marks.push({ x, y, pixel, rejected: false });
    }
  }
  return marks;
}

describe('modelDriftOnMarks', () => {
  it('finds no drift when the saved model is the camera that took the photo', () => {
    const drift = modelDriftOnMarks(lens, overheadPose(), photographed(overheadPose()), HEIGHT);
    expect(drift?.rmsMm).toBeLessThan(1e-6);
    expect(drift?.marks).toBeGreaterThan(60);
  });

  it('measures a camera that slid 2 mm as a 2 mm shift of every ring', () => {
    // Every point of a camera looking straight down slides with it.
    const eye = { x: 200, y: 200, z: -400 };
    const saved = lookAt([eye.x, eye.y, eye.z], [eye.x, eye.y + 0.001, 0]);
    const moved = lookAt([eye.x + 2, eye.y, eye.z], [eye.x + 2, eye.y + 0.001, 0]);
    const drift = modelDriftOnMarks(lens, saved, photographed(moved), HEIGHT);
    expect(drift?.rmsMm).toBeCloseTo(2, 1);
    // The saved model still thinks the camera is 2 mm to the left, so it
    // places every ring 2 mm left of where the laser engraved it.
    expect(drift?.meanDxMm).toBeCloseTo(-2, 1);
    expect(Math.abs(drift?.meanDyMm ?? 1)).toBeLessThan(0.05);
  });

  it('ignores rings the new fit rejected and has nothing to say without rings', () => {
    const far: Vec2 = { x: 5, y: 5 };
    const rejected: PhotographedMark = { x: 200, y: 200, pixel: far, rejected: true };
    expect(modelDriftOnMarks(lens, overheadPose(), [rejected], HEIGHT)).toBeNull();
  });
});
