import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncContourPass, CncGroup, Job } from '../job';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { applyRampEntry } from './motion-polish';
import { tileJobs } from './tile-plan';

const SMALL_CONTOUR: CncContourPass = {
  kind: 'contour',
  closed: true,
  zMm: -1,
  polyline: [
    { x: 99.9, y: 20 },
    { x: 100.1, y: 20 },
    { x: 100.1, y: 20.2 },
    { x: 99.9, y: 20.2 },
    { x: 99.9, y: 20 },
  ],
};

const EXTENT: CncContourPass = {
  kind: 'contour',
  closed: false,
  zMm: -1,
  polyline: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ],
};

function group(passes: CncGroup['passes']): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'short-ramp',
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 50,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 3.81,
    rampEntryDeg: 5,
    passes,
  };
}

function tiles(job: Job): ReadonlyArray<Job> {
  const result = tileJobs(job, {
    tileWidthMm: 100,
    tileHeightMm: 100,
    overlapMm: 0,
    registrationHoles: false,
  });
  if (result.kind !== 'ready') throw new Error('Expected materialized tile jobs');
  return result.tiles.map((tile) => tile.job);
}

function withoutMarkers(job: Job): Job {
  return {
    ...job,
    groups: job.groups.map((item) =>
      item.kind !== 'cnc'
        ? item
        : {
            ...item,
            passes: item.passes.map((pass) => {
              if (pass.kind !== 'contour') return pass;
              const { entryPlunge: _entryPlunge, ...unmarked } = pass;
              return unmarked;
            }),
          },
    ),
  };
}

function commandLines(gcode: string): ReadonlyArray<string> {
  return gcode.split('\n').filter((line) => line.length > 0 && !line.startsWith(';'));
}

describe('tiled short-ramp plunge provenance', () => {
  it.each([
    { name: 'a contour wholly contained in one tile', split: false, plungeCounts: [1] },
    { name: 'each fragment of a boundary-split contour', split: true, plungeCounts: [2, 1] },
  ])('discloses the retained plunge for $name in emitted output', ({ split, plungeCounts }) => {
    // Use the real ramp planner: this 0.8 mm loop is too short for a retraced
    // entry with the 3.175 mm cutter. It remains a contour with a plunge marker.
    const planned = applyRampEntry([SMALL_CONTOUR], 5, false, 3.175);
    expect(planned).toEqual([{ ...SMALL_CONTOUR, entryPlunge: true }]);
    const source: Job = { groups: [group(split ? [EXTENT, ...planned] : planned)] };
    expect(cncGrblStrategy.emit(source, DEFAULT_DEVICE_PROFILE)).toContain(
      '; cnc entry-advisory: 1 pass plunges: path shorter than one cut width',
    );

    // The extent sets the split grid origin to zero. The loop crosses x=100;
    // its left half has two fragments because the original seam starts there.
    const tiled = tiles(source);
    expect(tiled).toHaveLength(plungeCounts.length);
    for (const [index, tile] of tiled.entries()) {
      const count = plungeCounts[index]!;
      const tileGroup = tile.groups[0];
      if (tileGroup?.kind !== 'cnc') throw new Error('Expected a CNC tile group');
      const gcode = cncGrblStrategy.emit(tile, DEFAULT_DEVICE_PROFILE);
      const wording = count === 1 ? '1 pass plunges' : `${count} passes plunge`;
      expect(gcode).toContain(`; cnc entry-advisory: ${wording}: path shorter than one cut width`);
      expect(
        tileGroup.passes.filter((pass) => pass.kind === 'contour' && pass.entryPlunge === true),
      ).toHaveLength(count);
      expect(commandLines(gcode).filter((line) => line === 'G1 Z-1.000 F50')).toHaveLength(
        count + (split ? 1 : 0),
      );
      // Provenance is informational. Removing it changes no emitted motion,
      // feed, spindle, ordering, or clipped coordinates.
      expect(commandLines(gcode)).toEqual(
        commandLines(cncGrblStrategy.emit(withoutMarkers(tile), DEFAULT_DEVICE_PROFILE)),
      );
    }
  });

  it('does not invent a short-ramp plunge marker when clipping an unmarked contour', () => {
    const tiled = tiles({ groups: [group([EXTENT, SMALL_CONTOUR])] });
    expect(tiled).toHaveLength(2);
    for (const tile of tiled) {
      for (const tileGroup of tile.groups) {
        if (tileGroup.kind !== 'cnc') throw new Error('Expected a CNC tile group');
        for (const pass of tileGroup.passes) {
          expect(pass).not.toHaveProperty('entryPlunge');
        }
      }
      const gcode = cncGrblStrategy.emit(tile, DEFAULT_DEVICE_PROFILE);
      expect(gcode).toContain('G1 Z-1.000 F50');
      expect(gcode).not.toContain('path shorter than one cut width');
    }
  });
});
