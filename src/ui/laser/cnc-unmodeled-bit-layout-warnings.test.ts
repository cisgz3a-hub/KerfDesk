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
import { detectCncUnmodeledBitLayoutWarnings } from './cnc-unmodeled-bit-layout-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

// Amana 46282: 6.25 mm across the top of the flutes, 1/16" ball tip.
const TAPERED_BALL: CncTool = {
  id: 'tbn',
  name: 'Tapered ball nose 1/16" tip',
  kind: 'tapered-ball-nose',
  diameterMm: 6.25,
  tipDiameterMm: 1.5875,
  tipAngleDeg: 10.8,
};
// The same bit read from a file that lost its ball tip: ADR-368 plans it as a
// flat cylinder of the stored diameter.
const { tipDiameterMm: _tip, ...WITHOUT_TIP } = TAPERED_BALL;
const INCOMPLETE_TAPERED_BALL: CncTool = { ...WITHOUT_TIP, id: 'tbn-incomplete' };
// Cones read from files that lost their angle, or kept a flat as wide as the
// cutter: their layout keeps the stored diameter (ADR-368 Amendment 3).
const ANGLELESS_V_BIT: CncTool = {
  id: 'v-angleless',
  name: 'V-bit 1/4"',
  kind: 'v-bit',
  diameterMm: 6.35,
};
const WIDE_FLAT_ENGRAVER: CncTool = {
  id: 'eng-wide-flat',
  name: 'Engraver 1/8"',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
  tipDiameterMm: 3.175,
};
const MODELED_ENGRAVER: CncTool = {
  ...WIDE_FLAT_ENGRAVER,
  id: 'eng-modeled',
  tipDiameterMm: 0.2,
};
const TEST_TOOLS: ReadonlyArray<CncTool> = [
  TAPERED_BALL,
  INCOMPLETE_TAPERED_BALL,
  ANGLELESS_V_BIT,
  WIDE_FLAT_ENGRAVER,
  MODELED_ENGRAVER,
];

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
      tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, ...TEST_TOOLS],
    },
    scene: { objects, layers: [layer] },
  };
}

describe('detectCncUnmodeledBitLayoutWarnings', () => {
  it('stays quiet when a modeled narrowing bit sets offsets or stepover', () => {
    // Amendments 2 and 3: these lay out by their cut width at depth.
    for (const toolId of ['tbn', 'bn-6350', 'vb-60', 'eng-modeled']) {
      for (const cutType of ['profile-outside', 'profile-inside', 'pocket'] as const) {
        expect(detectCncUnmodeledBitLayoutWarnings(project(cutType, toolId))).toEqual([]);
      }
      expect(
        detectCncUnmodeledBitLayoutWarnings(project('profile-on-path', toolId, [relief()])),
      ).toEqual([]);
    }
  });

  it('warns when a tapered ball nose without its tip cuts a profile or a pocket', () => {
    const [profile] = detectCncUnmodeledBitLayoutWarnings(
      project('profile-outside', 'tbn-incomplete'),
    );
    expect(profile).toContain('tapered ball nose without a usable ball tip and taper');
    expect(profile).toContain('6.3 mm, at the top of the flutes');
    expect(profile).toContain('oversize with a tapered wall');
    expect(profile).toContain('Add the bit again with its tip and taper per side');
    const [pocket] = detectCncUnmodeledBitLayoutWarnings(project('pocket', 'tbn-incomplete'));
    expect(pocket).toContain('walls land inside the line');
  });

  it('warns when a V-bit or engraving bit that cannot be modeled sets the layout', () => {
    const [vBit] = detectCncUnmodeledBitLayoutWarnings(project('profile-inside', 'v-angleless'));
    expect(vBit).toContain('uses V-bit 1/4", a V-bit without a usable included angle');
    expect(vBit).toContain('6.4 mm, at the top of the flutes');
    expect(vBit).toContain('undersize with a tapered wall');
    expect(vBit).toContain('Add the bit again with its included angle, or use a flat end mill');
    const [engraver] = detectCncUnmodeledBitLayoutWarnings(project('pocket', 'eng-wide-flat'));
    expect(engraver).toContain('an engraving bit without a usable included angle or tip flat');
    expect(engraver).toContain('walls land inside the line');
  });

  it('warns when a bit that cannot be modeled roughs a relief', () => {
    for (const toolId of ['tbn-incomplete', 'v-angleless']) {
      const [warning] = detectCncUnmodeledBitLayoutWarnings(
        project('profile-on-path', toolId, [relief()]),
      );
      expect(warning).toContain('roughing leaves ribs');
    }
  });

  it('stays quiet where the diameter does not set the layout, or for other bits', () => {
    for (const toolId of ['tbn-incomplete', 'v-angleless', 'eng-wide-flat']) {
      for (const cutType of ['profile-on-path', 'engrave', 'v-carve', 'drill'] as const) {
        expect(detectCncUnmodeledBitLayoutWarnings(project(cutType, toolId))).toEqual([]);
      }
    }
    const endMill = DEFAULT_CNC_MACHINE_CONFIG.tools.find((tool) => tool.kind === 'end-mill');
    if (endMill === undefined) throw new Error('fixture machine has no end mill');
    expect(detectCncUnmodeledBitLayoutWarnings(project('pocket', endMill.id))).toEqual([]);
    expect(detectCncUnmodeledBitLayoutWarnings(project('pocket', 'tbn-incomplete', []))).toEqual(
      [],
    );
  });

  it('reaches Job Review through the machine warnings', () => {
    const warnings = detectMachineJobWarnings(project('profile-outside', 'tbn-incomplete'));
    expect(warnings.some((warning) => warning.includes('tapered ball nose without'))).toBe(true);
    const vBit = detectMachineJobWarnings(project('pocket', 'v-angleless'));
    expect(vBit.some((warning) => warning.includes('V-bit without a usable'))).toBe(true);
    const modeled = detectMachineJobWarnings(project('profile-outside', 'tbn'));
    expect(modeled.some((warning) => warning.includes('without a usable'))).toBe(false);
  });
});
