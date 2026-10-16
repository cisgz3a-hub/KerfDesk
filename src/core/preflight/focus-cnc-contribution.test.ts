import { describe, expect, it } from 'vitest';
import { generateFocusTest } from '../job/focus-test';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../scene';
import { runCncCompilationTask } from '../cnc/cnc-compilation-artifact';
import { emitGcode, emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { prepareOutputAsync } from '../../io/gcode/prepare-output-async';
import { runPreEmitPreflight } from './pre-emit';

function mixedProject(points: ReadonlyArray<{ x: number; y: number }>): Project {
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
        if (index === 0) return layer;
        const { focusTest: _focus, ...ordinary } = layer;
        return ordinary;
      }),
      objects: scene.objects.map((object, index) =>
        index === 0 && object.kind === 'imported-svg'
          ? {
              ...object,
              paths: object.paths.map((path) => ({
                ...path,
                polylines: [{ closed: false, points }],
              })),
            }
          : object,
      ),
    },
  };
}

describe('Focus CNC compilation contribution', () => {
  it.each([{ points: [] }, { points: [{ x: 0, y: 0 }] }])(
    'allows ordinary CNC output beside a non-executable Focus contour: %j',
    async ({ points }) => {
      const project = mixedProject(points);
      expect(runPreEmitPreflight(project).issues).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'focus-test-needs-laser' })]),
      );
      const baseline = {
        ...project,
        scene: { ...project.scene, objects: project.scene.objects.slice(1) },
      };
      const expected = emitGcode(baseline);
      expect(expected.gcode).toMatch(/G1 .*Z-/);
      expect(prepareOutput(project).ok).toBe(true);
      expect(emitGcode(project)).toEqual(expected);
      const prepared = await prepareOutputAsync(
        project,
        {},
        {
          jobId: 'focus-empty-cnc',
          runCncTasks: async ({ jobId, tasks }) =>
            tasks.map((task) => ({
              jobId,
              taskId: task.taskId,
              result: runCncCompilationTask(task.payload),
            })),
        },
      );
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error('Expected ordinary CNC output');
      expect(emitPreparedGcode(prepared)).toEqual(expected);
    },
  );

  it('still refuses a contributing Focus line alongside ordinary CNC artwork', () => {
    const project = mixedProject([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(prepareOutput(project)).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'focus-test-needs-laser' }] },
    });
    expect(emitGcode(project).gcode).toBe('');
  });

  it('uses canonical curves even when their compatibility polyline contains only one point', () => {
    const project = mixedProject([{ x: 0, y: 0 }]);
    const scene = {
      ...project.scene,
      objects: project.scene.objects.map((object, index) =>
        index === 0 && object.kind === 'imported-svg'
          ? {
              ...object,
              paths: object.paths.map((path) => ({
                ...path,
                curves: [
                  {
                    start: { x: 0, y: 0 },
                    closed: false,
                    segments: [{ kind: 'line' as const, to: { x: 20, y: 0 } }],
                  },
                ],
              })),
            }
          : object,
      ),
    };
    expect(prepareOutput({ ...project, scene })).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'focus-test-needs-laser' }] },
    });
  });
});
