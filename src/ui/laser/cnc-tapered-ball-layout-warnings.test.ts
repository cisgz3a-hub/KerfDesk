import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncCutType,
  type CncTool,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { detectCncTaperedBallLayoutWarnings } from './cnc-tapered-ball-layout-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

// Amana 46282: 6.25 mm across the top of the flutes, 1/16" ball tip.
const TAPERED_BALL: CncTool = {
  id: 'tbn',
  name: 'Tapered ball nose 1/16" tip',
  kind: 'tapered-ball-nose',
  diameterMm: 6.25,
  tipDiameterMm: 1.5875,
  tipAngleDeg: 10,
};

function rectangle(): SceneObject {
  return createRectangle({
    id: 'R1',
    color: '#ff0000',
    spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
  });
}

function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'relief',
    source: 'height.png',
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 10,
      physicalHeightMm: 10,
      maxDepthMm: 2,
      samplesU8: [255],
    }),
    targetWidthMm: 10,
    reliefDepthMm: 2,
    color: '#ff0000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
  };
}

function project(
  cutType: CncCutType,
  toolId: string,
  objects: ReadonlyArray<SceneObject> = [rectangle()],
): Project {
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType, toolId, depthMm: 3 },
  };
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, TAPERED_BALL],
    },
    scene: { objects, layers: [layer] },
  };
}

describe('detectCncTaperedBallLayoutWarnings', () => {
  it('warns when a tapered ball nose cuts an outside profile or a pocket', () => {
    const [profile] = detectCncTaperedBallLayoutWarnings(project('profile-outside', 'tbn'));
    expect(profile).toContain('tapered ball nose');
    expect(profile).toContain('6.3 mm, at the top of the flutes');
    expect(profile).toContain('oversize with a tapered wall');
    const [pocket] = detectCncTaperedBallLayoutWarnings(project('pocket', 'tbn'));
    expect(pocket).toContain('walls land inside the line');
  });

  it('warns when a tapered ball nose roughs a relief', () => {
    const [warning] = detectCncTaperedBallLayoutWarnings(
      project('profile-on-path', 'tbn', [relief()]),
    );
    expect(warning).toContain('roughing leaves ribs');
  });

  it('stays quiet where the diameter does not set the layout, or for other bits', () => {
    for (const cutType of ['profile-on-path', 'engrave', 'v-carve', 'drill'] as const) {
      expect(detectCncTaperedBallLayoutWarnings(project(cutType, 'tbn'))).toEqual([]);
    }
    const endMill = DEFAULT_CNC_MACHINE_CONFIG.tools.find((tool) => tool.kind === 'end-mill');
    if (endMill === undefined) throw new Error('fixture machine has no end mill');
    expect(detectCncTaperedBallLayoutWarnings(project('pocket', endMill.id))).toEqual([]);
    expect(detectCncTaperedBallLayoutWarnings(project('pocket', 'tbn', []))).toEqual([]);
  });

  it('reaches Job Review through the machine warnings', () => {
    const warnings = detectMachineJobWarnings(project('profile-outside', 'tbn'));
    expect(warnings.some((warning) => warning.includes('tapered ball nose'))).toBe(true);
  });
});
