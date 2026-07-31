import { describe, expect, it } from 'vitest';
import { buildCorpus } from '../../__fixtures__/property/box-benchmark-support';
import { generateBox, type BoxPanel, type BoxSpec } from '../../core/box';
import { runBoxGenerationRequest } from './box-generation-worker-runtime';

const DIVIDER_SPEC: BoxSpec = {
  widthMm: 90,
  depthMm: 60,
  heightMm: 45,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'open-top',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
  dividersXCount: 2,
  dividersYCount: 1,
};

const SLIDE_LID_SPEC: BoxSpec = {
  ...DIVIDER_SPEC,
  style: 'slide-lid',
  clearanceMm: 0.2,
  dividersXCount: 0,
  dividersYCount: 0,
};

describe('runBoxGenerationRequest', () => {
  it('keeps worker output byte-identical to direct pure-core generation', () => {
    const corpus = [...buildCorpus(), DIVIDER_SPEC, SLIDE_LID_SPEC];
    corpus.forEach((spec, index) => {
      const response = runBoxGenerationRequest({ kind: 'generate', id: index + 1, spec });
      expect(response.kind).toBe('result');
      if (response.kind !== 'result') return;
      expect(response.result).toEqual(generateBox(spec));
      expect(response.metrics).toEqual(metricsFor(response.result));
    });
  });
});

function metricsFor(
  result: ReturnType<typeof generateBox>,
): { readonly panelCount: number; readonly ringCount: number; readonly pointCount: number } | null {
  if (result.kind !== 'generated') return null;
  const rings = result.panels.flatMap((panel: BoxPanel) => [panel.outline, ...panel.cutouts]);
  return {
    panelCount: result.panels.length,
    ringCount: rings.length,
    pointCount: rings.reduce((total, ring) => total + ring.points.length, 0),
  };
}
