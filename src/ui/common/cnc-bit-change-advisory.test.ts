import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type CncTool,
  type Project,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { hasRetainedFeedsAfterEffectiveToolChange } from './cnc-bit-change-advisory';

const ENGRAVER: CncTool = {
  id: 'engraver',
  name: 'engraver',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
  tipDiameterMm: 0.2,
};

function projectWithTool(tool: CncTool): Project {
  const project = createProject();
  const layer = {
    ...createLayer({ id: 'engrave-layer', color: '#ff0000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'engrave' as const,
      toolId: tool.id,
    },
  };
  const object = createRectangle({
    id: 'rectangle',
    color: layer.color,
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
  });
  return {
    ...project,
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [tool], toolId: tool.id },
    scene: { objects: [object], layers: [layer] },
  };
}

describe('flat-tip cutter-change advisories', () => {
  it('treats a changed tip diameter as a changed effective cutter', () => {
    const before = projectWithTool(ENGRAVER);
    const after = projectWithTool({ ...ENGRAVER, tipDiameterMm: 0.4 });
    expect(hasRetainedFeedsAfterEffectiveToolChange(before, after)).toBe(true);
  });

  it('treats absent and explicit zero as the same pointed tip', () => {
    const { tipDiameterMm: _tipDiameterMm, ...pointed } = ENGRAVER;
    const before = projectWithTool(pointed);
    const after = projectWithTool({ ...pointed, tipDiameterMm: 0 });
    expect(hasRetainedFeedsAfterEffectiveToolChange(before, after)).toBe(false);
  });
});
