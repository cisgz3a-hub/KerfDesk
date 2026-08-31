import { describe, expect, it } from 'vitest';
import { runCncPreflight } from '../../core/preflight';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type Project,
} from '../../core/scene';
import { partitionEmitPreflight } from './start-job-readiness-policy';

function projectWithOutsideFixture(): Project {
  const base = createProject();
  return {
    ...base,
    device: {
      ...base.device,
      noGoZones: [
        {
          id: 'edge-clamp',
          name: 'Edge clamp',
          enabled: true,
          x: 400.5,
          y: 10,
          width: 10,
          height: 20,
        },
      ],
    },
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'L1', color: '#ff0000' }),
          cnc: DEFAULT_CNC_LAYER_SETTINGS,
        },
      ],
    },
  };
}

describe('CNC fixture-envelope Job Review warning', () => {
  it('warns without blocking when cutter radius reaches a fixture outside the bed', () => {
    const preflight = runCncPreflight(
      projectWithOutsideFixture(),
      DEFAULT_CNC_MACHINE_CONFIG,
      ['G21', 'G90', 'M3 S12000', 'G0 Z3.810', 'G0 X395 Y20', 'G1 X399.5 Y20 F1000', 'M5'].join(
        '\n',
      ),
    );

    const split = partitionEmitPreflight(preflight);
    expect(split.blocking).toEqual([]);
    expect(split.warnings).toContainEqual(
      expect.stringContaining('cutter envelope crosses no-go zone "Edge clamp"'),
    );
  });
});
