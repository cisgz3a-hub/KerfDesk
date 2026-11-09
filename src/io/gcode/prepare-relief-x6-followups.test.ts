// Rolling audit v12 X6 follow-ups to #1643 (ADR-572 Amendment 4, ADR-421
// Amendment 3), each measured on the emitted G-code by the refuter's analytic
// stock simulator (relief-gcode-stock.test-support.ts, from zz-x6r/x.mts).
import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, type Project } from '../../core/scene';
import { cncOperationDetail } from '../../ui/laser/job-review/job-review-detail-facts';
import { buildEffectiveOperationReview } from '../../ui/laser/job-review/job-review-effective-operations';
import { detectMachineJobWarnings } from '../../ui/laser/machine-job-warnings';
import { emitGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';
import {
  circleLoop,
  cncLayer,
  loopMaterial,
  simulateStock,
  squareLoop,
  stockProject,
  stockRelief,
  vectorObject,
} from './relief-gcode-stock.test-support';

/** Prepare, emit, and read the Job Review line and warnings for one layer. */
function compiledStock(project: Project, layerId: string) {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight).slice(0, 400));
  const gcode = emitGcode(project).gcode;
  const effective = buildEffectiveOperationReview(prepared.job, project.scene).find(
    (entry) => entry.layerId === layerId,
  );
  const layer = project.scene.layers.find((entry) => entry.id === layerId);
  const stockMm = project.machine?.kind === 'cnc' ? project.machine.stock.thicknessMm : 0;
  const detail = cncOperationDetail(
    layer?.cnc ?? DEFAULT_CNC_LAYER_SETTINGS,
    stockMm,
    effective?.plungingReliefStages,
    effective?.relief,
    effective?.unrampedShapes,
    effective === undefined ? undefined : effective.tabbedShapes === true,
    effective?.strategyFallback,
    effective?.projection,
  );
  const warnings = detectMachineJobWarnings(project, null, null, prepared);
  return { prepared, gcode, detail, warnings };
}

// The refuter's plaque (tabs.mts): a 50 mm relief with a raised disc (r 12)
// and a 3 mm frame at full height, its background floor F mm deep between
// them, cut out by a projected on-path circle (r 16) in the floor ring.
function plaque(options: {
  readonly floorMm: number;
  readonly stockMm: number;
  readonly verticalMm: number;
  readonly perPassMm: number;
  readonly tabHeightMm?: number;
}) {
  const relief = stockRelief({
    w: 50,
    h: 50,
    px: 0.25,
    maxDepth: Math.max(options.floorMm, 1),
    at: [20, 20],
    layer: 'r',
    depth: (x, y) =>
      Math.hypot(x - 25, y - 25) < 12 || x < 3 || y < 3 || x > 47 || y > 47 ? 0 : options.floorMm,
  });
  const loop = circleLoop(45, 45, 16);
  const project = stockProject(
    [relief, vectorObject('p', [loop])],
    [
      cncLayer('r', { toolId: 'em-3175', depthPerPassMm: 1.5, reliefFinishToolId: 'bn-3175' }),
      cncLayer('p', {
        cutType: 'profile-on-path',
        toolId: 'em-3175',
        depthMm: 1,
        depthPerPassMm: options.perPassMm,
        tabsEnabled: true,
        ...(options.tabHeightMm === undefined ? {} : { tabHeightMm: options.tabHeightMm }),
        reliefProjection: {
          reliefObjectId: 'rel',
          depthMm: options.verticalMm,
          depthConvention: 'vertical',
          sampleSpacingMm: 0.2,
        },
      }),
    ],
    options.stockMm,
  );
  return { project, loop };
}

describe('projected tabs are only as thick as the relief floor under them (X6-P1-1)', () => {
  it.each([
    { name: 'T1 floor 5 in 6', floorMm: 5, verticalMm: 2, perPassMm: 1, bridgeMm: 1 },
    {
      name: 'T2 floor 5.5 in 6, tab 3',
      floorMm: 5.5,
      verticalMm: 1,
      perPassMm: 1,
      bridgeMm: 0.5,
      tabHeightMm: 3,
    },
  ])(
    '$name: Job Review and the warning name the real bridge',
    (c) => {
      const { project, loop } = plaque({ ...c, stockMm: 6 });
      const { prepared, gcode, detail, warnings } = compiledStock(project, 'p');
      const bridges = loopMaterial(project, simulateStock(project, gcode, 0.1), loop, 6).bridges;
      // The simulated program leaves four bridges as thick as the floor.
      expect(bridges).toHaveLength(4);
      for (const bridge of bridges) expect(bridge).toBeCloseTo(c.bridgeMm, 1);
      const facts = prepared.job.cncCompilation?.reliefPlans?.find(
        (p) => p.stage === 'projection',
      )?.projection;
      expect(facts?.thinnestTabMm).toBeCloseTo(c.bridgeMm, 1);
      const set = c.tabHeightMm ?? 2;
      expect(detail).toContain(`only ${c.bridgeMm} mm thick: the relief floor under them`);
      expect(detail).toContain(`(${set} mm set)`);
      expect(warnings).toContainEqual(
        expect.stringContaining(
          `holding tabs are only ${c.bridgeMm} mm thick, not the ${set} mm set`,
        ),
      );
      if (c.bridgeMm < 1)
        expect(warnings.join('\n')).toContain('Tabs this thin can break and free the parts.');
    },
    240_000,
  );

  it('T5: a relief floor at the stock bottom leaves the tabs nothing, so the part is cut free', () => {
    const { project, loop } = plaque({ floorMm: 6, stockMm: 6, verticalMm: 0.5, perPassMm: 0.5 });
    const { gcode, detail, warnings } = compiledStock(project, 'p');
    expect(loopMaterial(project, simulateStock(project, gcode, 0.1), loop, 6).most).toBeLessThan(
      0.1,
    );
    expect(detail).toContain('no holding tab on 1 closed shape cut free');
    expect(warnings).toContainEqual(
      expect.stringContaining('the relief floor under them is already at the stock bottom'),
    );
  }, 240_000);

  it('T0 control: a floor deeper than the tab keeps the set height and no thin note', () => {
    const { project } = plaque({ floorMm: 4, stockMm: 6, verticalMm: 2.5, perPassMm: 1 });
    const { detail, warnings } = compiledStock(project, 'p');
    expect(detail).toContain('6 × 2 mm above the stock bottom');
    expect(warnings.join('\n')).not.toContain('holding tabs are only');
  }, 240_000);
});

describe('a projection steps down from the stock a roughed-only relief leaves (X6-P2-1)', () => {
  // The refuter's L1 (load.mts): a 40 mm ramp 0 → 5 mm roughed at 1.5 mm per
  // pass with no finishing bit; a projected engrave on a 16 mm square at
  // Vertical depth 1 and 0.5 mm per pass.
  function ramp(finishToolId?: string) {
    const relief = stockRelief({
      w: 40,
      h: 40,
      px: 0.25,
      maxDepth: 5,
      at: [20, 20],
      layer: 'r',
      depth: (x) => 5 * (x / 40),
    });
    return stockProject(
      [relief, vectorObject('p', [squareLoop(32, 32, 16)])],
      [
        cncLayer('r', {
          toolId: 'em-3175',
          depthPerPassMm: 1.5,
          ...(finishToolId === undefined ? {} : { reliefFinishToolId: finishToolId }),
        }),
        cncLayer('p', {
          cutType: 'engrave',
          toolId: 'em-3175',
          depthMm: 1,
          depthPerPassMm: 0.5,
          reliefProjection: {
            reliefObjectId: 'rel',
            depthMm: 1,
            depthConvention: 'vertical',
            sampleSpacingMm: 0.2,
          },
        }),
      ],
      6.35,
    );
  }

  it('L1: no projection move takes more than its depth per pass off the roughed stock', () => {
    const project = ramp();
    const { gcode, detail } = compiledStock(project, 'p');
    const moves = simulateStock(project, gcode, 0.05).moves.filter(
      (move) => move.layer === 'p' && !move.rapid && move.len > 0.05,
    );
    // 2.58 mm before: the first level sat one pass under the target surface.
    // A flat bit crossing the 1:8 ramp meets stock at its leading edge up to
    // slope × radius higher (0.125 × 1.59 = 0.2 mm), so one pass plus that.
    expect(Math.max(...moves.map((move) => move.maxRem))).toBeLessThanOrEqual(0.5 + 0.2);
    expect(detail).toContain('from 2 mm above it (the relief is only roughed first)');
  }, 240_000);

  it('a finished target starts at its surface, as before', () => {
    const { detail } = compiledStock(ramp('bn-3175'), 'p');
    expect(detail).not.toContain('above it');
    expect(detail).toContain('in 2 passes of up to 0.5 mm');
  }, 240_000);
});

describe('rest finishing steps down where the finishing bit could not enter (X6-P2-2)', () => {
  // The refuter's R1 (rest.mts): a 20 mm relief with a 2.4 × 5 mm groove along
  // the rows; 1/4" end mill roughing, 1/8" ball finishing, 1/16" ball rest.
  it('R1: no rest move takes more than its depth per pass off one cell, and Job Review says why', () => {
    const relief = stockRelief({
      w: 20,
      h: 20,
      px: 0.05,
      maxDepth: 5,
      at: [20, 20],
      layer: 'r',
      depth: (_x, y) => (Math.abs(y - 10) < 1.2 ? 5 : 0),
    });
    const project = stockProject(
      [relief],
      [
        cncLayer('r', {
          toolId: 'em-6350',
          depthPerPassMm: 1.5,
          reliefFinishToolId: 'bn-3175',
          reliefRestFinishToolId: 'bn-1588',
        }),
      ],
      6.35,
    );
    const { prepared, gcode, warnings } = compiledStock(project, 'r');
    const rest = simulateStock(project, gcode, 0.05).moves.filter(
      (move) => move.tool === 'bn-1588' && !move.rapid && move.len > 0.2,
    );
    // 4.72 mm before, full width at Z−5.
    expect(Math.max(...rest.map((move) => move.maxRem))).toBeLessThanOrEqual(1.5 + 0.1);
    const plan = prepared.job.cncCompilation?.reliefPlans?.find(
      (p) => p.stage === 'rest-finishing',
    );
    expect(plan?.predecessorMissedAreaMm2).toBeGreaterThan(10);
    expect(plan?.finishingStepLevels).toBeGreaterThanOrEqual(2);
    expect(warnings).toContainEqual(
      expect.stringMatching(
        /the finishing bit cannot reach about \d+ mm².*The 1\.588 mm rest bit cuts it first in \d+ step-down levels/s,
      ),
    );
  }, 240_000);
});

describe('a small finishing ball steps down along the relief edge it meets (X6-P2-3)', () => {
  // The refuter's k2diag.mts flat case: a 30 mm relief whose 3 mm floor runs to
  // every edge, roughed by a 1/8" end mill at 1.5 mm per pass.
  function flat(finishToolId: string) {
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
          depthPerPassMm: 1.5,
          reliefFinishToolId: finishToolId,
        }),
      ],
      4,
    );
  }

  it('the 1/16" ball takes no more than a pass under its centre along the edge band', () => {
    const project = flat('bn-1588');
    const { gcode, detail } = compiledStock(project, 'r');
    const finish = simulateStock(project, gcode, 0.05).moves.filter(
      (move) => move.tool === 'bn-1588' && !move.rapid && move.len > 0.05,
    );
    // 2.96 mm before, over 28.3 mm of the first row at F1000.
    expect(Math.max(...finish.map((move) => move.centreRem))).toBeLessThanOrEqual(1.5 + 0.1);
    expect(detail).toMatch(/not reaching about \d+ mm² \(finishing steps down \d+ levels? there\)/);
  }, 240_000);

  it('the 1/8" ball still side-mills the band (unchanged, no step-down along it)', () => {
    const project = flat('bn-3175');
    const { prepared } = compiledStock(project, 'r');
    const finish = prepared.job.groups.find(
      (group) => group.kind === 'cnc' && group.cutType === 'relief-finish',
    );
    const stepped =
      finish?.kind === 'cnc'
        ? finish.passes.filter((pass) => pass.kind === 'path3d' && pass.reliefStepDown === true)
        : [];
    expect(stepped).toHaveLength(0);
  }, 240_000);
});
