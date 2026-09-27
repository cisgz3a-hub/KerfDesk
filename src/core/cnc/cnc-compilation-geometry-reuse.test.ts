import { afterEach, describe, expect, it, vi } from 'vitest';
import { flowingVCarveProject } from '../../__fixtures__/flowing-vcarve-project';
import { DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../scene';
import { cncGrblStrategy } from '../output';
import * as contours from './collect-cnc-contours';
import { runCncCompilationTask } from './cnc-compilation-artifact';
import { finalizeCncCompilationArtifact, prepareBoundCncCompilation } from './compile-cnc-job';

function compile(project: Project) {
  const artifact = prepareBoundCncCompilation(
    { jobId: 'reuse', compilationId: 'reuse:cnc' },
    project.scene,
    project.device,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  const results = artifact.tasks.map((task) => ({
    jobId: artifact.identity.compilationId,
    taskId: task.taskId,
    result: runCncCompilationTask(task.payload),
  }));
  return { artifact, results };
}

afterEach(() => vi.restoreAllMocks());

describe('V-carve compilation source geometry reuse', () => {
  it('collects and resolves contours once for planning and final assembly', () => {
    const collect = vi.spyOn(contours, 'collectLayerContours');
    const resolve = vi.spyOn(contours, 'layerPolylinesFromContours');
    const { artifact, results } = compile(flowingVCarveProject());
    expect(artifact.tasks.length).toBeGreaterThan(0);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    const finalized = finalizeCncCompilationArtifact(artifact, results);
    expect(finalized.kind).toBe('compiled');
    expect(collect).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('keeps source geometry local to each compilation after an artwork edit', () => {
    const firstProject = flowingVCarveProject();
    const secondProject: Project = {
      ...firstProject,
      scene: {
        ...firstProject.scene,
        objects: firstProject.scene.objects.map((object) => ({
          ...object,
          transform: { ...object.transform, x: object.transform.x + 20 },
        })),
      },
    };
    const first = compile(firstProject);
    const second = compile(secondProject);
    const original = finalizeCncCompilationArtifact(first.artifact, first.results);
    const edited = finalizeCncCompilationArtifact(second.artifact, second.results);
    if (original.kind !== 'compiled' || edited.kind !== 'compiled') {
      throw new Error('Expected two compiled V-carve jobs');
    }
    expect(cncGrblStrategy.emit(edited.job, secondProject.device)).not.toBe(
      cncGrblStrategy.emit(original.job, firstProject.device),
    );
    expect(finalizeCncCompilationArtifact(first.artifact, first.results)).toEqual(original);
  });

  it('reuses a completed empty plan without recollecting open contours during assembly', () => {
    const project = flowingVCarveProject();
    const object = project.scene.objects[0];
    if (object?.kind !== 'imported-svg') throw new Error('Expected vector fixture');
    const openProject: Project = {
      ...project,
      scene: {
        ...project.scene,
        objects: [
          {
            ...object,
            paths: object.paths.map((path) => ({
              ...path,
              polylines: path.polylines.map((polyline) => ({ ...polyline, closed: false })),
            })),
          },
        ],
      },
    };
    const collect = vi.spyOn(contours, 'collectLayerContours');
    const { artifact, results } = compile(openProject);
    expect(artifact.tasks).toEqual([]);
    const finalized = finalizeCncCompilationArtifact(artifact, results);
    expect(finalized.kind === 'compiled' && finalized.job.groups).toEqual([]);
    expect(collect).toHaveBeenCalledTimes(1);
  });
});
