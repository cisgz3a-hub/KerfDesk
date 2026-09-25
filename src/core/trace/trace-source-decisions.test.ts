import { describe, expect, it } from 'vitest';
import { shouldUseSketchTrace } from './auto-sketch-trace';
import { otsuThreshold } from './preprocess';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { resolveFrozenTraceSourceOptions } from './trace-source-decisions';

function image(width: number, height: number, rgba: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(rgba(x, y), (y * width + x) * 4);
  }
  return { width, height, data } satisfies RawImageData;
}

const preset = (name: string): TraceOptions => TRACE_PRESETS[name] as TraceOptions;
// Dark disc on a mid-grey field: Otsu cuts between the two.
const bimodal = image(40, 40, (x, y) =>
  (x - 20) ** 2 + (y - 20) ** 2 < 64 ? [30, 30, 30, 255] : [170, 170, 170, 255],
);
// Neutral art with a patch of warm colour over the auto-sketch floor.
const colourful = image(40, 40, (x, y) =>
  x < 10 && y < 10 ? [220, 150, 60, 255] : [255, 255, 255, 255],
);

describe('resolveFrozenTraceSourceOptions (ADR-410)', () => {
  it('freezes the Otsu cut of Otsu presets and is idempotent', () => {
    // A continuous histogram: exactly the cut the native pass derives.
    const shaded = image(256, 4, (x) => [x, x, x, 255]);
    const frozen = resolveFrozenTraceSourceOptions(shaded, preset('Sharp'));
    expect(frozen.sourceOtsuThreshold).toBe(otsuThreshold(shaded));
    expect(frozen.useOtsuThreshold).toBe(true);
    expect(resolveFrozenTraceSourceOptions(shaded, frozen)).toBe(frozen);
  });

  it('centres a cut that falls in a histogram gap', () => {
    // Levels 30 and 170 only: every cut in 31..170 splits them the same way.
    const cut = resolveFrozenTraceSourceOptions(bimodal, preset('Sharp')).sourceOtsuThreshold;
    expect(otsuThreshold(bimodal)).toBe(31);
    expect(cut).toBe(100);
    const clean = image(8, 8, (x) => (x < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    expect(resolveFrozenTraceSourceOptions(clean, preset('Sharp')).sourceOtsuThreshold).toBe(128);
  });

  it('reads the cut after the tone chain, Invert included', () => {
    const shaded = image(256, 4, (x) => [x, x, x, 255]);
    const frozen = resolveFrozenTraceSourceOptions(shaded, { ...preset('Sharp'), invert: true });
    const inverted = image(256, 4, (x) => [255 - x, 255 - x, 255 - x, 255]);
    expect(frozen.sourceOtsuThreshold).toBe(otsuThreshold(inverted));
  });

  it('leaves settings that never read Otsu alone', () => {
    // Line Art's fixed band wins; only its (neutral) sketch verdict is added.
    expect(resolveFrozenTraceSourceOptions(bimodal, preset('Line Art'))).toEqual({
      ...preset('Line Art'),
      sourceAutoSketch: false,
    });
    for (const options of [
      preset('Edge Detection'),
      preset('Photo shading'),
      { ...preset('Sharp'), thresholdLuma: 90 },
    ]) {
      expect(resolveFrozenTraceSourceOptions(bimodal, options)).toBe(options);
    }
  });

  it('leaves an alpha-mask trace to its alpha verdict', () => {
    const transparent = image(8, 8, () => [0, 0, 0, 0]);
    const frozen = resolveFrozenTraceSourceOptions(transparent, {
      ...preset('Sharp'),
      traceTransparency: true,
    });
    expect(frozen.sourceHasTransparency).toBe(true);
    expect(frozen.sourceOtsuThreshold).toBeUndefined();
  });

  it('carries the auto-sketch verdict so a colourless crop keeps it', () => {
    const frozen = resolveFrozenTraceSourceOptions(colourful, preset('Line Art'));
    expect(frozen.sourceAutoSketch).toBe(true);
    const plain = image(8, 8, () => [255, 255, 255, 255]);
    expect(shouldUseSketchTrace(plain, preset('Line Art'))).toBe(false);
    expect(shouldUseSketchTrace(plain, frozen)).toBe(true);
    expect(shouldUseSketchTrace(colourful, { ...frozen, sourceAutoSketch: false })).toBe(false);
    // Only auto-sketch reads the verdict; an explicit choice wins.
    expect(shouldUseSketchTrace(colourful, { ...frozen, autoSketchTrace: false })).toBe(false);
    expect(resolveFrozenTraceSourceOptions(colourful, frozen)).toBe(frozen);
  });

  it("freezes the automatic median's whole-image verdict with the Otsu cut (ADR-411)", () => {
    // 1-px pepper every 6 px: 2.8% of the frame, over the 0.4% density floor.
    const specked = image(60, 60, (x, y) =>
      x % 6 === 3 && y % 6 === 3 ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );
    const plain = image(60, 60, () => [255, 255, 255, 255]);
    const frozen = resolveFrozenTraceSourceOptions(specked, preset('Smooth'));
    expect(frozen.sourceAutoMedian).toBe(true);
    // One median pass serves both: the cut is read after the repair.
    expect(frozen.sourceOtsuThreshold).toBe(
      resolveFrozenTraceSourceOptions(plain, preset('Smooth')).sourceOtsuThreshold,
    );
    expect(resolveFrozenTraceSourceOptions(plain, preset('Smooth')).sourceAutoMedian).toBe(false);
    expect(resolveFrozenTraceSourceOptions(specked, frozen)).toBe(frozen);
    // Presets without the automatic median carry no verdict.
    expect(
      resolveFrozenTraceSourceOptions(specked, preset('Sharp')).sourceAutoMedian,
    ).toBeUndefined();
  });
});
