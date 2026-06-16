// Perceptual fidelity - SVG import geometry.
//
// Mirrors trace-perceptual.test.ts but on the IMPORT path: a known circle is
// run through the real parseSvg pipeline, rasterized with the shared even-odd
// harness, and diffed (IoU) against the analytic disc the import is meant to
// reproduce. The sagitta checks below guard against fixed-segment faceting on
// large imported circle/ellipse artwork.
//
// SCOPE: IoU here measures area coverage of the imported outline, NOT complete
// parity with LightBurn. A high score alone does not mean "smooth"; the
// chord-height tests below are the guard for large-shape faceting.

import { describe, expect, it } from 'vitest';
import { compareMasks } from '../../__fixtures__/perceptual/compare';
import {
  circleSvg,
  importSvgPolylines,
  maxChordSagittaMm,
  vertexCount,
} from '../../__fixtures__/perceptual/import-fidelity';
import { writePerceptualArtifact } from '../../__fixtures__/perceptual/png';
import { rasterizePolylines } from '../../__fixtures__/perceptual/rasterize';
import { PERCEPTUAL_FIXTURES } from '../../__fixtures__/perceptual/shapes';

// The shared fixture is disc(center 64, 64, r 48) on a 128 x 128 grid - reused
// here as the ground truth the imported circle must reproduce.
const DISC = PERCEPTUAL_FIXTURES.find((f) => f.name === 'filled-disc');
if (DISC === undefined) throw new Error('missing filled-disc fixture');

const FRAME_MM = DISC.width; // 128 - user units == mm, so the circle lands in-grid
const RADIUS_MM = 48;

describe('SVG import perceptual fidelity', () => {
  it('imports a circle that covers the analytic disc (IoU floor)', () => {
    const polylines = importSvgPolylines(circleSvg(FRAME_MM, RADIUS_MM));
    const predicted = rasterizePolylines(polylines, DISC.width, DISC.height);
    writePerceptualArtifact('import-circle', predicted, DISC.truth);
    const iou = compareMasks(predicted, DISC.truth).iou;
    expect(iou).toBeGreaterThanOrEqual(0.95);
  });

  it('uses more circle segments as radius grows', () => {
    const small = importSvgPolylines(circleSvg(128, 48));
    const large = importSvgPolylines(circleSvg(1024, 384));
    expect(vertexCount(large)).toBeGreaterThan(vertexCount(small));
  });

  it('keeps large imported circle facet depth below the drawing ellipse tolerance', () => {
    const small = importSvgPolylines(circleSvg(128, 48));
    const large = importSvgPolylines(circleSvg(1024, 384));
    const smallSag = maxChordSagittaMm(small, { x: 64, y: 64 }, 48);
    const largeSag = maxChordSagittaMm(large, { x: 512, y: 512 }, 384);
    expect(smallSag).toBeLessThan(0.1);
    expect(largeSag).toBeLessThan(0.06);
  });
});
