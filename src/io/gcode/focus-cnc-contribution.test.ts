import { describe, expect, it, vi } from 'vitest';
import { generateFocusTest } from '../../core/job/focus-test';
import {
  createProject,
  createLayerSubLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
} from '../../core/scene';
import { runCncCompilationTask } from '../../core/cnc/cnc-compilation-artifact';
import { prepareOutput } from './prepare-output';
import { prepareOutputAsync, type CncCompilationTaskRunner } from './prepare-output-async';
import { emitGcode } from './emit-gcode';
function fixture(kind: 'point' | 'collapsed' | 'real' | 'deleted' | 'disabled'): Project {
  const scene = generateFocusTest({
    steps: 2,
    minOffsetMm: -1,
    maxOffsetMm: 1,
    lineLengthMm: 20,
    spacingMm: 3,
    speed: 1200,
    power: 10,
    travelFeedMmPerMin: 300,
  });
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...scene,
      layers: scene.layers.map((layer, index) => {
        if (index === 0) return { ...layer, output: kind !== 'disabled' };
        const { focusTest: _focus, ...ordinary } = layer;
        return ordinary;
      }),
      objects: scene.objects
        .filter((_, index) => index !== 0 || kind !== 'deleted')
        .map((object) => {
          if (
            object.id !== 'focus-test-1-line' ||
            object.kind !== 'imported-svg' ||
            !['point', 'collapsed'].includes(kind)
          )
            return object;
          return {
            ...object,
            paths: object.paths.map((path) => ({
              ...path,
              polylines: [
                {
                  closed: false,
                  points:
                    kind === 'point'
                      ? [{ x: 0, y: 0 }]
                      : [
                          { x: 0, y: 0 },
                          { x: 0.0001, y: 0 },
                        ],
                },
              ],
            })),
          };
        }),
    },
  };
}
const context = () => ({
  jobId: 'cnc-focus-contribution',
  runCncTasks: vi.fn<CncCompilationTaskRunner>(async ({ tasks, jobId }) =>
    tasks.map((task) => ({
      jobId,
      taskId: task.taskId,
      result: runCncCompilationTask(task.payload),
    })),
  ),
});
describe('CNC Focus refusal requires contributing motion', () => {
  it('checks represented motion after the same absolute placement in sync and async paths', async () => {
    const project = fixture('collapsed');
    const options = { absoluteProgramOffset: { x: 0.00045, y: 0 } };
    const sync = prepareOutput(project, options);
    expect(sync).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'focus-test-needs-laser' }] },
    });
    expect(await prepareOutputAsync(project, options, context())).toEqual(sync);
    expect(prepareOutput(project).ok).toBe(true);
  });
  it('retains refusal under relative current-position placement', async () => {
    const project = fixture('real');
    const options = {
      jobOrigin: {
        startFrom: 'current-position' as const,
        anchor: 'front-left' as const,
        currentPosition: { x: 70.00045, y: 40 },
      },
    };
    const sync = prepareOutput(project, options);
    expect(sync).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'focus-test-needs-laser' }] },
    });
    expect(await prepareOutputAsync(project, options, context())).toEqual(sync);
  });
  it('allows zero-only Focus as ordinary constructable CNC output', async () => {
    const source = fixture('real');
    const project = {
      ...source,
      scene: {
        ...source.scene,
        layers: source.scene.layers.map((layer) =>
          layer.focusTest === undefined
            ? layer
            : { ...layer, focusTest: { ...layer.focusTest, offsetMm: 0 } },
        ),
      },
    };
    const sync = prepareOutput(project);
    expect(sync.ok).toBe(true);
    expect(await prepareOutputAsync(project, {}, context())).toEqual(sync);
    expect(emitGcode(project).gcode).not.toBe('');
  });

  it.each([false, true])(
    'respects actual enabled subpass contribution (enabled=%s)',
    async (enabled) => {
      const source = fixture('real');
      const project: Project = {
        ...source,
        scene: {
          ...source.scene,
          layers: source.scene.layers.map((layer, index) =>
            index !== 0
              ? layer
              : {
                  ...layer,
                  mode: 'image',
                  subLayers: [
                    createLayerSubLayer(layer, { id: 'vector', label: 'Vector', enabled }),
                  ],
                },
          ),
        },
      };
      const sync = prepareOutput(project);
      expect(sync.ok).toBe(!enabled);
      expect(await prepareOutputAsync(project, {}, context())).toEqual(sync);
      if (enabled)
        expect(sync).toMatchObject({ preflight: { issues: [{ code: 'focus-test-needs-laser' }] } });
    },
  );

  it.each(['point', 'collapsed', 'deleted', 'disabled'] as const)(
    'keeps ordinary CNC output when focus geometry is %s',
    async (kind) => {
      const project = fixture(kind);
      const sync = prepareOutput(project);
      expect(sync.ok).toBe(true);
      expect(await prepareOutputAsync(project, {}, context())).toEqual(sync);
      if (!sync.ok) throw new Error('Expected ordinary CNC output');
      expect(sync.job.groups.some((group) => group.kind === 'cnc')).toBe(true);
      expect(emitGcode(project).gcode).not.toBe('');
    },
  );
  it('excludes unselected real Focus while refusing its included unsupported motion', async () => {
    const project = fixture('real');
    const scope = {
      outputScope: {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: ['focus-test-2-line'],
      },
    };
    expect(prepareOutput(project, scope).ok).toBe(true);
    expect((await prepareOutputAsync(project, scope, context())).ok).toBe(true);
    const runner = context();
    const sync = prepareOutput(project);
    expect(sync).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'focus-test-needs-laser' }] },
    });
    expect(await prepareOutputAsync(project, {}, runner)).toEqual(sync);
    expect(runner.runCncTasks).not.toHaveBeenCalled();
  });
});
