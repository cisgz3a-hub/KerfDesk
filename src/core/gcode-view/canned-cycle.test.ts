// Canned cycles, end to end (ADR-255 stage 12). The competitive audit found
// this as a CORRECTNESS gap: before this, a drilling program rendered its
// rapids and nothing where the holes were, which looks complete and is not.

import { describe, expect, it } from 'vitest';
import { expandCannedCycle } from './canned-cycle';
import { buildGcodeRenderModel } from './gcode-render-model';
import { findProgramIssues } from './program-findings';
import { SEG_KIND, SEG_MOTION, type GcodeRenderModel } from './render-model-types';

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

/** Deepest Z the program ever reaches, over every drawn segment. */
function deepestZ(built: GcodeRenderModel): number {
  let deepest = 0;
  for (let index = 0; index < built.segmentCount; index += 1) {
    const base = index * 6;
    deepest = Math.min(deepest, built.positions[base + 2] ?? 0, built.positions[base + 5] ?? 0);
  }
  return deepest;
}

function feedSegments(built: GcodeRenderModel): number {
  let count = 0;
  for (let index = 0; index < built.segmentCount; index += 1) {
    if (built.segMotion[index] !== SEG_MOTION.rapid) count += 1;
  }
  return count;
}

describe('G81 drilling', () => {
  const PROGRAM = ['G21 G90', 'M3 S1000', 'G0 Z5', 'G81 X10 Y10 Z-3 R1 F200', 'G80', 'M2'].join(
    '\n',
  );

  it('actually drills the hole', () => {
    const built = model(PROGRAM);
    expect(built.segmentCount).toBeGreaterThan(0);
    expect(deepestZ(built)).toBeCloseTo(-3, 6);
    // The plunge is a feed move, not a rapid.
    expect(feedSegments(built)).toBeGreaterThan(0);
  });

  it('classifies the plunge as a plunge', () => {
    const built = model(PROGRAM);
    const kinds = [...built.segKind];
    expect(kinds).toContain(SEG_KIND.plunge);
    expect(kinds).toContain(SEG_KIND.retract);
  });

  it('repeats the hole for a bare X/Y line, reusing sticky Z and R', () => {
    const one = model(PROGRAM);
    const two = model(
      ['G21 G90', 'M3 S1000', 'G0 Z5', 'G81 X10 Y10 Z-3 R1 F200', 'X30', 'G80', 'M2'].join('\n'),
    );
    expect(two.segmentCount).toBeGreaterThan(one.segmentCount);
    expect(deepestZ(two)).toBeCloseTo(-3, 6);
  });

  it('stops drilling after G80', () => {
    const after = model(
      ['G21 G90', 'M3 S1000', 'G0 Z5', 'G81 X10 Y10 Z-3 R1 F200', 'G80', 'X50', 'M2'].join('\n'),
    );
    // The post-G80 X50 is an ordinary move at the retract height, not a hole.
    const lastLineSegments = [...after.segLine].filter((line) => line === 5).length;
    expect(lastLineSegments).toBe(1);
  });
});

describe('G83 peck drilling', () => {
  it('pecks in steps rather than one plunge', () => {
    const peck = model(
      ['G21 G90', 'M3 S1000', 'G0 Z5', 'G83 X10 Y10 Z-6 R1 Q2 F200', 'G80', 'M2'].join('\n'),
    );
    const straight = model(
      ['G21 G90', 'M3 S1000', 'G0 Z5', 'G81 X10 Y10 Z-6 R1 F200', 'G80', 'M2'].join('\n'),
    );
    expect(peck.segmentCount).toBeGreaterThan(straight.segmentCount);
    expect(deepestZ(peck)).toBeCloseTo(-6, 6);
  });
});

describe('retract mode', () => {
  it('G98 returns to the starting height, G99 to the R plane', () => {
    const g98 = expandCannedCycle({
      cycle: 81,
      retract: 98,
      target: { x: 10, y: 0, z: -3 },
      rPlane: 1,
      peck: null,
      from: { x: 0, y: 0, z: 5 },
      initialZ: 5,
    });
    const g99 = expandCannedCycle({
      cycle: 81,
      retract: 99,
      target: { x: 10, y: 0, z: -3 },
      rPlane: 1,
      peck: null,
      from: { x: 0, y: 0, z: 5 },
      initialZ: 5,
    });
    expect(g98[g98.length - 1]?.to.z).toBeCloseTo(5, 6);
    expect(g99[g99.length - 1]?.to.z).toBeCloseTo(1, 6);
  });
});

describe('Program Health', () => {
  it('warns that GRBL cannot run canned cycles', () => {
    const findings = findProgramIssues(
      model(['G21 G90', 'M3 S1000', 'G0 Z5', 'G81 X10 Y10 Z-3 R1 F200', 'G80', 'M2'].join('\n')),
    );
    const finding = findings.find((entry) => entry.id === 'canned-cycle-unsupported');
    expect(finding?.severity).toBe('warning');
    expect(finding?.detail).toContain('GRBL does not implement canned cycles');
  });

  it('no longer reports the cycle words as unsupported', () => {
    const built = model(
      ['G21 G90', 'M3 S1000', 'G0 Z5', 'G83 X10 Y10 Z-6 R1 Q2 F200', 'G80', 'M2'].join('\n'),
    );
    const words = built.unsupportedWords.map((entry) => entry.word);
    expect(words).not.toContain('G83');
    expect(words).not.toContain('G80');
    expect(words).not.toContain('Q');
  });
});
