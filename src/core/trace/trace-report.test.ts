import { describe, expect, it } from 'vitest';
import { otsuBinarization } from './background-flatten';
import { otsuThreshold } from './preprocess';
import { prepareTraceForContour, type RawImageData, type TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import type { TraceReport, TraceSteps } from './trace-steps';
import { traceImageToColoredPaths } from './trace-to-paths';

const SHARP = TRACE_PRESETS['Sharp']!;
const LINE_ART = TRACE_PRESETS['Line Art']!;

describe('trace reports what automatic detection chose', () => {
  it('reports the Otsu threshold, and the band ending one level lower selects the same ink', () => {
    const image = rampImage();
    const { prepared, report } = prepareTraceForContour(image, SHARP);
    const automatic = otsuThreshold(image);
    expect(report).toEqual({ automaticThresholdLuma: automatic });
    // The manual band is inclusive; Otsu keeps only pixels darker than its cut.
    const manual = (upper: number): TraceOptions => ({
      ...SHARP,
      useOtsuThreshold: false,
      cutoffLuma: 0,
      thresholdLuma: upper,
    });
    expect(prepareTraceForContour(image, manual(automatic - 1)).prepared.data).toEqual(
      prepared.data,
    );
    expect(prepareTraceForContour(image, manual(automatic)).prepared.data).not.toEqual(
      prepared.data,
    );
    expect(prepareTraceForContour(image, manual(automatic - 1)).report).toBeUndefined();
  });

  it('says so instead of naming a band when it levelled uneven lighting', () => {
    const image = unevenPage();
    expect(otsuBinarization(image).flattened).toBe(true);
    expect(prepareTraceForContour(image, SHARP).report).toEqual({ lightingLevelled: true });
  });

  it('reports the cut a derived region carries from its whole source', () => {
    const report = prepareTraceForContour(rampImage(), {
      ...SHARP,
      sourceOtsuThreshold: 97,
    }).report;
    expect(report).toEqual({ automaticThresholdLuma: 97 });
  });

  it('says whether Line Art added local-contrast detail to its band', () => {
    expect(prepareTraceForContour(rampImage(), LINE_ART).report).toEqual({
      localDetailAdded: false,
    });
    expect(prepareTraceForContour(rampImage([40, 90, 200]), LINE_ART).report).toEqual({
      localDetailAdded: true,
    });
  });

  it('keeps reporting the threshold when Faint lines replaces the colour check', () => {
    const image = rampImage([40, 90, 200]);
    expect(prepareTraceForContour(image, { ...SHARP, faintLineRecovery: true }).report).toEqual({
      automaticThresholdLuma: otsuThreshold(image),
    });
    expect(
      prepareTraceForContour(image, { ...LINE_ART, faintLineRecovery: true }).report,
    ).toBeUndefined();
  });

  it('carries the report to the runner without changing the traced paths', async () => {
    const image = rampImage();
    const { reports, run } = reportingRunner();
    const paths = await traceImageToColoredPaths(image, SHARP, run);
    expect(reports).toEqual([{ automaticThresholdLuma: otsuThreshold(image) }]);
    expect(paths).toEqual(await traceImageToColoredPaths(image, SHARP));
  });

  it.each(['Centerline', 'Line + fill'])(
    'reports the automatic threshold from %s',
    async (name) => {
      const image = rampImage();
      const preset = TRACE_PRESETS[name]!;
      const { reports, run } = reportingRunner();
      const paths = await traceImageToColoredPaths(image, preset, run);
      expect(reports).toEqual([{ automaticThresholdLuma: otsuThreshold(image) }]);
      expect(paths).toEqual(await traceImageToColoredPaths(image, preset));
    },
  );
});

function reportingRunner(): {
  readonly reports: TraceReport[];
  readonly run: <T>(steps: TraceSteps<T>) => T;
} {
  const reports: TraceReport[] = [];
  const run = <T>(steps: TraceSteps<T>): T => {
    for (;;) {
      const step = steps.next(false);
      if (step.done) return step.value;
      if (step.value !== undefined) reports.push(step.value);
    }
  };
  return { reports, run };
}

// Dark bars on light paper with a full 0-255 ramp along the top rows, so pixels
// sit on both sides of every possible cut. `tint` colours the dark bars.
function rampImage(tint?: readonly [number, number, number]): RawImageData {
  const width = 256;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bar = y >= 16 && x % 32 < 12;
      const grey = y < 4 ? x : bar ? 50 : 225;
      const rgb = bar && tint !== undefined ? tint : [grey, grey, grey];
      const offset = (y * width + x) * 4;
      data[offset] = rgb[0]!;
      data[offset + 1] = rgb[1]!;
      data[offset + 2] = rgb[2]!;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

// Ink at 60 on paper that brightens from 150 to 250 across the page, the
// uneven lighting ADR-402 levels before the automatic cut.
function unevenPage(): RawImageData {
  const width = 400;
  const height = 200;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = Math.round(150 + (100 * x) / (width - 1));
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  const page = { width, height, data };
  // A rule, a stem and a block.
  paintInk(page, { left: 20, top: 10, width: 200, height: 5 });
  paintInk(page, { left: 30, top: 40, width: 5, height: 90 });
  paintInk(page, { left: 200, top: 100, width: 20, height: 20 });
  return page;
}

function paintInk(
  image: RawImageData,
  rect: { left: number; top: number; width: number; height: number },
): void {
  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      image.data.set([60, 60, 60, 255], (y * image.width + x) * 4);
    }
  }
}
