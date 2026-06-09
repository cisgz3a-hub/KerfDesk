import { describe, expect, it } from 'vitest';

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
});
