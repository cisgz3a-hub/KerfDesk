import { beforeAll, describe, expect, it } from 'vitest';
import type { TextRenderResult } from '../../core/text';
import {
  measureGlyphRender,
  REAL_GLYPH_CORPUS,
  renderGlyphFixture,
  type GlyphCorpusMetrics,
} from './real-glyph-corpus';

const MAX_COMPATIBILITY_DEVIATION_MM = 0.05;
const MAX_SEGMENTS_PER_CHARACTER = 80;
const renderedByName = new Map<string, TextRenderResult>();

beforeAll(async () => {
  for (const fixture of REAL_GLYPH_CORPUS) {
    renderedByName.set(fixture.name, await renderGlyphFixture(fixture));
  }
});

describe('real-world glyph curve acceptance corpus', () => {
  it.each(REAL_GLYPH_CORPUS)('$name preserves editable canonical geometry', (fixture) => {
    const rendered = requiredRender(fixture.name);
    const metrics = measureGlyphRender(rendered);

    expect(metrics.contours).toBeGreaterThan(0);
    expect(rendered.paths[0]?.curves).toHaveLength(rendered.paths[0]?.polylines.length ?? 0);
    expect(metrics.allFinite).toBe(true);
    expect(metrics.allClosed).toBe(true);
    expect(metrics.boundsContainGeometry).toBe(true);
    expect(metrics.maxCompatibilityDeviationMm).toBeLessThanOrEqual(MAX_COMPATIBILITY_DEVIATION_MM);
    expect(metrics.curveSegments).toBeLessThanOrEqual(
      fixture.content.length * MAX_SEGMENTS_PER_CHARACTER,
    );
  });

  it('renders one independent deterministic result for each bundled font', async () => {
    for (const fixture of REAL_GLYPH_CORPUS.filter((item) => item.sizeMm === 12)) {
      expect(await renderGlyphFixture(fixture)).toEqual(requiredRender(fixture.name));
    }
  });

  it('publishes aggregate metrics for the acceptance scorecard', () => {
    const measured: Array<{ readonly name: string; readonly metrics: GlyphCorpusMetrics }> = [];
    for (const fixture of REAL_GLYPH_CORPUS) {
      measured.push({
        name: fixture.name,
        metrics: measureGlyphRender(requiredRender(fixture.name)),
      });
    }
    const worst = measured.reduce((current, candidate) =>
      candidate.metrics.maxCompatibilityDeviationMm > current.metrics.maxCompatibilityDeviationMm
        ? candidate
        : current,
    );
    const totalContours = measured.reduce((sum, item) => sum + item.metrics.contours, 0);
    const totalSegments = measured.reduce((sum, item) => sum + item.metrics.curveSegments, 0);

    expect({
      fixtures: measured.length,
      totalContours,
      totalSegments,
      worstDeviationMm: Number(worst.metrics.maxCompatibilityDeviationMm.toFixed(6)),
      worstFixture: worst.name,
    }).toEqual({
      fixtures: 15,
      totalContours: 339,
      totalSegments: 7107,
      worstDeviationMm: 0.023805,
      worstFixture: 'script-connected-50mm',
    });
  });
});

function requiredRender(name: string): TextRenderResult {
  const rendered = renderedByName.get(name);
  if (rendered === undefined) throw new Error(`Missing glyph corpus render: ${name}`);
  return rendered;
}
