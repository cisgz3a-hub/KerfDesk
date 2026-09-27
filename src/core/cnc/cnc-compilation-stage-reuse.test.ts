import { afterEach, expect, it, vi } from 'vitest';
import { flowingVCarveProject } from '../../__fixtures__/flowing-vcarve-project';
import { cncGrblStrategy } from '../output';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS, type Project } from '../scene';
import type { CncStageRecipe } from '../scene/cnc-stage-recipe';
import type { Job } from '../job';
import * as contours from './collect-cnc-contours';
import { runCncCompilationTask } from './cnc-compilation-artifact';
import { finalizeCncCompilationArtifact, prepareBoundCncCompilation } from './compile-cnc-job';

const PROFILE_COLOR = '#0000ff';
const INITIAL_CLEAR: CncStageRecipe = {
  toolId: 'em-3175',
  feedMmPerMin: 321,
  plungeMmPerMin: 123,
  spindleRpm: 9000,
  depthPerPassMm: 0.5,
};
const INITIAL_FINISH: CncStageRecipe = { ...INITIAL_CLEAR, feedMmPerMin: 222 };
const EDITED_CLEAR: CncStageRecipe = {
  ...INITIAL_CLEAR,
  feedMmPerMin: 481,
  plungeMmPerMin: 151,
  spindleRpm: 8100,
  depthPerPassMm: 1,
};
const EDITED_FINISH: CncStageRecipe = {
  ...INITIAL_FINISH,
  feedMmPerMin: 333,
  plungeMmPerMin: 111,
  spindleRpm: 7100,
  depthPerPassMm: 1,
};

function projectWithBothStages(): Project {
  const project = flowingVCarveProject(2);
  const source = project.scene.objects[0];
  const vLayer = project.scene.layers[0];
  if (source?.kind !== 'imported-svg' || vLayer?.cnc === undefined)
    throw new Error('Expected V fixture');
  const profile = {
    ...source,
    id: 'profile',
    transform: { ...source.transform, x: 30 },
    paths: source.paths.map((path) => ({ ...path, color: PROFILE_COLOR })),
  };
  return {
    ...project,
    scene: {
      ...project.scene,
      // A non-V operation precedes the V operation in source order; the
      // artifact cache must bind the actual operation index, not its array rank.
      objects: [profile, source],
      layers: [
        {
          ...createLayer({ id: 'profile', color: PROFILE_COLOR }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'profile-outside',
            toolId: 'em-3175',
            depthMm: 2,
            depthPerPassMm: 1,
            feedMmPerMin: 800,
            spindleRpm: 11000,
            tabsEnabled: false,
            profileLead: { shape: 'none' },
            finishAllowanceMm: 0.2,
            stageRecipes: { 'profile-finish': INITIAL_FINISH },
          },
        },
        {
          ...vLayer,
          cnc: {
            ...vLayer.cnc,
            vCarveFlatDepthEnabled: true,
            vClearToolId: 'em-3175',
            depthMm: 2,
            depthPerPassMm: 1,
            vResolutionMm: 0.5,
            feedMmPerMin: 900,
            spindleRpm: 12000,
            stageRecipes: { 'v-clear': INITIAL_CLEAR },
          },
        },
      ],
    },
  };
}

function editRecipes(project: Project): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) => ({
        ...layer,
        cnc: {
          ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
          stageRecipes:
            layer.id === 'profile'
              ? { 'profile-finish': EDITED_FINISH }
              : { 'v-clear': EDITED_CLEAR },
        },
      })),
    },
  };
}

function prepare(project: Project, compilationId: string) {
  if (project.machine?.kind !== 'cnc') throw new Error('Expected CNC machine');
  const artifact = prepareBoundCncCompilation(
    { jobId: 'stage-edit', compilationId },
    project.scene,
    project.device,
    project.machine,
  );
  const results = artifact.tasks.map((task) => ({
    jobId: compilationId,
    taskId: task.taskId,
    result: runCncCompilationTask(task.payload),
  }));
  return { artifact, results };
}

function finalize(prepared: ReturnType<typeof prepare>): Job {
  const result = finalizeCncCompilationArtifact(prepared.artifact, prepared.results);
  if (result.kind !== 'compiled') throw new Error('Expected complete compilation');
  return result.job;
}

function checkStageRecipes(job: Job, clear: CncStageRecipe, finish: CncStageRecipe): void {
  const groups = job.groups.filter((group) => group.kind === 'cnc');
  expect(groups.map((group) => group.cutType)).toEqual([
    'pocket',
    'v-carve',
    'profile-outside',
    'profile-outside',
  ]);
  expect(groups[0]).toMatchObject({ ...clear, cuttingStage: 'v-clear' });
  expect(groups[1]).toMatchObject({ toolId: 'vb-60', feedMmPerMin: 900, spindleRpm: 12000 });
  expect(groups[2]).toMatchObject({ feedMmPerMin: 800, spindleRpm: 11000 });
  expect(groups[3]).toMatchObject({ ...finish, cuttingStage: 'profile-finish' });
  expect(groups[3]?.passes).toHaveLength(2 / finish.depthPerPassMm);
  const depths = groups[0]?.passes.flatMap((pass) => (pass.kind === 'contour' ? [pass.zMm] : []));
  expect(new Set(depths)).toEqual(
    new Set(clear.depthPerPassMm === 0.5 ? [-0.5, -1, -1.5, -2] : [-1, -2]),
  );
}

afterEach(() => vi.restoreAllMocks());

it('keeps immutable stage edits separate while reusing each artifact’s V source geometry', () => {
  const collect = vi.spyOn(contours, 'collectLayerContours');
  const firstProject = projectWithBothStages();
  const first = prepare(firstProject, 'before-edit');
  const secondProject = editRecipes(firstProject);
  const second = prepare(secondProject, 'after-edit');
  expect(secondProject.scene.objects).toBe(firstProject.scene.objects);
  expect(first.artifact.tasks.length).toBeGreaterThan(0);
  expect(first.artifact.tasks.every((task) => task.payload.binding.operationIndex === 1)).toBe(
    true,
  );
  const original = finalize(first);
  const edited = finalize(second);
  checkStageRecipes(original, INITIAL_CLEAR, INITIAL_FINISH);
  checkStageRecipes(edited, EDITED_CLEAR, EDITED_FINISH);
  const originalOutput = cncGrblStrategy.emit(original, firstProject.device);
  const editedOutput = cncGrblStrategy.emit(edited, secondProject.device);
  expect(originalOutput).toContain('F321');
  expect(editedOutput).toContain('F481');
  expect(editedOutput).not.toBe(originalOutput);
  expect(finalize(first)).toEqual(original);
  expect(cncGrblStrategy.emit(finalize(first), firstProject.device)).toBe(originalOutput);
  // Re-finalizing the old artifact cannot borrow the edited recipes or collect
  // its V contours again. Profile geometry is intentionally still collected.
  expect(collect.mock.calls.filter(([, layer]) => layer.cnc?.cutType === 'v-carve')).toHaveLength(
    2,
  );
});
