import { describe, expect, it } from 'vitest';
import { generateScanOffsetTestGrid } from './scan-offset-test-grid';

describe('generateScanOffsetTestGrid', () => {
  it('creates bidirectional filled swatches for each requested speed', () => {
    const grid = generateScanOffsetTestGrid({
      speeds: [600, 1200, 1800],
      power: 22,
      widthMm: 40,
      heightMm: 8,
      lineIntervalMm: 0.25,
      gapMm: 3,
      origin: { x: 5, y: 6 },
    });

    expect(grid.cells).toHaveLength(3);
    expect(grid.scene.objects).toHaveLength(3);
    expect(grid.scene.layers).toHaveLength(3);
    expect(grid.cells.map((cell) => cell.speed)).toEqual([600, 1200, 1800]);

    expect(grid.scene.layers[1]).toMatchObject({
      id: 'scan-offset-test-speed-1',
      mode: 'fill',
      power: 22,
      speed: 1200,
      hatchSpacingMm: 0.25,
      fillOverscanMm: 3,
      fillStyle: 'scanline',
      fillBidirectional: true,
      fillCrossHatch: false,
    });
    expect(grid.cells[1]?.bounds).toEqual({ minX: 5, minY: 17, maxX: 45, maxY: 25 });
  });

  it('keeps defaults conservative for an initial 4040 scan-offset check', () => {
    const grid = generateScanOffsetTestGrid({
      speeds: [],
      power: 150,
    });

    expect(grid.cells.map((cell) => cell.speed)).toEqual([600, 1200, 1800]);
    expect(grid.scene.layers.map((layer) => layer.power)).toEqual([100, 100, 100]);
    expect(grid.scene.layers.every((layer) => layer.fillBidirectional)).toBe(true);
    expect(grid.scene.layers.every((layer) => layer.hatchSpacingMm === 0.2)).toBe(true);
  });
});
