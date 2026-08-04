import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type CncTool,
  type Project,
} from '../scene';
import { runCncPreflight } from './cnc-preflight';

const GOOD_GCODE = [
  'G21',
  'G90',
  'G94',
  'M3 S12000',
  'G0 Z3.810',
  'G0 X10.000 Y10.000',
  'G1 Z-1.000 F300',
  'G1 X20.000 Y10.000 F1000',
  'G0 Z3.810',
  'M5',
].join('\n');

function projectWithVCarveLayer(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'flat-tip-layer', color: '#ff0000' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
        },
      ],
    },
  };
}

function preflightWith(tool: CncTool) {
  const machine = {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    toolId: tool.id,
    tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, tool],
  };
  return runCncPreflight(projectWithVCarveLayer(), machine, GOOD_GCODE);
}

describe('V-carve engraving-tool compatibility', () => {
  it('accepts a fully modeled flat-tip engraving bit', () => {
    const result = preflightWith({
      id: 'flat-engraver',
      name: '90 degree flat engraver',
      kind: 'engraving',
      diameterMm: 2,
      tipAngleDeg: 90,
      tipDiameterMm: 0.4,
    });

    expect(result.issues.some((issue) => issue.message.includes('V-carve requires'))).toBe(false);
  });

  it.each([
    ['has no included angle', { tipDiameterMm: 0.4 }],
    ['has a tip flat as wide as the cutter', { tipAngleDeg: 90, tipDiameterMm: 2 }],
  ] as const)(
    'keeps the existing incompatibility issue when an engraver %s',
    (_label, geometry) => {
      const result = preflightWith({
        id: 'unsupported-engraver',
        name: 'Unsupported engraver',
        kind: 'engraving',
        diameterMm: 2,
        ...geometry,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'cnc-settings-invalid',
          message: expect.stringContaining('V-carve requires a V-bit or angled engraving bit'),
        }),
      );
    },
  );
});
