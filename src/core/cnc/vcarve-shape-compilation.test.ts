import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  type Scene,
} from '../scene';
import { createEllipse } from '../shapes/primitives';
import { compileCncJob } from './compile-cnc-job';

describe('V-carve shape compilation', () => {
  it('compiles the reported 66.6 mm circle with the starter V-bit', () => {
    const color = '#000000';
    const scene: Scene = {
      objects: [
        createEllipse({
          id: 'reported-circle',
          color,
          spec: { widthMm: 66.6, heightMm: 66.6 },
        }),
      ],
      layers: [
        {
          ...createLayer({ id: 'reported-circle-vcarve', color }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'v-carve',
            vCarveFlatDepthEnabled: false,
            depthMm: 1,
            depthPerPassMm: 1.5,
            vResolutionMm: 0,
          },
        },
      ],
    };

    const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [
        {
          id: 'vb-30',
          name: '30 degree V-bit - 3.175 mm cut',
          kind: 'v-bit',
          diameterMm: 3.175,
          tipAngleDeg: 30,
        },
      ],
      toolId: 'vb-30',
    });

    const passes = job.groups.flatMap((group) =>
      group.kind === 'cnc' && group.cutType === 'v-carve' ? group.passes : [],
    );
    expect(passes.length).toBeGreaterThan(0);
  }, 30_000);
});
