import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
} from '../scene';
import { cncGroupForLayer } from './compile-cnc-job';

const FLAT_ENGRAVER: CncTool = {
  id: 'flat-engraver',
  name: '30 degree flat-tip engraver',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
  tipDiameterMm: 0.2,
};

const MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [FLAT_ENGRAVER],
  toolId: FLAT_ENGRAVER.id,
};

const SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 30 },
    { x: 10, y: 30 },
  ],
};

describe('compiled CNC flat-tip provenance', () => {
  it('copies the exact engraving tip diameter beside the compiled passes', () => {
    const layer = {
      ...createLayer({ id: 'flat-vcarve', color: '#334455' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'v-carve' as const,
        toolId: FLAT_ENGRAVER.id,
        vCarveFlatDepthEnabled: true,
        depthMm: 1,
      },
    };
    const group = cncGroupForLayer(layer, layer.cnc, [SQUARE], DEFAULT_DEVICE_PROFILE, MACHINE);

    expect(group).not.toBeNull();
    expect(group).toMatchObject({
      toolId: FLAT_ENGRAVER.id,
      toolKind: 'engraving',
      toolDiameterMm: 3.175,
      toolTipAngleDeg: 30,
      toolTipDiameterMm: 0.2,
    });
  });
});
