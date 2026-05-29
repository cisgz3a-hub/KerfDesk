// Perceptual fidelity test — the missing measuring instrument.
//
// Every other trace test asserts STRUCTURE (path counts, polyline lengths,
// SVG prefixes). None renders the output and asks "does the trace actually
// cover the source image's ink?" This one does: trace each synthetic
// fixture, rasterize the resulting contours back to a binary mask (even-odd
// fill, so holes stay hollow), and compare to the fixture's analytic
// ground truth via IoU. See src/__fixtures__/perceptual/ for the harness.
//
// Baselines measured 2026-05-29 with the Line Art preset (the import
// dialog's default), imagetracerjs current pin:
//   solid-square 1.000 · plus-stroke 1.000 · square-glyph 1.000
//   filled-disc  0.986 · ring-annulus 0.978   (residual = circle→polygon)
// Floors below sit just under those, so a real fidelity regression trips
// the test while normal discretization noise does not.
//
// IMPORTANT SCOPE: IoU here measures geometric area coverage of the OUTLINE
// trace, not perceptual quality. A high score means "the filled contours
// cover the right pixels", NOT "as good as LightBurn". It does not measure
// the outline-vs-centerline gap (a single pen stroke still becomes two
// contours), curve smoothness, or raster-engrave quality.

import { describe, expect, it } from 'vitest';
import { compareMasks } from '../../__fixtures__/perceptual/compare';
import { writePerceptualArtifact } from '../../__fixtures__/perceptual/png';
import { rasterizeColoredPaths } from '../../__fixtures__/perceptual/rasterize';
import type { Mask } from '../../__fixtures__/perceptual/rasterize';
import { PERCEPTUAL_FIXTURES } from '../../__fixtures__/perceptual/shapes';
import type { TraceOptions } from './index';
import { DEFAULT_TRACE_OPTIONS, TRACE_PRESETS, traceImageToColoredPaths } from './index';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

// Per-fixture IoU floors, set just below the measured baselines above.
const EXPECTED_MIN_IOU: Readonly<Record<string, number>> = {
  'solid-square': 0.97,
  'filled-disc': 0.95,
  'ring-annulus': 0.95,
  'plus-stroke': 0.97,
  'square-glyph': 0.97,
};

async function traceToMask(
  fixture: (typeof PERCEPTUAL_FIXTURES)[number],
  options: TraceOptions,
): Promise<Mask> {
  const paths = await traceImageToColoredPaths(fixture.image, options);
  return rasterizeColoredPaths(paths, fixture.width, fixture.height);
}

describe('trace perceptual fidelity', () => {
  it.each(PERCEPTUAL_FIXTURES)(
    '$name: Line Art preset reproduces the source ink',
    async (fixture) => {
      const predicted = await traceToMask(fixture, LINE_ART);
      writePerceptualArtifact(fixture.name, predicted, fixture.truth);
      const iou = compareMasks(predicted, fixture.truth).iou;
      const floor = EXPECTED_MIN_IOU[fixture.name] ?? 0.95;
      expect(iou).toBeGreaterThanOrEqual(floor);
    },
  );

  it('Line Art preserves the annulus hole (does not flood the centre)', async () => {
    const ring = PERCEPTUAL_FIXTURES.find((f) => f.name === 'ring-annulus');
    if (ring === undefined) throw new Error('missing ring-annulus fixture');
    const predicted = await traceToMask(ring, LINE_ART);
    const center =
      predicted.data[Math.floor(ring.height / 2) * ring.width + Math.floor(ring.width / 2)];
    expect(center).toBe(0);
  });

  it('adaptive DEFAULT options collapse on binary input (why the dialog defaults to Line Art)', async () => {
    // imagetracerjs's adaptive 2-colour quantizer degenerates to a single
    // palette colour on an already-binary image, tracing the whole image
    // frame instead of the shape. The Line Art preset pins a fixed
    // [white, black] palette and sidesteps this. Asserted as a wide margin
    // rather than an absolute, so it stays robust across tracer versions.
    const square = PERCEPTUAL_FIXTURES.find((f) => f.name === 'solid-square');
    if (square === undefined) throw new Error('missing solid-square fixture');
    const defaultMask = await traceToMask(square, DEFAULT_TRACE_OPTIONS);
    writePerceptualArtifact('solid-square.DEFAULT', defaultMask, square.truth);
    const lineArtMask = await traceToMask(square, LINE_ART);
    const defaultIoU = compareMasks(defaultMask, square.truth).iou;
    const lineArtIoU = compareMasks(lineArtMask, square.truth).iou;
    expect(lineArtIoU - defaultIoU).toBeGreaterThan(0.5);
  });
});
