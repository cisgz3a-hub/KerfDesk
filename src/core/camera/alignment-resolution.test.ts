import { describe, expect, it } from 'vitest';
import type { CameraAlignment } from './camera-alignment';
import type { Mat3 } from './homography';
import { applyHomography } from './homography';
import { alignmentMatchesFrame, scaleAlignmentHomographyToFrame } from './alignment-resolution';

// A non-trivial homography (mild perspective) solved at 1280×960.
const H: Mat3 = [0.1, 0, 5, 0, 0.1, 3, 0.0001, 0.0002, 1];
const alignment: CameraAlignment = {
  homography: H,
  frameWidth: 1280,
  frameHeight: 960,
  basis: 'raw',
  alignedAt: 0,
};

describe('alignmentMatchesFrame', () => {
  it('is true only at the solved resolution', () => {
    expect(alignmentMatchesFrame(alignment, 1280, 960)).toBe(true);
    expect(alignmentMatchesFrame(alignment, 640, 480)).toBe(false);
  });
});

describe('scaleAlignmentHomographyToFrame', () => {
  it('maps an off-resolution pixel to the SAME bed-mm as the solved map', () => {
    // A 640×480 frame is half-scale; solved pixel (400,300) is now pixel (200,150).
    const scaled = scaleAlignmentHomographyToFrame(alignment, 640, 480);
    const solvedBed = applyHomography(H, { x: 400, y: 300 });
    const actualBed = applyHomography(scaled, { x: 200, y: 150 });

    expect(actualBed.x).toBeCloseTo(solvedBed.x, 9);
    expect(actualBed.y).toBeCloseTo(solvedBed.y, 9);
  });

  it('would NOT match if the ratio were inverted (guards the actual/solved trap)', () => {
    // Sanity: the inverse ratio (0.5x) maps (200,150) to H·(100,75), a different
    // bed point — proving the test is sensitive to the solved/actual direction.
    const scaled = scaleAlignmentHomographyToFrame(alignment, 640, 480);
    const wrong = applyHomography(H, { x: 100, y: 75 });
    const actual = applyHomography(scaled, { x: 200, y: 150 });
    expect(actual.x).not.toBeCloseTo(wrong.x, 3);
  });

  it('returns the solved homography unchanged at the exact resolution', () => {
    expect(scaleAlignmentHomographyToFrame(alignment, 1280, 960)).toBe(H);
  });

  it('returns the solved homography for a non-positive frame size', () => {
    expect(scaleAlignmentHomographyToFrame(alignment, 0, 480)).toBe(H);
  });
});
