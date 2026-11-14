// CNC audit v3 N7-P2-1 / N7-P3-2 (ADR-421 Amendment 5): after #1878 a 60°
// V-bit and a 30° engraver still took 2.7–3.1 mm under the tip along the edge
// band of the N2 refuter's pyramid, and a 1 mm-tip tapered ball and a plain
// 1 mm ball up to 2.9 mm on the ellipse dome, while the note promised one
// pass. The step-down now also judges the stock under the tip along the bit's
// own path. Each case simulates the emitted G-code (the analytic stock
// simulator) and measures the stock under the centre of every lateral move.
import { describe, expect, it } from 'vitest';
import type { CncTool, Project } from '../../core/scene';
import { detectMachineJobWarnings } from '../../ui/laser/machine-job-warnings';
import { emitPreparedGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';
import {
  cncLayer,
  simulateStock,
  stockProject,
  stockRelief,
} from './relief-gcode-stock.test-support';

const PER_PASS_MM = 1.5;
const SLACK_MM = 0.1;

// The N2 refuter's bits (zz-n2r/r-build.ts); the V-bit is the starter vb-60-3175.
const ENGRAVER: CncTool = {
  id: 'r-eng',
  name: 'engraver 30 incl, 0.3 flat, 1/8',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
  tipDiameterMm: 0.3,
};
const TAPERED: CncTool = {
  id: 'r-tb1',
  name: 'tapered ball 1 mm tip, 10 incl, 1/8',
  kind: 'tapered-ball-nose',
  diameterMm: 3.175,
  tipAngleDeg: 10,
  tipDiameterMm: 1,
};
const BALL_1MM: CncTool = { id: 'r-bn1', name: '1 mm ball', kind: 'ball-nose', diameterMm: 1 };

function ramp(deg: number) {
  const slope = Math.tan((deg * Math.PI) / 180);
  return {
    w: 40,
    h: 20,
    maxDepth: 5,
    depth: (x: number) => Math.min(5, Math.max(0, (x - 5) * slope)),
  };
}

// The refuter's surfaces (zz-n2r/r-surf.ts), at (40, 40).
const SURFACES = {
  pyramid: {
    w: 24,
    h: 24,
    maxDepth: 5,
    depth: (x: number, y: number) =>
      Math.max(Math.abs(x - 12), Math.abs(y - 12)) * Math.tan((40 * Math.PI) / 180),
  },
  ellipse: {
    w: 22,
    h: 18,
    maxDepth: 4,
    depth: (x: number, y: number) => {
      const r = Math.hypot((x - 11) / 7, (y - 9) / 5);
      return r < 1 ? 4 - 4 * Math.sqrt(1 - r * r) : 4;
    },
  },
  // Ramps like the N8 verifier's (zz-n8/v/n7r/v-relief.ts).
  ramp10: ramp(10),
  ramp30: ramp(30),
} as const;

function project(surface: keyof typeof SURFACES, finishToolId: string): Project {
  const spec = SURFACES[surface];
  const relief = stockRelief({ ...spec, px: 0.08, at: [40, 40], layer: 'r' });
  return stockProject(
    [relief],
    [
      cncLayer('r', {
        cutType: 'engrave',
        toolId: 'em-3175',
        depthPerPassMm: PER_PASS_MM,
        reliefFinishToolId: finishToolId,
      }),
    ],
    6.35,
    [ENGRAVER, TAPERED, BALL_1MM],
  );
}

function worstUnderTip(surface: keyof typeof SURFACES, toolId: string) {
  const p = project(surface, toolId);
  const prepared = prepareOutput(p);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight).slice(0, 300));
  const gcode = emitPreparedGcode(prepared).gcode;
  const moves = simulateStock(p, gcode, 0.05).moves.filter(
    (move) => move.tool === toolId && !move.rapid && move.len > 0.05,
  );
  const finish = prepared.job.groups.find(
    (group) => group.kind === 'cnc' && group.cutType === 'relief-finish',
  );
  return {
    worst: Math.max(0, ...moves.map((move) => move.centreRem)),
    warnings: detectMachineJobWarnings(p, null, null, prepared),
    stepPasses:
      finish?.kind === 'cnc'
        ? finish.passes.filter((pass) => pass.kind === 'path3d' && pass.reliefStepDown === true)
            .length
        : 0,
  };
}

describe('relief finishing steps down by the stock under its tip (N7-P2-1, N7-P3-2)', () => {
  it.each([
    // Before: 3.12 mm (V-bit) and 2.74 mm (engraver) along ~100 mm of the band.
    ['pyramid', 'vb-60-3175'],
    ['pyramid', 'r-eng'],
    // Before: 2.56 (V-bit), 2.96 (1 mm-tip tapered) and 2.88 (1 mm ball).
    ['ellipse', 'vb-60-3175'],
    ['ellipse', 'r-tb1'],
    ['ellipse', 'r-bn1'],
  ] as const)(
    '%s with %s takes no more than a pass under its tip',
    (surface, toolId) => {
      const { worst, warnings } = worstUnderTip(surface, toolId);
      expect(worst).toBeLessThanOrEqual(PER_PASS_MM + SLACK_MM);
      // The note says the finishing bit steps down, and that now holds.
      expect(warnings.join('\n')).toMatch(
        /finishing bit (cuts it|cuts that) first in \d+ step-down/,
      );
    },
    120_000,
  );
});

describe('a row is judged on the stock still standing when it arrives (N8-P3-1)', () => {
  it('the ⅛" ball on the pyramid meets well under a pass, so it gets no levels and no note', () => {
    // Before: one step-down level (+22 % path) and the "under the path" note for
    // a ball whose tip took at most 0.6 mm.
    const { worst, warnings, stepPasses } = worstUnderTip('pyramid', 'bn-3175');
    expect(worst).toBeLessThanOrEqual(PER_PASS_MM + SLACK_MM);
    expect(stepPasses).toBe(0);
    expect(warnings.join(' ')).not.toContain("finishing bit's path");
  }, 120_000);

  // Before #1904 the ⅛" ball took up to 2.4 mm (10°) and 2.2 mm (30°) under
  // its tip here, so gating the rule to pointed bits would reopen this.
  it.each(['ramp10', 'ramp30'] as const)(
    'the ⅛" ball on the %s, which does meet more than a pass, still steps down',
    (surface) => {
      const { worst, stepPasses } = worstUnderTip(surface, 'bn-3175');
      expect(worst).toBeLessThanOrEqual(PER_PASS_MM + SLACK_MM);
      expect(stepPasses).toBeGreaterThan(0);
    },
    120_000,
  );
});
