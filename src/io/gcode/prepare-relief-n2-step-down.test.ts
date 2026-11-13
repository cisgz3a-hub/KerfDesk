// CNC audit v3 N2 follow-ups to the relief step-down (ADR-421 Amendment 4).
// Each case runs the emitted G-code through the analytic stock simulator
// (relief-gcode-stock.test-support.ts) and measures the stock under the tip
// of every lateral finishing or rest move: no move may take more than one
// depth per pass (1.5 mm) under its centre, plus the grid's own slack.
import { describe, expect, it } from 'vitest';
import type { CncTool, Project } from '../../core/scene';
import { emitGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';
import { detectMachineJobWarnings } from '../../ui/laser/machine-job-warnings';
import {
  cncLayer,
  simulateStock,
  stockProject,
  stockRelief,
} from './relief-gcode-stock.test-support';

const PER_PASS_MM = 1.5;
const SLACK_MM = 0.1;

// A 1 mm-tip tapered ball (10° a side) on a 1/8" body, and a 30° engraver
// with a 0.3 mm flat, both stored by their widest cut (ADR-368).
const TAPERED: CncTool = {
  id: 'tb-1-10',
  name: 'Tapered ball 1 mm tip',
  kind: 'tapered-ball-nose',
  diameterMm: 3.175,
  tipDiameterMm: 1,
  tipAngleDeg: 20,
};
const ENGRAVER: CncTool = {
  id: 'eng-30',
  name: '30° engraver',
  kind: 'engraving',
  diameterMm: 3.175,
  tipDiameterMm: 0.3,
  tipAngleDeg: 30,
};
const BALL_1MM: CncTool = { id: 'bn-1000', name: '1 mm ball', kind: 'ball-nose', diameterMm: 1 };

function run(project: Project) {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight).slice(0, 300));
  const gcode = emitGcode(project).gcode;
  return { prepared, gcode, warnings: detectMachineJobWarnings(project, null, null, prepared) };
}

// The most stock any lateral move of `toolId` left under its centre.
function worstUnderCentre(project: Project, gcode: string, toolId: string): number {
  const moves = simulateStock(project, gcode, 0.05).moves.filter(
    (move) => move.tool === toolId && !move.rapid && move.len > 0.05,
  );
  return Math.max(0, ...moves.map((move) => move.centreRem));
}

// A 30 mm relief whose 3 mm floor runs to every edge (the X6 edge-band case).
function flatFloor(finish: CncTool): Project {
  const relief = stockRelief({
    w: 30,
    h: 30,
    px: 0.25,
    maxDepth: 3,
    at: [20, 20],
    layer: 'r',
    depth: () => 3,
  });
  return stockProject(
    [relief],
    [
      cncLayer('r', {
        toolId: 'em-3175',
        depthPerPassMm: PER_PASS_MM,
        reliefFinishToolId: finish.id,
      }),
    ],
    4,
    [finish],
  );
}

describe('narrowing finishing bits step down in the edge band by their tip (N2-P2-1)', () => {
  it.each([TAPERED, ENGRAVER])(
    '$name takes no more than a pass under its tip',
    (finish) => {
      const project = flatFloor(finish);
      const { gcode, warnings } = run(project);
      // Main: the 1 mm-tip tapered ball rode the edge row at Z−2.3 (2.3–2.8 mm
      // under its tip) and the engraver went to 4.3 mm, with no level or note.
      expect(worstUnderCentre(project, gcode, finish.id)).toBeLessThanOrEqual(
        PER_PASS_MM + SLACK_MM,
      );
      if (finish === TAPERED) {
        // Named by its tip, not "the 3.175 mm finishing bit".
        expect(warnings).toContainEqual(
          expect.stringContaining('The 1 mm-tip tapered ball finishing bit cuts it first in'),
        );
      }
    },
    300_000,
  );
});

describe('a small ball steps down beside an interior wall parallel to its rows (N2r-P2-1)', () => {
  // The refuter's raised bar (r-wall.ts): a 24 × 18 mm relief at 0.05 mm
  // pixels, the bar at the stock top over local x 6–18, y 6–12 on a 3 mm
  // floor, its long sides along the finishing rows (raster X).
  it('the 1 mm ball takes no more than a pass under its centre along the bar', () => {
    const relief = stockRelief({
      w: 24,
      h: 18,
      px: 0.05,
      maxDepth: 3,
      at: [40, 40],
      layer: 'r',
      depth: (x, y) => (x > 6 && x < 18 && y > 6 && y < 12 ? 0 : 3),
    });
    const project = stockProject(
      [relief],
      [
        cncLayer('r', {
          toolId: 'em-3175',
          depthPerPassMm: PER_PASS_MM,
          reliefFinishToolId: BALL_1MM.id,
        }),
      ],
      4,
      [BALL_1MM],
    );
    const { gcode } = run(project);
    // Main: 9.97 mm along the bar at Z−3, F1000, up to 3.0 mm under the centre.
    expect(worstUnderCentre(project, gcode, BALL_1MM.id)).toBeLessThanOrEqual(
      PER_PASS_MM + SLACK_MM,
    );
  }, 300_000);
});

describe('rest finishing after a 1/4" ball steps a 1/16" ball down (N2-P2-2)', () => {
  // The refuter's dome with its floor to the edge (r-p22.ts): em-6350 rough,
  // bn-6350 finish, bn-1588 rest; the 1/16" radius ties 6.35 / 8.
  function dome(rest: string): Project {
    const relief = stockRelief({
      w: 24,
      h: 24,
      px: 0.1,
      maxDepth: 4,
      at: [20, 20],
      layer: 'r',
      depth: (x, y) => 4 * Math.min(1, ((x - 12) / 8) ** 2 + ((y - 12) / 6) ** 2),
    });
    return stockProject(
      [relief],
      [
        cncLayer('r', {
          toolId: 'em-6350',
          depthPerPassMm: PER_PASS_MM,
          reliefFinishToolId: 'bn-6350',
          reliefRestFinishToolId: rest,
        }),
      ],
      6.35,
    );
  }

  it.each(['bn-1588', 'bn-3175'])(
    'the %s rest ball takes no more than a pass under its centre',
    (rest) => {
      const project = dome(rest);
      const { prepared, gcode } = run(project);
      // Main: bn-1588 8.7 mm at Z−4 with 3.76 mm under its centre; bn-3175 3.06 mm.
      expect(worstUnderCentre(project, gcode, rest)).toBeLessThanOrEqual(PER_PASS_MM + SLACK_MM);
      const plan = prepared.job.cncCompilation?.reliefPlans?.find(
        (p) => p.stage === 'rest-finishing',
      );
      expect(plan?.predecessorMissedAreaMm2).toBeGreaterThan(0);
      expect(plan?.finishingStepLevels).toBeGreaterThanOrEqual(1);
      // N2-P3-1: rest takes the finish's 0.025 mm scallop, not a coarser 0.05.
      expect(plan?.scallopMm).toBe(0.025);
    },
    300_000,
  );
});
