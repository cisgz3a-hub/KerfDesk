import { describe, expect, it, vi } from 'vitest';
import { flowingVCarveProject } from '../../__fixtures__/flowing-vcarve-project';
import { runCncCompilationTask } from '../../core/cnc/cnc-compilation-artifact';
import * as depthPasses from '../../core/cnc/depth-passes';
import { planUnrankedVCarveMedialRegion } from '../../core/cnc/vcarve-medial-region-plan';
import { passesForVCarveMedialRegion } from '../../core/cnc/vcarve-medial-region-passes';
import { DEFAULT_CNC_LAYER_SETTINGS, type Project } from '../../core/scene';
import { findInvalidCncToolGeometry } from '../../core/preflight/cnc-tool-geometry';
import { prepareOutput } from './prepare-output';
import { prepareOutputAsync } from './prepare-output-async';
import { isProgramMaterializationRangeError } from './program-materialization';

function project(depthPerPassMm = 1e-12): Project {
  const base = flowingVCarveProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: base.scene.layers.map((layer) => ({
        ...layer,
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          ...layer.cnc,
          vCarveFlatDepthEnabled: true,
          depthMm: 1,
          depthPerPassMm,
        },
      })),
    },
  };
}

// A broken implementation must fail the regression, not allocate billions of
// entries. This interceptor exists only during a synchronous production call.
function withoutDepthAllocation<T>(run: () => T): T {
  const original = Array.prototype.push;
  try {
    Array.prototype.push = function (...items: unknown[]) {
      if (
        items.length === 1 &&
        typeof items[0] === 'number' &&
        items[0] < 0 &&
        new Error().stack?.includes('depth-passes.ts')
      ) {
        throw new Error('Test stopped unexpected depth allocation');
      }
      return original.apply(this, items);
    };
    return run();
  } finally {
    Array.prototype.push = original;
  }
}

describe('V-carve factual depth materialization failure', () => {
  it('returns the existing factual program error for a contributing normal V-carve route', () => {
    const result = withoutDepthAllocation(() => prepareOutput(project()));
    expect(result).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'program-materialization-failed' }] },
    });
  });

  it('handles the same numeric failure after a worker has reconstructed a plain Error', async () => {
    const result = await prepareOutputAsync(
      project(),
      {},
      {
        jobId: 'vcarve-depth-domain',
        runCncTasks: async ({ jobId, tasks }) =>
          tasks.map((task) => {
            try {
              return {
                jobId,
                taskId: task.taskId,
                result: withoutDepthAllocation(() => runCncCompilationTask(task.payload)),
              };
            } catch (error) {
              throw new Error(error instanceof Error ? error.message : String(error));
            }
          }),
      },
    );
    expect(result).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'program-materialization-failed' }] },
    });
  });

  it('protects the medial dot route without allocating its depth levels', () => {
    const outer = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    };
    const law = { tanHalf: 1, tipRadiusMm: 0, outerRadiusMm: 3, maxDepthMm: 1 };
    const { plan } = planUnrankedVCarveMedialRegion({ outer, holes: [], loops: [outer] }, 0, {
      law,
      floorPitchMm: 0.5,
      resolutionMm: 0.5,
    });
    const dot = { closed: false, points: [{ x: 2, y: 2 }] };
    expect(() =>
      withoutDepthAllocation(() =>
        passesForVCarveMedialRegion({ ...plan, routes: [dot], referenceRoutes: [dot] }, law, {
          depthPerPassMm: 1e-12,
        }),
      ),
    ).toThrow(/Z-pass count .* exceeds the ECMAScript Array length limit/);
  });

  it.each(['missing-clear', 'bn-3175'])(
    'probes a %s tool without creating any depth-pass array',
    (vClearToolId) => {
      const input = project();
      const machine = input.machine;
      if (machine?.kind !== 'cnc') throw new Error('Expected CNC machine');
      const scene = {
        ...input.scene,
        layers: input.scene.layers.map((layer) => ({
          ...layer,
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...layer.cnc, vClearToolId },
        })),
      };
      const allocate = vi.spyOn(depthPasses, 'zPassDepths').mockImplementation(() => {
        throw new Error('Eligibility must not allocate');
      });
      try {
        expect(findInvalidCncToolGeometry(scene, machine, input.device)).toMatchObject([
          { code: 'cnc-tool-geometry-invalid' },
        ]);
        expect(allocate).not.toHaveBeenCalled();
      } finally {
        allocate.mockRestore();
      }
    },
  );

  it('does not turn a disabled V-carve with the same settings into a new refusal', () => {
    const input = project();
    const output = withoutDepthAllocation(() =>
      prepareOutput({
        ...input,
        scene: {
          ...input.scene,
          layers: input.scene.layers.map((layer) => ({ ...layer, output: false })),
        },
      }),
    );
    expect(output.ok).toBe(true);
  });

  it('does not classify ordinary programming RangeErrors or representable counts as allocation failures', () => {
    expect(
      isProgramMaterializationRangeError(
        new RangeError('Unsupported CNC contour decimal precision: 4'),
      ),
    ).toBe(false);
    expect(
      isProgramMaterializationRangeError(
        new Error('Z-pass count 12 exceeds the ECMAScript Array length limit.'),
      ),
    ).toBe(false);
    expect(
      isProgramMaterializationRangeError(
        new Error('Z-pass count 1e+21 exceeds the ECMAScript Array length limit.'),
      ),
    ).toBe(true);
    expect(
      isProgramMaterializationRangeError(
        new Error('Z-pass count Infinity exceeds the ECMAScript Array length limit.'),
      ),
    ).toBe(true);
  });
});
