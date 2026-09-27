import { describe, expect, it } from 'vitest';
import type { CncGroup } from '../job';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import type { Heightmap } from './heightmap';
import { kernelForTool } from '../sim';
import { reliefFinishingPasses } from './relief-finishing';
import { linkPlanarReliefRows } from './relief-planar-row-links';
import { applyJobOriginOffset } from '../job/job-origin';
import { tileJobs } from '../cnc/tile-plan';
import { representedCncCoordinateMm } from '../cnc/cnc-output-precision';

const tool = { id: 'ball', name: 'ball', kind: 'ball-nose' as const, diameterMm: 3.175 };
function map(): Heightmap {
  return {
    widthCells: 40,
    heightCells: 40,
    widthMm: 10,
    heightMm: 10,
    mmPerCell: 0.25,
    depth: new Float32Array(1600).fill(-2),
  };
}
function passes(
  heightmap: Heightmap,
  linkPlanarRows = false,
  feedMmPerMin = 1000,
  plungeMmPerMin = 200,
) {
  return reliefFinishingPasses(heightmap, {
    tool,
    kernel: kernelForTool(tool, heightmap.mmPerCell),
    scallopMm: 0.025,
    linkPlanarRows,
    rowLinkCuttingValues: { feedMmPerMin, plungeMmPerMin, safeZMm: 5 },
  });
}
function group(p: CncGroup['passes']): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'relief',
    color: '#000000',
    cutType: 'relief-finish',
    toolDiameterMm: tool.diameterMm,
    passes: p,
    feedMmPerMin: 1000,
    plungeMmPerMin: 200,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 5,
    retractBetweenPasses: false,
  };
}
function verifyConnections(unlinked: CncGroup['passes'], linked: CncGroup['passes']): number {
  let connections = 0;
  const originalRows = unlinked.filter((pass) => pass.kind === 'path3d');
  const linkedRows = linked.filter((pass) => pass.kind === 'path3d');
  for (let index = 1; index < linkedRows.length; index += 1) {
    const before = originalRows[index];
    const after = linkedRows[index];
    const prior = linkedRows[index - 1];
    if (before === undefined || after === undefined || prior === undefined)
      throw new Error('Expected rows');
    if (after.points.length === before.points.length) continue;
    connections += 1;
    expect(after.points.slice(-before.points.length)).toEqual(before.points);
    expect(after.points[0]).toEqual(prior.points.at(-1));
  }
  return connections;
}

describe('proved planar relief row connections', () => {
  it('keeps independent entries when slow cutting makes retracing costlier than the removed plunge', () => {
    expect(passes(map(), true, 100, 1000)).toEqual(passes(map()));
    expect(passes(map(), true, Number.NaN, 200)).toEqual(passes(map()));
    expect(passes(map(), true, 1000, 200)).not.toEqual(passes(map()));
  });
  it('keeps all sampled rows and recovery boundaries while removing inter-row safe-Z travel', () => {
    const unlinked = passes(map());
    const linked = passes(map(), true);
    expect(linked).toHaveLength(unlinked.length);
    const connections = verifyConnections(unlinked, linked);
    const oldOutput = cncGrblStrategy.emit({ groups: [group(unlinked)] }, DEFAULT_DEVICE_PROFILE);
    const output = cncGrblStrategy.emit({ groups: [group(linked)] }, DEFAULT_DEVICE_PROFILE);
    expect(oldOutput.match(/^G0 Z5\.000$/gm)?.length).toBeGreaterThan(10);
    expect(connections).toBeGreaterThan(8);
    expect(output.match(/^G0 Z5\.000$/gm)?.length).toBe(
      (oldOutput.match(/^G0 Z5\.000$/gm)?.length ?? 0) - connections,
    );
    // Near-Y-boundary rows cannot place a full cutter in known stock.
    expect(linked[1]).toEqual(unlinked[1]);
  });
  it('retains independent entries for masks, a raised whole-cell obstruction, or unequal heights', () => {
    const heightmap = map();
    const rows = passes(heightmap);
    expect(
      linkPlanarReliefRows(
        { ...heightmap, inclusion: new Uint8Array(1600).fill(1) },
        rows,
        tool.diameterMm,
        1,
      ),
    ).toBe(rows);
    heightmap.depth[20 * 40] = 0;
    const raised = linkPlanarReliefRows(heightmap, rows, tool.diameterMm, 1);
    expect(raised[10]).toBe(rows[10]);
    const first = rows[9];
    const next = rows[10];
    if (first?.kind !== 'path3d' || next?.kind !== 'path3d') throw new Error('Expected rows');
    expect(linkPlanarReliefRows(map(), [first, next], tool.diameterMm, 1)[1]).not.toBe(next);
    const sloped = {
      ...next,
      points: next.points.map((point) => ({ ...point, z: point.z + 0.01 })),
    };
    expect(linkPlanarReliefRows(map(), [first, sloped], tool.diameterMm, 1)[1]).toBe(sloped);
  });
  it('does not accept a link that rounds below the sampled surface', () => {
    const flatRows = passes(map());
    expect(linkPlanarReliefRows(map(), flatRows, tool.diameterMm, 1)[10]).not.toBe(flatRows[10]);
    const heightmap = map();
    heightmap.depth.fill(-1.9996);
    const rows = passes(heightmap);
    expect(linkPlanarReliefRows(heightmap, rows, tool.diameterMm, 1)[10]).toBe(rows[10]);
  });
  it('bounds the actual rotated large-coordinate parser error rather than just decimal rounding', () => {
    const from = { x: 1.0015, y: 4, z: -2 };
    const to = { ...from, y: 4.5 };
    const rows: CncGroup['passes'] = [
      { kind: 'path3d', closed: false, points: [{ ...from, x: 8.5 }, from, { ...from, x: 0.125 }] },
      { kind: 'path3d', closed: false, points: [{ ...to, x: 0.125 }, to, { ...to, x: 8.5 }] },
    ];
    expect(linkPlanarReliefRows(map(), rows, 2, 1)[1]).not.toBe(rows[1]);
    const coordinate = 32768.01449;
    const offset = {
      x: coordinate - (from.x - from.y) / Math.SQRT2,
      y: coordinate - (from.x + from.y) / Math.SQRT2,
    };
    expect(Math.abs(representedCncCoordinateMm(coordinate) - coordinate)).toBeGreaterThan(0.0015);
    const transformed = linkPlanarReliefRows(map(), rows, 2, 1, (point) => ({
      x: (point.x - point.y) / Math.SQRT2 + offset.x,
      y: (point.x + point.y) / Math.SQRT2 + offset.y,
    }));
    expect(transformed[1]).toBe(rows[1]);
  });
  it('honours a partially occupied terminal cell as the physical domain boundary', () => {
    const rows: CncGroup['passes'] = [
      {
        kind: 'path3d',
        closed: false,
        points: [
          { x: 1, y: 4, z: -2 },
          { x: 8.625, y: 4, z: -2 },
          { x: 9.5, y: 4, z: -2 },
        ],
      },
      {
        kind: 'path3d',
        closed: false,
        points: [
          { x: 9.5, y: 4.5, z: -2 },
          { x: 8.625, y: 4.5, z: -2 },
          { x: 1, y: 4.5, z: -2 },
        ],
      },
    ];
    expect(linkPlanarReliefRows(map(), rows, 2, 1)[1]).not.toBe(rows[1]);
    expect(linkPlanarReliefRows({ ...map(), widthMm: 9.6 }, rows, 2, 1)[1]).toBe(rows[1]);
  });
  it('restores exact independent rows before any nonzero placement or tile clipping', () => {
    const independent = { groups: [group(passes(map()))] };
    const linked = { groups: [group(passes(map(), true))] };
    expect(linked.groups[0]?.passes[10]).not.toEqual(independent.groups[0]?.passes[10]);
    expect(applyJobOriginOffset(linked, { x: 0, y: 0 })).toBe(linked);
    for (const offset of [
      { x: 0.0001, y: 0 },
      { x: 32768.01449, y: 32768.01449 },
    ]) {
      expect(applyJobOriginOffset(linked, offset)).toEqual(
        applyJobOriginOffset(independent, offset),
      );
    }
    const tiling = { tileWidthMm: 6, tileHeightMm: 6, overlapMm: 1, registrationHoles: false };
    expect(tileJobs(linked, tiling)).toEqual(tileJobs(independent, tiling));
  });
});
