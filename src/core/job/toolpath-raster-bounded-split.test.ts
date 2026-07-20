import { describe, expect, it } from 'vitest';
import type { RasterGroup } from './job';
import { buildToolpath, type ToolpathStep } from './toolpath';

const SPARSE_ROW = [500, 0, 0, 0, 0, 0, 0, 500];

function sparseRaster(): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'image',
    color: '#000',
    power: 50,
    speed: 1500,
    passes: 1,
    airAssist: false,
    sValues: new Uint16Array([...SPARSE_ROW, ...SPARSE_ROW]),
    pixelWidth: SPARSE_ROW.length,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: SPARSE_ROW.length, maxY: 2 },
    overscanMm: 5,
    dotWidthCorrectionMm: 0,
    bidirectional: true,
  };
}

function horizontalDeltasAtY(steps: ReadonlyArray<ToolpathStep>, y: number): number[] {
  return steps.flatMap((step) => {
    if (step.kind === 'travel') {
      return step.from.y === y && step.to.y === y ? [step.to.x - step.from.x] : [];
    }
    if (step.kind !== 'cut') return [];
    const start = step.polyline[0];
    const end = step.polyline[step.polyline.length - 1];
    return start?.y === y && end?.y === y ? [end.x - start.x] : [];
  });
}

describe('raster toolpath bounded split runways', () => {
  it('keeps forward and reverse preview motion monotonic through split gaps', () => {
    const toolpath = buildToolpath({ groups: [sparseRaster()] }, { startPoint: { x: -5, y: 0.5 } });

    expect(horizontalDeltasAtY(toolpath.steps, 0.5).every((delta) => delta >= 0)).toBe(true);
    expect(horizontalDeltasAtY(toolpath.steps, 1.5).every((delta) => delta <= 0)).toBe(true);
    expect(toolpath.steps).toContainEqual(
      expect.objectContaining({ kind: 'travel', from: { x: 1, y: 0.5 }, to: { x: 2, y: 0.5 } }),
    );
    expect(toolpath.steps).toContainEqual(
      expect.objectContaining({ kind: 'travel', from: { x: 7, y: 1.5 }, to: { x: 6, y: 1.5 } }),
    );
  });
});
