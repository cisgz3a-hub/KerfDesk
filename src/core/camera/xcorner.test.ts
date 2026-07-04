import { describe, expect, it } from 'vitest';
import type { GrayImage } from './corner-subpix';
import { findCornerCandidates } from './xcorner';

// A hand-built frame: four checker quadrants meeting at (cx, cy) form a true
// X-corner; a horizontal step edge along y = ey does not.
function checkerQuadFrame(width: number, height: number, cx: number, cy: number): GrayImage {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dark = x < cx !== y < cy;
      data[y * width + x] = dark ? 20 : 240;
    }
  }
  return { data, width, height };
}

function edgeFrame(width: number, height: number, ey: number): GrayImage {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = y < ey ? 20 : 240;
    }
  }
  return { data, width, height };
}

describe('findCornerCandidates', () => {
  it('finds the X-corner of four meeting checker quadrants', () => {
    const img = checkerQuadFrame(41, 41, 20, 20);
    const candidates = findCornerCandidates(img);
    expect(candidates.length).toBeGreaterThan(0);
    const best = candidates[0];
    expect(best).toBeDefined();
    // The response peak sits within a couple of pixels of the true corner
    // (integer stage; sub-pixel refinement is a separate pass).
    expect(Math.hypot((best?.x ?? 0) - 20, (best?.y ?? 0) - 20)).toBeLessThanOrEqual(2);
  });

  it('does not fire on a plain step edge', () => {
    const candidates = findCornerCandidates(edgeFrame(41, 41, 20));
    expect(candidates).toHaveLength(0);
  });

  it('returns nothing for a flat frame', () => {
    const data = new Float32Array(41 * 41).fill(128);
    expect(findCornerCandidates({ data, width: 41, height: 41 })).toHaveLength(0);
  });

  it('is deterministic', () => {
    const img = checkerQuadFrame(41, 41, 20, 20);
    expect(findCornerCandidates(img)).toEqual(findCornerCandidates(img));
  });
});
