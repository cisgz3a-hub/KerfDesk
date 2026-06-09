import { describe, expect, it } from 'vitest';

import type { ColoredPath } from '../scene';
import type { RawImageData } from './trace-image';
import {
  cropRawImageData,
  normalizeTraceBoundary,
  offsetBounds,
  offsetColoredPaths,
} from './trace-boundary';

describe('trace boundary helpers', () => {
  it('clamps and rounds a dragged boundary to the image pixel grid', () => {
    expect(normalizeTraceBoundary({ x: 1.2, y: -2, width: 3.7, height: 5.4 }, 4, 3)).toEqual({
      x: 1,
      y: 0,
      width: 3,
      height: 3,
    });
  });

  it('rejects empty or fully out-of-bounds boundaries', () => {
    expect(normalizeTraceBoundary({ x: 5, y: 0, width: 2, height: 2 }, 4, 4)).toBeNull();
    expect(normalizeTraceBoundary({ x: 1, y: 1, width: 0, height: 2 }, 4, 4)).toBeNull();
  });

  it('copies the selected RGBA pixels into a cropped RawImageData', () => {
    const image = rgbaImage(3, 2, [10, 20, 30, 40, 50, 60]);
    const cropped = cropRawImageData(image, { x: 1, y: 0, width: 2, height: 2 });

    expect(cropped.width).toBe(2);
    expect(cropped.height).toBe(2);
    expect(redChannel(cropped)).toEqual([20, 30, 50, 60]);
  });

  it('offsets cropped trace geometry back into source-image coordinates', () => {
    const source: ColoredPath[] = [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 1 },
              { x: 3, y: 4 },
            ],
          },
        ],
      },
    ];

    expect(offsetColoredPaths(source, 10, 20)).toEqual([
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 10, y: 21 },
              { x: 13, y: 24 },
            ],
          },
        ],
      },
    ]);
    expect(offsetBounds({ minX: 0, minY: 1, maxX: 3, maxY: 4 }, 10, 20)).toEqual({
      minX: 10,
      minY: 21,
      maxX: 13,
      maxY: 24,
    });
  });
});

function rgbaImage(width: number, height: number, redValues: ReadonlyArray<number>): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < redValues.length; i += 1) {
    data[i * 4] = redValues[i] ?? 0;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function redChannel(image: RawImageData): number[] {
  const out: number[] = [];
  for (let i = 0; i < image.data.length; i += 4) {
    out.push(image.data[i] ?? 0);
  }
  return out;
}
