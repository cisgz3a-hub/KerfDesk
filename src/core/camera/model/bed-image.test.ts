import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../rgba-image';
import { bedPoint, projectWorldPoint } from './camera-model';
import { warpFrameToBedImage } from './bed-image';
import { overheadPose, wideLens } from './model-fixtures';

const lens = wideLens(640);
const pose = overheadPose();

// Red and green encode the camera pixel, so the warped image says which
// camera pixel each bed pixel was read from.
function coordinateFrame(): RgbaImage {
  const { imageWidth: width, imageHeight: height } = lens;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      data[at] = (x / (width - 1)) * 255;
      data[at + 1] = (y / (height - 1)) * 255;
      data[at + 3] = 255;
    }
  }
  return { data, width, height };
}

function inFrame(p: { readonly x: number; readonly y: number }): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= lens.imageWidth - 1 && p.y <= lens.imageHeight - 1;
}

function expectPixelReadFrom(
  image: RgbaImage,
  at: number,
  truth: { readonly x: number; readonly y: number },
): void {
  expect(image.data[at + 3]).toBe(255);
  expect(Math.abs((image.data[at] ?? 0) - (truth.x / (lens.imageWidth - 1)) * 255)).toBeLessThan(
    1.5,
  );
  expect(
    Math.abs((image.data[at + 1] ?? 0) - (truth.y / (lens.imageHeight - 1)) * 255),
  ).toBeLessThan(1.5);
}

describe('warpFrameToBedImage', () => {
  const frame = coordinateFrame();

  it.each([0, 15])('reads each bed point from the camera pixel that sees it at %i mm', (height) => {
    const pixelsPerMm = 0.5;
    const image = warpFrameToBedImage(frame, lens, pose, {
      bedWidthMm: 400,
      bedHeightMm: 400,
      pixelsPerMm,
      surfaceHeightMm: height,
    });
    expect(image?.width).toBe(200);
    if (image === null) return;
    let checked = 0;
    for (let y = 3; y < 200; y += 17) {
      for (let x = 5; x < 200; x += 19) {
        const truth = projectWorldPoint(
          lens,
          pose,
          bedPoint((x + 0.5) / pixelsPerMm, (y + 0.5) / pixelsPerMm, height),
        );
        if (truth === null || !inFrame(truth)) continue;
        checked += 1;
        expectPixelReadFrom(image, (y * 200 + x) * 4, truth);
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it('leaves bed points the frame does not cover transparent', () => {
    // A 100 × 100 px frame: the camera sees the bed centre beyond its edge.
    const corner: RgbaImage = { data: frame.data.slice(0, 100 * 100 * 4), width: 100, height: 100 };
    const image = warpFrameToBedImage(corner, lens, pose, {
      bedWidthMm: 400,
      bedHeightMm: 400,
      pixelsPerMm: 0.1,
      surfaceHeightMm: 0,
    });
    const centre = (20 * 40 + 20) * 4;
    expect(image?.data[centre + 3]).toBe(0);
  });

  it('returns null for an empty output', () => {
    const empty = warpFrameToBedImage(frame, lens, pose, {
      bedWidthMm: 0,
      bedHeightMm: 400,
      pixelsPerMm: 4,
      surfaceHeightMm: 0,
    });
    expect(empty).toBeNull();
  });
});
