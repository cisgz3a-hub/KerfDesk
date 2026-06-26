import { describe, expect, it } from 'vitest';

import { shouldUseSketchTrace } from './auto-sketch-trace';
import { DEFAULT_TRACE_OPTIONS, preprocessForTrace } from './trace-image';

describe('Sketch Trace preprocessing', () => {
  it('uses local contrast instead of global darkness', () => {
    const data = new Uint8ClampedArray([
      80,
      80,
      80,
      255, // dark shadow background, should stay background in sketch mode
      85,
      85,
      85,
      255,
      30,
      30,
      30,
      255, // locally darker stroke
      90,
      90,
      90,
      255,
      95,
      95,
      95,
      255,
    ]);

    const result = preprocessForTrace(
      { width: 5, height: 1, data },
      {
        ...DEFAULT_TRACE_OPTIONS,
        cutoffLuma: 0,
        thresholdLuma: 128,
        sketchTrace: true,
      },
    );

    expect(Array.from(result.data)).toEqual([
      255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
  });

  it('auto-promotes colour-rich logos but leaves binary art on the fixed threshold path', () => {
    expect(
      shouldUseSketchTrace(makeSolidImage(40, 1, [182, 128, 24, 255]), {
        autoSketchTrace: true,
      }),
    ).toBe(true);

    expect(
      shouldUseSketchTrace(makeSolidImage(40, 1, [0, 0, 0, 255]), {
        autoSketchTrace: true,
      }),
    ).toBe(false);

    expect(
      shouldUseSketchTrace(makeSolidImage(40, 1, [182, 128, 24, 255]), {
        autoSketchTrace: true,
        sketchTrace: false,
      }),
    ).toBe(true);

    expect(
      shouldUseSketchTrace(makeSolidImage(40, 1, [182, 128, 24, 255]), {
        autoSketchTrace: false,
        sketchTrace: false,
      }),
    ).toBe(false);
  });
});

function makeSolidImage(
  width: number,
  height: number,
  pixel: readonly [number, number, number, number],
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = pixel[0];
    data[offset + 1] = pixel[1];
    data[offset + 2] = pixel[2];
    data[offset + 3] = pixel[3];
  }
  return { width, height, data };
}
