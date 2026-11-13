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
  return {
    worst: Math.max(0, ...moves.map((move) => move.centreRem)),
    warnings: detectMachineJobWarnings(p, null, null, prepared),
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
