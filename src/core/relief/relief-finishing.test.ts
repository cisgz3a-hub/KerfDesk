import { describe, expect, it } from 'vitest';
import { kernelForTool } from '../sim';
import type { CncTool } from '../scene';
import type { Heightmap } from './heightmap';
import { reliefFinishingPasses, scallopRowSpacingMm } from './relief-finishing';

const BALL_NOSE: CncTool = { id: 'bn', name: 'ball', kind: 'ball-nose', diameterMm: 3.175 };
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
});

describe('reliefFinishingPasses', () => {
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
});
