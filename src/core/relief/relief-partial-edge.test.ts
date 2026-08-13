import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import { kernelForTool } from '../sim';
import {
  dilateHeightmapByTool,
  dilateHeightmapByToolWithMaskEvidence,
} from './heightmap-tool-offset';
import type { Heightmap } from './heightmap';
import { reliefFinishingPasses } from './relief-finishing';
import { reliefRoughingPasses } from './relief-roughing';

const POINT_TOOL: CncTool = {
  id: 'partial-point',
  name: 'point',
  kind: 'end-mill',
  diameterMm: 0,
};

function partialMap(
  widthMm: number,
  heightMm: number,
  mmPerCell: number,
  widthCells: number,
  heightCells: number,
): Heightmap {
  return {
    widthCells,
    heightCells,
    widthMm,
    heightMm,
    mmPerCell,
    depth: new Float32Array(widthCells * heightCells).fill(-1),
  };
}

describe('relief partial terminal cells', () => {
  it('places finishing centers inside the exact physical extent', () => {
    const map = partialMap(1, 0.3, 0.3, 4, 1);
    const passes = reliefFinishingPasses(map, {
      tool: POINT_TOOL,
      kernel: kernelForTool(POINT_TOOL, map.mmPerCell),
      scallopMm: 0.025,
    });

    expect(passes).toHaveLength(1);
    const pass = passes[0];
    if (pass?.kind !== 'path3d') throw new Error('expected one finishing path');
    for (const [index, expectedX] of [0.15, 0.45, 0.75, 0.95].entries()) {
      expect(pass.points[index]?.x).toBeCloseTo(expectedX, 12);
    }
    expect(pass.points.every((point) => point.x >= 0 && point.x <= map.widthMm)).toBe(true);
    expect(pass.points.every((point) => point.y >= 0 && point.y <= map.heightMm)).toBe(true);
  });

  it('keeps maximum-finite partial finishing centers representable', () => {
    const pitch = Number.MAX_VALUE * 0.6;
    const map = partialMap(Number.MAX_VALUE, 1, pitch, 2, 1);
    const passes = reliefFinishingPasses(map, {
      tool: POINT_TOOL,
      kernel: kernelForTool(POINT_TOOL, map.mmPerCell),
      scallopMm: 0.025,
    });

    const pass = passes[0];
    if (pass?.kind !== 'path3d') throw new Error('expected one finishing path');
    expect(pass.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
      true,
    );
    expect(pass.points[1]?.x).toBe(pitch + (Number.MAX_VALUE - pitch) / 2);
  });

  it('maps roughing dual-grid contours to the exact terminal edges', () => {
    const map = partialMap(1, 1, 0.3, 4, 4);
    const tool: CncTool = {
      id: 'partial-rough',
      name: '0.1 mm end mill',
      kind: 'end-mill',
      diameterMm: 0.1,
    };
    const passes = reliefRoughingPasses(map, {
      tool,
      reliefDepthMm: 1,
      depthPerPassMm: 1,
      allowanceMm: 0,
    });
    const points = passes.flatMap((pass) => (pass.kind === 'contour' ? pass.polyline : []));

    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => point.x >= 0 && point.x <= map.widthMm)).toBe(true);
    expect(points.every((point) => point.y >= 0 && point.y <= map.heightMm)).toBe(true);
    expect(points.some((point) => point.x === map.widthMm)).toBe(true);
    expect(points.some((point) => point.y === map.heightMm)).toBe(true);
  });

  it('uses physical center distance for a tool spanning the shortened cell', () => {
    const map: Heightmap = {
      ...partialMap(1.1, 1, 1, 2, 1),
      depth: Float32Array.from([-1, 0]),
    };
    const tool: CncTool = {
      id: 'partial-ball',
      name: '1.2 mm ball nose',
      kind: 'ball-nose',
      diameterMm: 1.2,
    };
    const radiusMm = tool.diameterMm / 2;
    const centerDistanceMm = 1.05 - 0.5;
    const expectedDz = radiusMm - Math.sqrt(radiusMm ** 2 - centerDistanceMm ** 2);
    const tip = dilateHeightmapByTool(map, kernelForTool(tool, map.mmPerCell), 0);

    expect(tip[0]).toBeCloseTo(-expectedDz, 6);
    expect(tip[0]).toBeGreaterThan(-1);
  });

  it('treats an included partial cell as physically adjacent to excluded stock', () => {
    const map: Heightmap = {
      ...partialMap(1.1, 1, 1, 2, 1),
      inclusion: Uint8Array.from([0, 1]),
    };
    const tool: CncTool = {
      id: 'partial-mask',
      name: '0.2 mm end mill',
      kind: 'end-mill',
      diameterMm: 0.2,
    };
    const result = dilateHeightmapByToolWithMaskEvidence(
      map,
      kernelForTool(tool, map.mmPerCell),
      0,
    );

    expect(result.tipDepth[1]).toBe(0);
    expect(result.touchesExcluded?.[1]).toBe(1);
  });
});
