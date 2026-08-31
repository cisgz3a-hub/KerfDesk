import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileCncJob } from '../cnc/compile-cnc-job';
import { cncGrblStrategy } from '../output';
import { findPlungedTravelIssues } from '../invariants';
import { computeJobBounds } from '../job';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type Scene,
} from '../scene';
import type { MeshReliefObject } from '../scene/relief';
import { gridCellOfPoint, kernelForTool } from '../sim';
import { meshToHeightmap } from './mesh-to-heightmap';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import {
  DEFAULT_RELIEF_ALLOWANCE_MM,
  reliefRoughingLadder,
  reliefRoughingPasses,
} from './relief-roughing';

const FLAT_TOOL: CncTool = { id: 'em', name: 'end mill', kind: 'end-mill', diameterMm: 3.175 };
const SUBCELL_TOOL: CncTool = {
  id: 'subcell-em',
  name: 'subcell end mill',
  kind: 'end-mill',
  diameterMm: 0.1,
};

// 4-triangle pyramid: 20 × 20 base at z 0, apex z 10 (analytic terraces).
function pyramidRelief(): MeshReliefObject {
  const s = 20;
  const apex = [s / 2, s / 2, 10];
  const c = [
    [0, 0, 0],
    [s, 0, 0],
    [s, s, 0],
    [0, s, 0],
  ];
  const tris = [
    [...(c[0] ?? []), ...(c[1] ?? []), ...apex],
    [...(c[1] ?? []), ...(c[2] ?? []), ...apex],
    [...(c[2] ?? []), ...(c[3] ?? []), ...apex],
    [...(c[3] ?? []), ...(c[0] ?? []), ...apex],
  ];
  return {
    kind: 'relief',
    id: 'R1',
    source: 'pyramid.stl',
    targetWidthMm: 20,
    reliefDepthMm: 4,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: tris.flat(),
      emptyCells: 'floor',
    },
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
}

function heightmapOf(relief: MeshReliefObject): ReturnType<typeof meshToHeightmap> {
  return meshToHeightmap(
    { positions: Float32Array.from(relief.reliefSource.meshPositions) },
    {
      targetWidthMm: relief.targetWidthMm,
      reliefDepthMm: relief.reliefDepthMm,
      emptyCells: relief.reliefSource.emptyCells,
      mmPerCell: 0.4,
    },
  );
}

describe('reliefRoughingPasses', () => {
  it('keeps roughing contours inside the included island', () => {
    const inclusion = new Uint8Array(25);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) inclusion[y * 5 + x] = 1;
    }
    const passes = reliefRoughingPasses(
      {
        widthCells: 5,
        heightCells: 5,
        widthMm: 5,
        heightMm: 5,
        mmPerCell: 1,
        depth: new Float32Array(25).fill(-4),
        inclusion,
      },
      {
        tool: SUBCELL_TOOL,
        reliefDepthMm: 4,
        depthPerPassMm: 2,
        stepoverPercent: 40,
        allowanceMm: 0,
      },
    );

    expect(passes.length).toBeGreaterThan(0);
    for (const pass of passes) {
      if (pass.kind !== 'contour') continue;
      for (const point of pass.polyline) {
        // Marching-squares coordinates lie on the outer grid edges around
        // included cells 1..3, so this island occupies the closed [1,4] box.
        expect(point.x).toBeGreaterThanOrEqual(1);
        expect(point.x).toBeLessThanOrEqual(4);
        expect(point.y).toBeGreaterThanOrEqual(1);
        expect(point.y).toBeLessThanOrEqual(4);
      }
    }
  });

  it('produces depth-major waterline passes within [−reliefDepth, 0)', () => {
    const result = heightmapOf(pyramidRelief());
    if (result.kind !== 'ok') throw new Error(result.reason);
    const passes = reliefRoughingPasses(result.heightmap, {
      tool: FLAT_TOOL,
      reliefDepthMm: 4,
      depthPerPassMm: 1,
      stepoverPercent: 40,
    });
    expect(passes.length).toBeGreaterThan(0);
    const depths = passes.map((p) => (p.kind === 'contour' ? p.zMm : Number.NaN));
    for (const z of depths) {
      expect(z).toBeLessThan(0);
      expect(z).toBeGreaterThanOrEqual(-4 - 1e-9);
    }
    // Depth-major: levels never interleave (non-increasing sequence of levels).
    for (let i = 1; i < depths.length; i += 1) {
      expect(depths[i]).toBeLessThanOrEqual((depths[i - 1] ?? 0) + 1e-9);
    }
  });

  it('bounds nearest-cell depth discrepancy for dual-grid contour vertices', () => {
    const result = heightmapOf(pyramidRelief());
    if (result.kind !== 'ok') throw new Error(result.reason);
    const map = result.heightmap;
    const dilated = dilateHeightmapByTool(
      map,
      kernelForTool(FLAT_TOOL, map.mmPerCell),
      DEFAULT_RELIEF_ALLOWANCE_MM,
    );
    const passes = reliefRoughingPasses(map, {
      tool: FLAT_TOOL,
      reliefDepthMm: 4,
      depthPerPassMm: 1,
      stepoverPercent: 40,
    });
    // Grid frame matches the heightmap's local frame (origin 0,0).
    const grid = {
      widthCells: map.widthCells,
      heightCells: map.heightCells,
      widthMm: map.widthMm,
      heightMm: map.heightMm,
      mmPerCell: map.mmPerCell,
      originX: 0,
      originY: 0,
      depth: new Float32Array(0),
      resolution: {
        requestedMmPerCell: map.mmPerCell,
        effectiveMmPerCell: map.mmPerCell,
        reason: null,
      },
    };
    let violations = 0;
    for (const pass of passes) {
      if (pass.kind !== 'contour') continue;
      for (const p of pass.polyline) {
        const { cx, cy } = gridCellOfPoint(grid, p.x, p.y);
        if (cx < 0 || cy < 0 || cx >= map.widthCells || cy >= map.heightCells) continue;
        const target = dilated[cy * map.widthCells + cx] ?? 0;
        // A full-cell tolerance records this compatibility bound; it is not a
        // pointwise cutter-envelope proof because vertices lie between samples.
        if (pass.zMm < target - map.mmPerCell - 1e-6) violations += 1;
      }
    }
    expect(violations).toBe(0);
  });

  it('is deterministic', () => {
    const result = heightmapOf(pyramidRelief());
    if (result.kind !== 'ok') throw new Error(result.reason);
    const options = {
      tool: FLAT_TOOL,
      reliefDepthMm: 4,
      depthPerPassMm: 1.5,
      stepoverPercent: 40,
    };
    expect(reliefRoughingPasses(result.heightmap, options)).toEqual(
      reliefRoughingPasses(result.heightmap, options),
    );
  });

  it('preserves current-main Stepover normalization before the ring planner', () => {
    const ladder = reliefRoughingLadder(
      {
        widthCells: 3,
        heightCells: 3,
        widthMm: 3,
        heightMm: 3,
        mmPerCell: 1,
        depth: new Float32Array(9).fill(-1),
      },
      {
        tool: SUBCELL_TOOL,
        reliefDepthMm: 1,
        depthPerPassMm: 1,
        stepoverPercent: 1e-9,
        allowanceMm: 0,
      },
    );

    expect(ladder.passes).not.toHaveLength(0);
    expect(ladder.offsetFailed).toBe(false);
  });
});

describe('relief roughing — compile pipeline', () => {
  function reliefScene(): Scene {
    return {
      objects: [pyramidRelief()],
      layers: [
        {
          ...createLayer({ id: 'L1', color: '#a0522d' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthPerPassMm: 1.5, stepoverPercent: 40 },
        },
      ],
    };
  }

  it('compiles a relief into a relief-rough clearing group with invariant-clean G-code', () => {
    const device = DEFAULT_DEVICE_PROFILE;
    const job = compileCncJob(reliefScene(), device, DEFAULT_CNC_MACHINE_CONFIG);
    expect(job.groups).toHaveLength(1);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected cnc group');
    expect(group.cutType).toBe('relief-rough');
    expect(group.passes.length).toBeGreaterThan(0);
    const toolRadiusMm = 3.175 / 2;
    expect(computeJobBounds(job, device)).toEqual({
      minX: -toolRadiusMm,
      minY: device.bedHeight - 20 - toolRadiusMm,
      maxX: 20 + toolRadiusMm,
      maxY: device.bedHeight + toolRadiusMm,
    });

    const gcode = cncGrblStrategy.emit(job, device);
    expect(findPlungedTravelIssues(gcode, { safeZMm: group.safeZMm })).toEqual([]);
  });

  it('emits deterministic G-code (snapshot)', () => {
    const device = DEFAULT_DEVICE_PROFILE;
    const job = compileCncJob(reliefScene(), device, DEFAULT_CNC_MACHINE_CONFIG);
    const gcode = cncGrblStrategy.emit(job, device);
    expect(gcode).toMatchSnapshot();
  });
});
