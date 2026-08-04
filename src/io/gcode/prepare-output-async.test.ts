import { describe, expect, it } from 'vitest';
import { fingerprintGcode } from '../../core/recovery';
import { mixedCanvasCompilationProject } from '../../__fixtures__/mixed-canvas-compilation-project';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { runCncCompilationTask } from '../../core/cnc/cnc-compilation-artifact';
import { emitPreparedGcode } from './emit-gcode';
import { prepareOutputAsync } from './prepare-output-async';
import { prepareOutput } from './prepare-output';

const VCARVE_COLOR = '#dc2626';
const PROFILE_COLOR = '#2563eb';
const VBIT: CncTool = {
  id: 'parallel-v90',
  name: 'Parallel fixture V-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};

function box(x: number, y: number, size = 12): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function vcarveObject(id: string, x: number): SceneObject {
  return {
    kind: 'text',
    id,
    content: id,
    fontKey: 'pacifico-regular',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: VCARVE_COLOR,
    bounds: { minX: x, minY: 20, maxX: x + 20, maxY: 32 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: VCARVE_COLOR, polylines: [box(x, 20), box(x + 8, 20)] }],
  };
}

function profileObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'profile-object',
    source: 'profile.svg',
    operationIds: ['profile-operation'],
    bounds: { minX: 15, minY: 55, maxX: 35, maxY: 75 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: PROFILE_COLOR, polylines: [box(15, 55, 20)] }],
  };
}

function mixedProject(): Project {
  const base = createProject();
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: VBIT.id,
      tools: [VBIT],
    },
    scene: {
      objects: [
        vcarveObject('script-first', 20),
        vcarveObject('script-second', 70),
        profileObject(),
      ],
      layers: [
        {
          ...createLayer({ id: 'vcarve-operation', color: VCARVE_COLOR }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'v-carve',
            toolId: VBIT.id,
            depthMm: 2,
            depthPerPassMm: 2,
            vCarveFlatDepthEnabled: true,
            vResolutionMm: 0.5,
          },
        },
        {
          ...createLayer({ id: 'profile-operation', color: PROFILE_COLOR }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'profile-on-path',
            toolId: VBIT.id,
            depthMm: 1,
            depthPerPassMm: 0.5,
          },
        },
      ],
    },
  };
}

describe('prepareOutputAsync deterministic equivalence', () => {
  it('keeps the mixed eight-drawing, six-operation viewer plan and bytes exact', async () => {
    const project = mixedCanvasCompilationProject();
    const serial = prepareOutput(project);
    let regionTasks = 0;
    const progress: number[] = [];
    const parallel = await prepareOutputAsync(
      project,
      {},
      {
        jobId: 'mixed-viewer-eight-object-equivalence',
        runCncTasks: async ({ jobId, tasks, onProgress }) => {
          regionTasks = tasks.length;
          const results = tasks
            .map((task, index) => {
              onProgress?.({
                mode: 'parallel',
                completed: index + 1,
                active: Math.min(2, tasks.length - index - 1),
                queued: Math.max(0, tasks.length - index - 3),
                total: tasks.length,
              });
              progress.push(index + 1);
              return {
                jobId,
                taskId: task.taskId,
                result: runCncCompilationTask(task.payload),
              };
            })
            .reverse();
          return results;
        },
      },
    );

    expect(project.scene.objects).toHaveLength(8);
    expect(project.scene.layers).toHaveLength(6);
    // The ordered global compiler discovers one independent V-carve task per
    // V-carve drawing; the remaining five operations stay in ordered phases.
    expect(regionTasks).toBeGreaterThanOrEqual(3);
    expect(progress.at(-1)).toBe(regionTasks);
    expect(parallel).toEqual(serial);
    const serialEmission = emitPreparedGcode(serial);
    const parallelEmission = emitPreparedGcode(parallel);
    expect(parallelEmission).toEqual(serialEmission);
    expect(fingerprintGcode(parallelEmission.gcode)).toEqual(
      fingerprintGcode(serialEmission.gcode),
    );
    if (!parallel.ok) throw new Error('mixed viewer fixture did not prepare');
    const cutTypes = parallel.job.groups.flatMap((group) =>
      group.kind === 'cnc' ? [group.cutType] : [],
    );
    expect(cutTypes).toEqual(
      expect.arrayContaining(['v-carve', 'pocket', 'engrave', 'profile-inside', 'profile-outside']),
    );
  }, 20_000);

  it('matches the single-worker plan, bytes, and fingerprint after out-of-order task completion', async () => {
    const project = mixedProject();
    const serial = prepareOutput(project);
    const parallel = await prepareOutputAsync(
      project,
      {},
      {
        jobId: 'mixed-output-equivalence',
        runCncTasks: async ({ jobId, tasks }) =>
          tasks
            .map((task) => ({
              jobId,
              taskId: task.taskId,
              result: runCncCompilationTask(task.payload),
            }))
            .reverse(),
      },
    );

    expect(parallel).toEqual(serial);
    const serialEmission = emitPreparedGcode(serial);
    const parallelEmission = emitPreparedGcode(parallel);
    expect(parallelEmission).toEqual(serialEmission);
    expect(fingerprintGcode(parallelEmission.gcode)).toEqual(
      fingerprintGcode(serialEmission.gcode),
    );
    expect(
      parallel.ok &&
        parallel.job.groups.some((group) => group.kind === 'cnc' && group.cutType === 'v-carve'),
    ).toBe(true);
    expect(
      parallel.ok &&
        parallel.job.groups.some(
          (group) => group.kind === 'cnc' && group.cutType === 'profile-on-path',
        ),
    ).toBe(true);
  });

  it('surfaces unavailable when the globally bounded runner and its serial lane fail', async () => {
    const project = mixedProject();
    await expect(
      prepareOutputAsync(
        project,
        {},
        {
          jobId: 'mixed-output-fallback',
          runCncTasks: async () => {
            throw new Error('planner pool unavailable');
          },
        },
      ),
    ).rejects.toThrow('planner pool unavailable');
  });

  it('rejects malformed parallel identity without starting a local planner lane', async () => {
    const project = mixedProject();
    await expect(
      prepareOutputAsync(
        project,
        {},
        {
          jobId: 'mixed-output-malformed',
          runCncTasks: async ({ jobId, tasks }) =>
            tasks.map((task) => ({
              jobId,
              taskId: `${task.taskId}:wrong`,
              result: runCncCompilationTask(task.payload),
            })),
        },
      ),
    ).rejects.toThrow('unknown-task');
  });
});
