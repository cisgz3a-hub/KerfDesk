// CNC preview parks (ADR-491 Amendment 2; meta audit M7-P2-5). Split from
// toolpath-cnc.test.ts at the ADR-015 size cap.

import { describe, expect, it } from 'vitest';
import { parseGrblCncCoordinate } from '../cnc/coordinate-representation';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { scanGcodeWords } from '../gcode';
import { cncGrblStrategy } from '../output';
import type { CncGroup, CncPass, Job } from './job';
import { buildToolpath } from './toolpath';

const SAFE_Z_MM = 3.81;
const REPRESENTED_SAFE_Z_MM = parseGrblCncCoordinate('3.810');

function group(passes: ReadonlyArray<CncPass>, overrides: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: SAFE_Z_MM,
    passes,
    ...overrides,
  };
}

function squareLoop(at: number, size: number): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x: at, y: at },
    { x: at + size, y: at },
    { x: at + size, y: at + size },
    { x: at, y: at + size },
    { x: at, y: at },
  ];
}

function fmt(n: number): string {
  return n.toFixed(3);
}

// With a park requested, the preview draws the emitter's park lift and park
// move at every bit change and at the job end, a configured park winning.

function emittedRapids(gcode: string): { readonly z: string[]; readonly xy: string[] } {
  const z: string[] = [];
  const xy: string[] = [];
  for (const raw of gcode.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const words = scanGcodeWords(line);
    if (words[0]?.letter !== 'G' || words[0].value !== 0) continue;
    const value = (letter: string): number | undefined =>
      words.find((word) => word.letter === letter)?.value;
    const x = value('X');
    const y = value('Y');
    const zWord = value('Z');
    if (x !== undefined && y !== undefined) xy.push(`${fmt(x)},${fmt(y)}`);
    else if (zWord !== undefined) z.push(fmt(zWord));
  }
  return { z, xy };
}

describe('CNC preview parks match the emitted program', () => {
  const park = { parkXMm: 5, parkYMm: 250, parkZMm: 40 };
  const twoBits: Job = {
    groups: [
      group([{ kind: 'contour', zMm: -1, polyline: squareLoop(10, 20), closed: true }], {
        toolId: 'em-3175',
        toolName: '1/8 end mill',
        ...park,
      }),
      group([{ kind: 'contour', zMm: -2, polyline: squareLoop(60, 20), closed: true }], {
        toolId: 'em-6350',
        toolName: '1/4 end mill',
        ...park,
      }),
    ],
  };

  it('lifts to the park height and moves to the configured park at the bit change and job end', () => {
    const toolpath = buildToolpath(twoBits, {
      startPoint: { x: 0, y: 0 },
      parkPoint: { x: 0, y: 0 },
    });
    const parkLifts = toolpath.steps.filter(
      (step) => step.kind === 'plunge' && step.toZ === parseGrblCncCoordinate('40.000'),
    );
    const parkMoves = toolpath.steps.filter(
      (step) => step.kind === 'travel' && step.to.x === 5 && step.to.y === 250,
    );
    expect(parkLifts).toHaveLength(2);
    expect(parkMoves).toHaveLength(2);
    for (const move of parkMoves) {
      if (move.kind !== 'travel') throw new Error('expected travel');
      expect(move.z).toEqual({
        from: parseGrblCncCoordinate('40.000'),
        to: parseGrblCncCoordinate('40.000'),
      });
    }
    const last = toolpath.steps.at(-1);
    if (last?.kind !== 'travel') throw new Error('expected the job-end park last');
    expect(last.to).toEqual({ x: 5, y: 250 });

    const emitted = emittedRapids(cncGrblStrategy.emit(twoBits, DEFAULT_DEVICE_PROFILE));
    expect(emitted.z.filter((z) => z === '40.000')).toHaveLength(2);
    expect(emitted.xy.filter((xy) => xy === '5.000,250.000')).toHaveLength(2);
  });

  it('parks a job with no configured park at the finish fallback, lifted first', () => {
    const single: Job = {
      groups: [group([{ kind: 'contour', zMm: -1, polyline: squareLoop(10, 20), closed: true }])],
    };
    const toolpath = buildToolpath(single, {
      startPoint: { x: 0, y: 0 },
      parkPoint: { x: 0, y: 0 },
    });
    const tail = toolpath.steps.slice(-2);
    expect(tail.map((step) => step.kind)).toEqual(['plunge', 'travel']);
    const [lift, move] = tail;
    if (lift?.kind !== 'plunge' || move?.kind !== 'travel') throw new Error('expected park');
    expect(lift.toZ).toBe(REPRESENTED_SAFE_Z_MM);
    expect(move.to).toEqual({ x: 0, y: 0 });
    expect(move.z).toEqual({ from: REPRESENTED_SAFE_Z_MM, to: REPRESENTED_SAFE_Z_MM });
  });

  it('draws no park when the caller asks for none', () => {
    const toolpath = buildToolpath(twoBits, { startPoint: { x: 0, y: 0 } });
    expect(toolpath.steps.some((step) => step.kind === 'travel' && step.to.x === 5)).toBe(false);
  });
});
