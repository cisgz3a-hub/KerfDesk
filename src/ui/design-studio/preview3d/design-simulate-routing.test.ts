import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sketch } from '../../../core/design';
import { DEFAULT_DESIGN_LAYER, type DesignCutType } from '../../../core/design/layers';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject, type Project } from '../../../core/scene';
import type * as GcodeModule from '../../../io/gcode';
import { designCarveSource } from './design-carve-source';

const gcodeMocks = vi.hoisted(() => ({
  prepareOutput: vi.fn(),
}));

vi.mock('../../../io/gcode', async (importOriginal) => ({
  ...(await importOriginal<typeof GcodeModule>()),
  prepareOutput: gcodeMocks.prepareOutput,
}));

import { routeDesignCarveSimulation } from './design-simulate';

const CNC_PROJECT: Project = {
  ...createProject(),
  machine: DEFAULT_CNC_MACHINE_CONFIG,
};

beforeEach(() => {
  gcodeMocks.prepareOutput.mockReset();
  gcodeMocks.prepareOutput.mockReturnValue({
    ok: false,
    preflight: {
      ok: false,
      issues: [{ code: 'empty-output', message: 'synchronous compiler reached' }],
    },
  });
});

describe('Design Studio synchronous preparation boundary', () => {
  it.each(['v-carve', 'pocket'] as const)(
    'does not call the synchronous compiler when the worker is unavailable for a %s sketch',
    (cutType) => {
      const sketch = oneRectangle(cutType);
      const startBackground = vi.fn().mockReturnValue(null);

      const route = routeDesignCarveSimulation(
        CNC_PROJECT,
        sketch,
        ['sim-object'],
        designCarveSource(CNC_PROJECT),
        startBackground,
      );

      expect(route).toMatchObject({
        kind: 'immediate',
        result: {
          kind: 'failed',
          reason: expect.stringMatching(/background bit simulation is unavailable/i),
        },
      });
      expect(startBackground).toHaveBeenCalledOnce();
      expect(gcodeMocks.prepareOutput).not.toHaveBeenCalled();
    },
  );

  it('returns the exact background simulation result for costly work', async () => {
    const expected = {
      kind: 'ok' as const,
      grid: {
        widthCells: 1,
        heightCells: 1,
        mmPerCell: 0.2,
        originX: 0,
        originY: 0,
        depth: new Float32Array([-1.25]),
      },
    };
    const startBackground = vi.fn().mockReturnValue(Promise.resolve(expected));

    const route = routeDesignCarveSimulation(
      CNC_PROJECT,
      oneRectangle('v-carve'),
      ['sim-object'],
      designCarveSource(CNC_PROJECT),
      startBackground,
    );

    expect(route.kind).toBe('background');
    if (route.kind !== 'background') return;
    await expect(route.pending).resolves.toBe(expected);
    expect(gcodeMocks.prepareOutput).not.toHaveBeenCalled();
  });

  it('keeps a cheap profile sketch on the direct path', () => {
    const sketch = oneRectangle('profile-on-path');

    const startBackground = vi.fn();
    const route = routeDesignCarveSimulation(
      CNC_PROJECT,
      sketch,
      ['sim-object'],
      designCarveSource(CNC_PROJECT),
      startBackground,
    );

    expect(gcodeMocks.prepareOutput).toHaveBeenCalledOnce();
    expect(startBackground).not.toHaveBeenCalled();
    expect(route).toEqual({
      kind: 'immediate',
      result: { kind: 'failed', reason: 'synchronous compiler reached' },
    });
  });
});

function oneRectangle(cutType: DesignCutType): Sketch {
  const layerId = `simulate-${cutType}`;
  return {
    entities: [
      {
        kind: 'rect',
        id: 'design-rect',
        origin: { x: 20, y: 20 },
        widthMm: 30,
        heightMm: 20,
        cornerRadiusMm: 0,
        layerId,
      },
    ],
    layers: [{ ...DEFAULT_DESIGN_LAYER, id: layerId, cutType }],
  };
}
