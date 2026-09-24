// ADR-368 compile integration: a tapered ball nose finishes a relief with its
// tip ball governing row spacing and grid resolution, and the compiled group,
// planning evidence and G-code comment all carry that tip.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import { DEFAULT_RELIEF_SCALLOP_MM, scallopRowSpacingMm } from '../relief';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncMachineConfig,
  type CncTool,
  type Scene,
} from '../scene';
import type { MeshReliefObject } from '../scene/relief';
import { compileCncJob } from './compile-cnc-job';

// SpeTool W01010's listing: a 1 mm tip radius at 3.92 degrees per side.
const TBN: CncTool = {
  id: 'tbn-w01010',
  name: 'Tapered ball nose',
  kind: 'tapered-ball-nose',
  diameterMm: 6.22,
  tipAngleDeg: 7.84,
  tipDiameterMm: 2,
};
const RELIEF: MeshReliefObject = {
  kind: 'relief',
  id: 'R1',
  source: 'model.stl',
  targetWidthMm: 12,
  reliefDepthMm: 5,
  reliefSource: {
    kind: 'legacy-mesh',
    meshPositions: [0, 0, 0, 12, 0, 3, 0, 12, 6],
    emptyCells: 'floor',
  },
  color: '#a0522d',
  bounds: { minX: 0, minY: 0, maxX: 12, maxY: 12 },
  transform: IDENTITY_TRANSFORM,
};

function compile(tool: CncTool = TBN) {
  const layer = {
    ...createLayer({ id: RELIEF.color, color: RELIEF.color }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'engrave' as const,
      reliefFinishToolId: tool.id,
    },
  };
  const scene: Scene = { objects: [RELIEF], layers: [layer] };
  const config: CncMachineConfig = {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, tool],
  };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, config);
}

describe('tapered ball-nose relief finishing compile', () => {
  it('records the tip ball on the finishing group and its planning evidence', () => {
    const job = compile();
    const finish = job.groups.find(
      (group) => group.kind === 'cnc' && group.cutType === 'relief-finish',
    );
    if (finish?.kind !== 'cnc') throw new Error('finish group missing');
    const plan = job.cncCompilation?.reliefPlans?.find((entry) => entry.stage === 'finishing');
    const rowSpacingMm = scallopRowSpacingMm(TBN, DEFAULT_RELIEF_SCALLOP_MM);

    expect(finish).toMatchObject({
      toolId: TBN.id,
      toolKind: 'tapered-ball-nose',
      toolDiameterMm: 6.22,
      toolTipAngleDeg: 7.84,
      toolTipDiameterMm: 2,
    });
    expect(finish.passes.length).toBeGreaterThan(0);
    expect(plan).toMatchObject({
      toolKind: 'tapered-ball-nose',
      toolDiameterMm: 6.22,
      toolTipDiameterMm: 2,
      rowSpacingMm,
      scallopMm: DEFAULT_RELIEF_SCALLOP_MM,
    });
    // Resolved like a 2 mm ball nose: a tenth of the tip, not of the 6.22 mm top.
    expect(plan?.cellSizeMm).toBeLessThanOrEqual(Math.min(rowSpacingMm, 0.2) + 1e-12);
  });

  it('writes the tip into the emitted tool comment', () => {
    const gcode = cncGrblStrategy.emit(compile(), DEFAULT_DEVICE_PROFILE);
    expect(gcode).toContain(
      '; cnc tool: tapered-ball-nose; diameter-mm: 6.220; angle-deg: 7.840; tip-diameter-mm: 2.000',
    );
  });

  it('omits tip evidence when the tip is missing, planning the flat fallback instead', () => {
    const { tipDiameterMm: _tip, ...withoutTip } = TBN;
    const noTip: CncTool = { ...withoutTip, id: 'tbn-no-tip' };
    const job = compile(noTip);
    const finish = job.groups.find(
      (group) => group.kind === 'cnc' && group.cutType === 'relief-finish',
    );
    const plan = job.cncCompilation?.reliefPlans?.find((entry) => entry.stage === 'finishing');

    expect(finish).not.toHaveProperty('toolTipDiameterMm');
    expect(plan).not.toHaveProperty('toolTipDiameterMm');
    expect(plan?.rowSpacingMm).toBeCloseTo(6.22 * 0.4, 12);
  });
});
