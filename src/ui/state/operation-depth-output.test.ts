import { afterEach, describe, expect, it } from 'vitest';
import { runCncCompilationTask } from '../../core/cnc/cnc-compilation-artifact';
import { cncGroupMaximumDepthMm } from '../../core/job/job';
import { DEFAULT_CNC_LAYER_SETTINGS, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutputAsync } from '../../io/gcode/prepare-output-async';
import { useStore } from './store';
import { resetStore } from './test-helpers';

afterEach(resetStore);

function squareObject(id: string, x: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 10, maxX: x + 10, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 10 },
              { x: x + 10, y: 10 },
              { x: x + 10, y: 20 },
              { x, y: 20 },
            ],
          },
        ],
      },
    ],
  };
}

describe('bulk CNC depth output integration', () => {
  it('prepares and emits the chosen depth for both fixed-depth operations', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().importSvgObject(squareObject('First fixed', 10));
    useStore.getState().importSvgObject(squareObject('Second fixed', 30));
    useStore.getState().importSvgObject(squareObject('Flowing V-carve', 50));
    const [firstId, secondId, vCarveId] = useStore
      .getState()
      .project.scene.layers.map((operation) => operation.id);
    if (firstId === undefined || secondId === undefined || vCarveId === undefined) {
      throw new Error('operations missing');
    }
    useStore.getState().setLayerParam(firstId, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'engrave',
        depthMm: 1,
        depthPerPassMm: 0.5,
        feedMmPerMin: 700,
      },
    });
    useStore.getState().setLayerParam(secondId, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-inside',
        depthMm: 2,
        depthPerPassMm: 1.25,
        feedMmPerMin: 900,
        tabsEnabled: false,
      },
    });
    useStore.getState().setLayerParam(vCarveId, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'v-carve',
        toolId: 'vb-90',
        depthMm: 0.1,
        depthPerPassMm: 0.6,
        vCarveFlatDepthEnabled: false,
      },
    });

    useStore.getState().setCncDepthForOperations([firstId, secondId], 3.25);
    let taskCount = 0;
    const prepared = await prepareOutputAsync(
      useStore.getState().project,
      {},
      {
        jobId: 'bulk-fixed-depth-output',
        runCncTasks: async ({ jobId, tasks }) => {
          taskCount += tasks.length;
          return tasks.map((task) => ({
            jobId,
            taskId: task.taskId,
            result: runCncCompilationTask(task.payload),
          }));
        },
      },
    );

    expect(taskCount).toBeGreaterThan(0);
    if (!prepared.ok) throw new Error('CNC project did not prepare');
    const fixedGroups = [firstId, secondId].map((operationId) => {
      const group = prepared.job.groups.find(
        (candidate) => candidate.kind === 'cnc' && candidate.layerId === operationId,
      );
      if (group?.kind !== 'cnc') throw new Error(`CNC group missing for ${operationId}`);
      return group;
    });
    expect(
      fixedGroups.map((group) => ({
        requestedDepthMm: group.requestedDepthMm,
        actualDepthMm: cncGroupMaximumDepthMm(group),
        depthPerPassMm: group.depthPerPassMm,
        feedMmPerMin: group.feedMmPerMin,
      })),
    ).toEqual([
      {
        requestedDepthMm: 3.25,
        actualDepthMm: 3.25,
        depthPerPassMm: 0.5,
        feedMmPerMin: 700,
      },
      {
        requestedDepthMm: 3.25,
        actualDepthMm: 3.25,
        depthPerPassMm: 1.25,
        feedMmPerMin: 900,
      },
    ]);

    const emitted = emitPreparedGcode(prepared);
    if (!emitted.preflight.ok) throw new Error('prepared CNC output did not emit');
    expect(emitted.gcode.match(/; cnc depth: requested-mm: 3\.250;/g)).toHaveLength(2);
    expect(emitted.gcode).toContain('Z-3.25');
  });
});
