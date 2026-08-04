import { describe, expect, it } from 'vitest';
import { kernelForTool } from '../sim';
import type { CncTool } from '../scene';
import type { Heightmap } from './heightmap';
import { reliefFinishingPasses, scallopRowSpacingMm } from './relief-finishing';

const BALL_NOSE: CncTool = { id: 'bn', name: 'ball', kind: 'ball-nose', diameterMm: 3.175 };
const SMALL_BALL_NOSE: CncTool = {
  id: 'bn-small',
  name: 'small ball',
  kind: 'ball-nose',
  diameterMm: 0.1,
};
const END_MILL: CncTool = { id: 'em', name: 'flat', kind: 'end-mill', diameterMm: 3.175 };

function flatMap(depthMm: number, widthCells = 20, heightCells = 20, mmPerCell = 0.5): Heightmap {
  return {
    widthCells,
    heightCells,
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
  return { widthCells: cells, heightCells: cells, mmPerCell, depth };
}

function rowDirectionSign(
  pass: ReturnType<typeof reliefFinishingPasses>[number] | undefined,
): number {
  if (pass?.kind !== 'path3d') throw new Error('path3d row expected');
  const first = pass.points[0];
  const last = pass.points.at(-1);
  if (first === undefined || last === undefined) throw new Error('row points expected');
  return Math.sign(last.x - first.x);
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
    const last = passes.at(-1);
    if (last?.kind !== 'path3d') throw new Error('path3d row expected');
    expect(last.points[0]?.y).toBeCloseTo((19 + 0.5) * 0.5, 9);
    // Serpentine alternation must survive the appended row.
    expect(rowDirectionSign(last)).toBe(-rowDirectionSign(passes.at(-2)));
  });

  it('does not duplicate the final row when the stride lands on it', () => {
    // 19 cells: rows 0,2..18 land exactly on the far row, so nothing is added.
    const passes = reliefFinishingPasses(flatMap(-3, 20, 19, 0.5), {
      tool: END_MILL,
      kernel: kernelForTool(END_MILL, 0.5),
      scallopMm: 0.025,
    });
    const last = passes.at(-1);
    const previous = passes.at(-2);
    if (last?.kind !== 'path3d' || previous?.kind !== 'path3d') {
      throw new Error('path3d rows expected');
    }
    expect(last.points[0]?.y).not.toBeCloseTo(previous.points[0]?.y ?? 0, 9);
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

  it('serpentines: consecutive rows run in opposite X directions', () => {
    const passes = reliefFinishingPasses(flatMap(-1), {
      tool: BALL_NOSE,
      kernel: kernelForTool(BALL_NOSE, 0.5),
      scallopMm: 0.025,
    });
    expect(passes.length).toBeGreaterThanOrEqual(2);
    expect(rowDirectionSign(passes[0])).toBe(-rowDirectionSign(passes[1]));
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
    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  it('never rounds sampled row spacing above the ball-nose planar scallop target', () => {
    const scallopMm = 0.025;
    const map = flatMap(-1, 20, 20, 3.175 / 10);
    const passes = reliefFinishingPasses(map, {
      tool: BALL_NOSE,
      kernel: kernelForTool(BALL_NOSE, map.mmPerCell),
      scallopMm,
    });
    const rowYs = passes.map((pass) => {
      if (pass.kind !== 'path3d' || pass.points[0] === undefined) {
        throw new Error('path3d row expected');
      }
      return pass.points[0].y;
    });
    const gaps = rowYs.slice(1).map((y, index) => y - (rowYs[index] ?? y));
    const maxGap = Math.max(...gaps);
    const radius = BALL_NOSE.diameterMm / 2;
    const planarCusp = radius - Math.sqrt(radius * radius - (maxGap * maxGap) / 4);

    expect(maxGap).toBeLessThanOrEqual(scallopRowSpacingMm(BALL_NOSE, scallopMm));
    expect(planarCusp).toBeLessThanOrEqual(scallopMm);
  });
});
