import { describe, expect, it } from 'vitest';
import { kernelForTool, type ToolKernel } from '../sim';
import type { CncTool } from '../scene';
import type { Heightmap } from './heightmap';
import { reliefFinishingPasses, scallopRowSpacingMm } from './relief-finishing';
import { finishingRows, rowDirection } from './relief-finishing-test-rows';
import { dilateHeightmapByTool } from './heightmap-tool-offset';

const BALL_NOSE: CncTool = { id: 'bn', name: 'ball', kind: 'ball-nose', diameterMm: 3.175 };
const SMALL_BALL_NOSE: CncTool = {
  id: 'bn-small',
  name: 'small ball',
  kind: 'ball-nose',
  diameterMm: 0.1,
};
const END_MILL: CncTool = { id: 'em', name: 'flat', kind: 'end-mill', diameterMm: 3.175 };
const POINT_KERNEL_BASE = kernelForTool(
  { id: 'point', name: 'point', kind: 'end-mill', diameterMm: 0 },
  1,
);
const POINT_OFFSETS = [{ dx: 0, dy: 0, dz: 0 }] as const;
const POINT_KERNEL: ToolKernel = {
  ...POINT_KERNEL_BASE,
  radiusCells: 0,
  surfaceCandidateSpanCells: 0,
  offsets: POINT_OFFSETS,
  maskCellOffsets: POINT_OFFSETS,
  maskCellCandidateSpanCells: 0,
  maskSweepCellOffsets: POINT_OFFSETS,
  maskSweepCandidateSpanCells: 0,
  maskPathUncertaintyMm: 0,
  maskSweepPathUncertaintyMm: 0,
};

function flatMap(depthMm: number, widthCells = 20, heightCells = 20, mmPerCell = 0.5): Heightmap {
  return {
    widthCells,
    heightCells,
    widthMm: widthCells * mmPerCell,
    heightMm: heightCells * mmPerCell,
    mmPerCell,
    depth: new Float32Array(widthCells * heightCells).fill(depthMm),
  };
}

// Square pyramid: depth rises linearly from the rim (-depth) to the apex (0).
function pyramidMap(depthMm: number, cells = 40, mmPerCell = 0.5): Heightmap {
  const depth = new Float32Array(cells * cells);
  const center = (cells - 1) / 2;
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const rimDistance = 1 - Math.max(Math.abs(x - center), Math.abs(y - center)) / center;
      depth[y * cells + x] = -depthMm * (1 - rimDistance);
    }
  }
  return {
    widthCells: cells,
    heightCells: cells,
    widthMm: cells * mmPerCell,
    heightMm: cells * mmPerCell,
    mmPerCell,
    depth,
  };
}

function surfaceAt(map: Heightmap, x: number, y: number): number {
  const cx = Math.min(map.widthCells - 1, Math.max(0, Math.floor(x / map.mmPerCell)));
  const cy = Math.min(map.heightCells - 1, Math.max(0, Math.floor(y / map.mmPerCell)));
  return map.depth[cy * map.widthCells + cx] ?? 0;
}

describe('scallopRowSpacingMm', () => {
  it('derives ball-nose spacing from the scallop chord formula', () => {
    // s_row = 2·sqrt(c·(2r − c)) with r = 1.5875, c = 0.025.
    const expected = 2 * Math.sqrt(0.025 * (2 * 1.5875 - 0.025));
    expect(scallopRowSpacingMm(BALL_NOSE, 0.025)).toBeCloseTo(expected, 9);
  });

  it('flat bits step a fixed diameter fraction', () => {
    expect(scallopRowSpacingMm(END_MILL, 0.025)).toBeCloseTo(3.175 * 0.4, 9);
  });

  it('does not floor a supported small ball nose above its selected scallop', () => {
    const radius = SMALL_BALL_NOSE.diameterMm / 2;
    const scallop = 0.005;
    const expected = 2 * Math.sqrt(scallop * (2 * radius - scallop));

    expect(expected).toBeLessThan(0.05);
    expect(scallopRowSpacingMm(SMALL_BALL_NOSE, scallop)).toBeCloseTo(expected, 12);
  });
});

describe('reliefFinishingPasses', () => {
  // Audit 1.11: the row loop stepped `row += rowStep` while `row < heightCells`,
  // so the last rowStep-1 rows were never emitted and kept their roughing
  // allowance as a ridge along the far edge.
  it('emits the far-Y row when the scallop stride steps over it', () => {
    // END_MILL spacing 1.27 mm at 0.5 mm/cell -> rowStep 2; rows 0,2..18 stop
    // short of the final row 19.
    const map = flatMap(-3, 20, 20, 0.5);
    const passes = reliefFinishingPasses(map, {
      tool: END_MILL,
      kernel: kernelForTool(END_MILL, 0.5),
      scallopMm: 0.025,
    });
    const rows = finishingRows(passes);
    expect(rows.at(-1)?.y).toBeCloseTo((19 + 0.5) * 0.5, 9);
    // Serpentine alternation must survive the appended row.
    expect(rowDirection(rows.at(-1))).toBe(-rowDirection(rows.at(-2)));
  });

  it('does not duplicate the final row when the stride lands on it', () => {
    // 19 cells: rows 0,2..18 land exactly on the far row, so nothing is added.
    const passes = reliefFinishingPasses(flatMap(-3, 20, 19, 0.5), {
      tool: END_MILL,
      kernel: kernelForTool(END_MILL, 0.5),
      scallopMm: 0.025,
    });
    const rows = finishingRows(passes);
    expect(rows.at(-1)?.y).toBeCloseTo((18 + 0.5) * 0.5, 9);
    expect(rows.at(-1)?.y).not.toBeCloseTo(rows.at(-2)?.y ?? 0, 9);
  });

  it('skims a flat surface at exactly its depth on every sample', () => {
    const passes = reliefFinishingPasses(flatMap(-3), {
      tool: BALL_NOSE,
      kernel: kernelForTool(BALL_NOSE, 0.5),
      scallopMm: 0.025,
    });
    expect(passes.length).toBeGreaterThan(0);
    for (const pass of passes) {
      if (pass.kind !== 'path3d') throw new Error('finishing pass must be path3d');
      for (const point of pass.points) {
        expect(point.z).toBeCloseTo(-3, 6);
      }
    }
  });

  it('never cuts below the target surface (max-plus no-gouge)', () => {
    const map = pyramidMap(5);
    const passes = reliefFinishingPasses(map, {
      tool: BALL_NOSE,
      kernel: kernelForTool(BALL_NOSE, map.mmPerCell),
      scallopMm: 0.025,
    });
    for (const pass of passes) {
      if (pass.kind !== 'path3d') continue;
      for (const point of pass.points) {
        expect(point.z).toBeGreaterThanOrEqual(surfaceAt(map, point.x, point.y) - 1e-6);
      }
    }
  });

  it('links unmasked rows into one stay-down path on exact tip samples (ADR-421)', () => {
    const map = pyramidMap(5);
    const passes = reliefFinishingPasses(map, {
      tool: BALL_NOSE,
      kernel: kernelForTool(BALL_NOSE, map.mmPerCell),
      scallopMm: 0.025,
    });
    const exact = dilateHeightmapByTool(map, kernelForTool(BALL_NOSE, map.mmPerCell), 0);
    const path = passes[0];
    if (path?.kind !== 'path3d') throw new Error('one stay-down path expected');

    expect(passes).toHaveLength(1);
    expect(finishingRows(passes).length).toBeGreaterThan(2);
    const lastColumnX = (map.widthCells - 0.5) * map.mmPerCell;
    for (let index = 1; index < path.points.length; index += 1) {
      const from = path.points[index - 1];
      const to = path.points[index];
      if (from === undefined || to === undefined) continue;
      // Every move is along a row or down an edge column, never a diagonal.
      if (from.y !== to.y) {
        expect(to.x).toBe(from.x);
        expect([0.5 * map.mmPerCell, lastColumnX]).toContain(to.x);
      }
    }
    for (const point of path.points) {
      const col = Math.round(point.x / map.mmPerCell - 0.5);
      const row = Math.round(point.y / map.mmPerCell - 0.5);
      expect(point.z).toBe(exact[row * map.widthCells + col]);
    }
  });

  it('serpentines: consecutive rows run in opposite X directions', () => {
    const passes = reliefFinishingPasses(flatMap(-1), {
      tool: BALL_NOSE,
      kernel: kernelForTool(BALL_NOSE, 0.5),
      scallopMm: 0.025,
    });
    const rows = finishingRows(passes);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rowDirection(rows[0])).toBe(-rowDirection(rows[1]));
  });

  it('smaller scallop targets produce more rows', () => {
    const coarse = reliefFinishingPasses(flatMap(-1, 40, 40), {
      tool: BALL_NOSE,
      kernel: kernelForTool(BALL_NOSE, 0.5),
      scallopMm: 0.1,
    });
    const fine = reliefFinishingPasses(flatMap(-1, 40, 40), {
      tool: BALL_NOSE,
      kernel: kernelForTool(BALL_NOSE, 0.5),
      scallopMm: 0.005,
    });
    expect(finishingRows(fine).length).toBeGreaterThan(finishingRows(coarse).length);
  });

  it('omits flat-tool centers whose physical footprint enters excluded stock', () => {
    const map: Heightmap = {
      ...flatMap(-2, 6, 1, 1),
      inclusion: Uint8Array.from([1, 1, 0, 1, 1, 0]),
    };
    const passes = reliefFinishingPasses(map, {
      tool: END_MILL,
      kernel: kernelForTool(END_MILL, 1),
      scallopMm: 0.025,
    });

    expect(passes).toEqual([]);
  });

  it('keeps an all-included mask byte-for-byte equivalent to the unmasked plan', () => {
    const map = flatMap(-2, 7, 8, 0.25);
    const options = {
      tool: END_MILL,
      kernel: kernelForTool(END_MILL, map.mmPerCell),
      scallopMm: 0.025,
    };

    expect(
      reliefFinishingPasses(
        { ...map, inclusion: new Uint8Array(map.depth.length).fill(1) },
        options,
      ),
    ).toEqual(reliefFinishingPasses(map, options));
  });

  it('anchors finishing rows inside a mask island that lies between global rows', () => {
    const map = {
      ...flatMap(-2, 4, 7, 0.25),
      inclusion: Uint8Array.from([
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
    };
    const passes = reliefFinishingPasses(map, {
      tool: END_MILL,
      kernel: POINT_KERNEL,
      scallopMm: 0.025,
    });

    expect(passes).toHaveLength(1);
    expect(passes[0]?.kind === 'path3d' ? passes[0].points : []).toEqual([
      { x: 0.375, y: 0.625, z: -2 },
      { x: 0.625, y: 0.625, z: -2 },
    ]);
  });

  it('finishes a one-row side lobe attached between a taller component stride', () => {
    const map = {
      ...flatMap(-2, 4, 5, 0.5),
      inclusion: Uint8Array.from([1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    };
    const passes = reliefFinishingPasses(map, {
      tool: END_MILL,
      kernel: POINT_KERNEL,
      scallopMm: 0.025,
    });
    const lobe = passes.find((pass) => pass.kind === 'path3d' && pass.points[0]?.y === 0.75);

    // The flat lobe row keeps only its end vertices (ADR-421 point reduction).
    expect(lobe?.kind === 'path3d' ? lobe.points : []).toEqual([
      { x: 1.75, y: 0.75, z: -2 },
      { x: 0.75, y: 0.75, z: -2 },
    ]);
  });

  it('reaches a side lobe with the matched ball-nose envelope', () => {
    const widthCells = 16;
    const heightCells = 5;
    const inclusion = new Uint8Array(widthCells * heightCells);
    inclusion.fill(1, widthCells, widthCells * 2);
    for (let row = 0; row < heightCells; row += 1) {
      inclusion[row * widthCells + 8] = 1;
    }
    const map = { ...flatMap(-2, widthCells, heightCells, 0.25), inclusion };
    const passes = reliefFinishingPasses(map, {
      tool: BALL_NOSE,
      kernel: kernelForTool(BALL_NOSE, map.mmPerCell),
      scallopMm: 0.025,
    });
    const branchTargets = passes.flatMap((pass) =>
      pass.kind === 'path3d' ? pass.points.filter((point) => point.y === 0.375 && point.z < 0) : [],
    );

    expect(branchTargets).toHaveLength(15);
  });

  it('represents a reachable singleton as a stock-top-to-target vertical plunge', () => {
    const map = { ...flatMap(-2, 1, 1, 1), inclusion: Uint8Array.of(1) };
    const passes = reliefFinishingPasses(map, {
      tool: END_MILL,
      kernel: POINT_KERNEL,
      scallopMm: 0.025,
    });

    expect(passes).toEqual([
      {
        kind: 'path3d',
        points: [
          { x: 0.5, y: 0.5, z: 0 },
          { x: 0.5, y: 0.5, z: -2 },
        ],
        closed: false,
        lateralFeed: 'z-rate-capped',
      },
    ]);
  });

  it('keeps diagonal-only mask cells in separate vertical passes', () => {
    const map = {
      ...flatMap(-2, 2, 2, 1),
      inclusion: Uint8Array.from([1, 0, 0, 1]),
    };
    const passes = reliefFinishingPasses(map, {
      tool: END_MILL,
      kernel: POINT_KERNEL,
      scallopMm: 0.025,
    });

    expect(passes).toHaveLength(2);
    expect(
      passes.map((pass) =>
        pass.kind === 'path3d' ? pass.points.map(({ x, y }) => ({ x, y })) : [],
      ),
    ).toEqual([
      [
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.5 },
      ],
      [
        { x: 1.5, y: 1.5 },
        { x: 1.5, y: 1.5 },
      ],
    ]);
  });

  it('uses the requested row stride and component far row for a vertical strip', () => {
    // The excluded second column keeps this on the masked planner; a mask that
    // excludes nothing plans as an unmasked stay-down path (ADR-421).
    const map = {
      ...flatMap(-2, 2, 7, 0.25),
      inclusion: Uint8Array.from({ length: 14 }, (_, index) => (index % 2 === 0 ? 1 : 0)),
    };
    const passes = reliefFinishingPasses(map, {
      tool: END_MILL,
      kernel: POINT_KERNEL,
      scallopMm: 0.025,
    });
    const rowYs = passes.map((pass) => (pass.kind === 'path3d' ? pass.points[0]?.y : undefined));

    expect(rowYs).toEqual([0.125, 1.375, 1.625]);
    expect(
      Math.max(...rowYs.slice(1).map((y, index) => (y ?? 0) - (rowYs[index] ?? 0))),
    ).toBeLessThanOrEqual(scallopRowSpacingMm(END_MILL, 0.025));
  });

  it('does not claim a singleton cut when the tool-center envelope stays at stock top', () => {
    const map = { ...flatMap(-2, 2, 1, 1), inclusion: Uint8Array.from([1, 0]) };
    const stockTopKernel = kernelForTool(END_MILL, map.mmPerCell);

    expect(
      reliefFinishingPasses(map, {
        tool: END_MILL,
        kernel: stockTopKernel,
        scallopMm: 0.025,
      }),
    ).toEqual([]);
  });

  it('never rounds sampled row spacing above the ball-nose planar scallop target', () => {
    const scallopMm = 0.025;
    const map = flatMap(-1, 20, 20, 3.175 / 10);
    const passes = reliefFinishingPasses(map, {
      tool: BALL_NOSE,
      kernel: kernelForTool(BALL_NOSE, map.mmPerCell),
      scallopMm,
    });
    const rowYs = finishingRows(passes).map((row) => row.y);
    const gaps = rowYs.slice(1).map((y, index) => y - (rowYs[index] ?? y));
    const maxGap = Math.max(...gaps);
    const radius = BALL_NOSE.diameterMm / 2;
    const planarCusp = radius - Math.sqrt(radius * radius - (maxGap * maxGap) / 4);

    expect(maxGap).toBeLessThanOrEqual(scallopRowSpacingMm(BALL_NOSE, scallopMm));
    expect(planarCusp).toBeLessThanOrEqual(scallopMm);
  });
});
