// ADR-392 Amendment 2: a tile is written as one file per bit, so no tile file
// holds an M0 bit change, and a tile never parks at the bed park's numbers.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, Job } from '../job';
import { cncGrblStrategy } from '../output';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncTiling } from '../scene';
import {
  numberTileBitFiles,
  splitTileJobByBit,
  tileBitFileName,
  tileBitHeader,
  tileNameWithoutBit,
  tileSetUsesSeveralBits,
} from './tile-bit-files';
import { tileJobs } from './tile-plan';

const TILE = { row: 0, col: 1, rect: { minX: 0, minY: 0, maxX: 100, maxY: 100 } };

function group(toolId: string | undefined, toolName: string | undefined, x: number): CncGroup {
  return {
    kind: 'cnc',
    layerId: `L-${toolId ?? 'none'}-${x}`,
    color: '#ff0000',
    cutType: 'engrave',
    ...(toolId === undefined ? {} : { toolId }),
    ...(toolName === undefined ? {} : { toolName }),
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    parkXMm: 0,
    parkYMm: 380,
    parkZMm: 20,
    passes: [
      {
        kind: 'contour',
        zMm: -1,
        closed: false,
        polyline: [
          { x, y: 10 },
          { x: x + 20, y: 10 },
        ],
      },
    ],
  };
}

describe('splitTileJobByBit', () => {
  it('cuts the tile wherever the bit changes and keeps the order, a returning bit included', () => {
    const job: Job = {
      groups: [
        group('em-6350', 'Quarter', 10),
        group('em-6350', 'Quarter', 20),
        group('em-3175', 'Eighth', 30),
        group('em-6350', 'Quarter', 40),
      ],
    };
    const files = numberTileBitFiles(splitTileJobByBit(job));
    expect(files.map((file) => [file.step, file.steps, file.toolName])).toEqual([
      [1, 3, 'Quarter'],
      [2, 3, 'Eighth'],
      [3, 3, 'Quarter'],
    ]);
    expect(files.map((file) => file.job.groups.length)).toEqual([2, 1, 1]);
    for (const file of files) {
      const gcode = cncGrblStrategy.emit(file.job, DEFAULT_DEVICE_PROFILE);
      expect(gcode).not.toMatch(/^M0$/m);
      expect(gcode).not.toContain('; tool change: load');
    }
  });

  it('leaves a one-bit tile whole and unnamed, as before', () => {
    const job: Job = { groups: [group('em-3175', 'Eighth', 10), group('em-3175', 'Eighth', 40)] };
    const [only, ...rest] = numberTileBitFiles(splitTileJobByBit(job));
    expect(rest).toHaveLength(0);
    expect(only?.job).toEqual(job);
    expect(tileBitFileName('job', TILE, only!)).toBe('job_tile-r1-c2');
    expect(tileSetUsesSeveralBits([job])).toBe(false);
  });

  it('names each bit file in order and says what to zero before it runs', () => {
    const job: Job = {
      groups: [group('a', 'Bit A\nM3 S24000 ¼"', 10), group(undefined, undefined, 30)],
    };
    const [first, second] = numberTileBitFiles(splitTileJobByBit(job));
    expect(tileBitFileName('job', TILE, first!)).toBe('job_tile-r1-c2_bit-1-of-2');
    expect(tileBitFileName('job', TILE, second!)).toBe('job_tile-r1-c2_bit-2-of-2');
    expect(tileNameWithoutBit('job_tile-r1-c2_bit-2-of-2')).toBe('job_tile-r1-c2');
    expect(tileNameWithoutBit('job_tile-r1-c2')).toBeNull();
    // Tool names are sanitised like the emitter's own tool-change comment: a
    // line break cannot start a command line, and no realtime byte survives.
    expect(tileBitHeader(first!)).toBe(
      '; bit 1 of 2 for this tile: Bit A M3 S24000 1/4"\n' +
        '; load this bit and zero Z on the stock top before running this file\n',
    );
    expect(tileBitHeader(second!)).toBe(
      '; bit 2 of 2 for this tile: unnamed tool\n' +
        "; keep this tile's X/Y zero; change to this bit and re-zero Z on the stock top before running this file\n",
    );
    expect(tileSetUsesSeveralBits([job])).toBe(true);
  });
});

describe('tileJobs park (ADR-392 Decision 2 in tile files)', () => {
  const tiling: CncTiling = {
    tileWidthMm: 60,
    tileHeightMm: 100,
    overlapMm: 10,
    registrationHoles: true,
    registration: {
      toolId: 'em-6350',
      holeDiameterMm: 6.35,
      depthMm: 3,
      depthPerPassMm: 3,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 12000,
    },
  };
  const machine = {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, parkXMm: 0, parkYMm: 380, parkZMm: 20 },
  };

  it('sets the bed park aside in every tile group, the registration bores included', () => {
    const job: Job = { groups: [group('em-3175', 'Eighth', 0), group('em-3175', 'Eighth', 80)] };
    const result = tileJobs(job, tiling, { machine, device: DEFAULT_DEVICE_PROFILE });
    if (result.kind !== 'ready') throw new Error(`expected tiles, got ${result.kind}`);
    expect(result.tiles.length).toBeGreaterThan(1);
    const groups = result.tiles.flatMap((tile) => tile.job.groups);
    expect(groups.some((tileGroup) => tileGroup.layerId === 'tile-registration')).toBe(true);
    for (const tileGroup of groups) {
      if (tileGroup.kind !== 'cnc') throw new Error('expected CNC groups');
      expect(tileGroup.parkXMm).toBeUndefined();
      expect(tileGroup.parkYMm).toBeUndefined();
      // The park height is not a bed position: it still lifts the bit.
      expect(tileGroup.parkZMm).toBe(20);
    }
    for (const { job: tileJob } of result.tiles) {
      for (const file of splitTileJobByBit(tileJob)) {
        const gcode = cncGrblStrategy.emit(file.job, DEFAULT_DEVICE_PROFILE);
        expect(gcode).not.toContain('Y380.000');
        expect(gcode.trimEnd().split('\n').slice(-3)).toEqual([
          'G0 Z20.000',
          'M5',
          'G0 X0.000 Y0.000',
        ]);
      }
    }
  });
});
