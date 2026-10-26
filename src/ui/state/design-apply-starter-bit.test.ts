// Audit follow-up to 25-P2-1 (#1369): a Design Studio layer on "Machine bit"
// drops the bit the 4040's machine starter seeded. The next machine refresh
// must not pin the starter's 1/8" cutter again over the active bit the 3D
// preview showed; the starter's numbers and provenance stay for Job Review
// (ADR-666 F-026, which fixed the refresh for every fresh operation).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { DEFAULT_DESIGN_LAYER } from '../../core/design/layers';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { layerCncTool, type CncMachineConfig, type Layer } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function cncMachine(): CncMachineConfig {
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected a CNC machine');
  return machine;
}

function select4040WithActiveBit(toolId: string): void {
  useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
  useStore.getState().setMachineKind('cnc');
  useStore.getState().updateCncMachine({ toolId });
  expect(cncMachine().stock.materialKey).toBeUndefined();
}

function pocketSketch(toolId?: string): Sketch {
  return {
    entities: [
      {
        kind: 'rect',
        id: 'pocket',
        origin: { x: 20, y: 20 },
        widthMm: 40,
        heightMm: 30,
        cornerRadiusMm: 0,
        layerId: 'field',
      },
    ],
    layers: [
      {
        ...DEFAULT_DESIGN_LAYER,
        id: 'field',
        name: 'Field',
        cutType: 'pocket',
        depthMm: 2,
        ...(toolId === undefined ? {} : { toolId }),
      },
    ],
  };
}

function fieldOperation(): Layer {
  const found = useStore.getState().project.scene.layers.find((layer) => layer.name === 'Field');
  if (found === undefined) throw new Error('no Field operation');
  return found;
}

beforeEach(resetStore);
afterEach(resetStore);

describe('Design Studio Apply on "Machine bit" keeps the active bit', () => {
  it('drops the starter bit, keeping its numbers and provenance', () => {
    select4040WithActiveBit('em-1588');
    useStore.getState().applyDesignSketch(pocketSketch(), ['a'], null);

    const cnc = fieldOperation().cnc;
    expect(cnc?.toolId).toBeUndefined();
    expect(cnc).toMatchObject({
      feedMmPerMin: 300,
      depthPerPassMm: 0.75,
      feedSource: { kind: 'machine-starter' },
    });
  });

  it('still cuts with the active bit after a machine-setup refresh', () => {
    select4040WithActiveBit('em-1588');
    useStore.getState().applyDesignSketch(pocketSketch(), ['a'], null);

    useStore.getState().updateCncMachine({ stock: { thicknessMm: 7 } });

    expect(fieldOperation().cnc?.toolId).toBeUndefined();
    expect(layerCncTool(cncMachine(), fieldOperation().cnc ?? {}).diameterMm).toBeCloseTo(1.588, 3);
  });

  it('keeps the starter provenance when the layer names the starter bit', () => {
    select4040WithActiveBit('em-1588');
    useStore.getState().applyDesignSketch(pocketSketch('em-3175'), ['a'], null);

    expect(fieldOperation().cnc).toMatchObject({
      toolId: 'em-3175',
      feedSource: { kind: 'machine-starter' },
    });
  });
});
