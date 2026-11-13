// CNC feed, plunge and spindle checks for runCncPreflight (ADR-233 Amendment 1).
// Feeds outside (0, CNC Max feed] are advisories; a cutting group whose
// spindle is at 0 RPM is compile integrity (cnc-spindle-off).
import type { CncStageRecipeRuns } from '../cnc/cnc-stage-recipe-runs';
import type { Job } from '../job';
import { DEFAULT_CNC_LAYER_SETTINGS, type Layer, type Project } from '../scene';
import { CNC_CUTTING_STAGES, cncCuttingStageLabel } from '../scene/cnc-stage-recipe';
import type { PreflightIssue } from './preflight';

export function appendFeedIssue(
  subject: string,
  label: string,
  value: number,
  maxFeed: number,
  issues: PreflightIssue[],
): void {
  if (value > 0 && value <= maxFeed) return;
  issues.push({
    code: 'cnc-settings-invalid',
    message: `${subject}: ${label} ${value} mm/min is outside (0, ${maxFeed}].`,
  });
}

// CNC audit v3 N6-P3-1: a stage recipe emits its own feed and plunge (ADR-457),
// and the compiler caps them to CNC Max feed as it does the layer's, so a
// recipe the job runs gets the same advisory, named as the machine-limit
// warnings name it.
export function appendStageRecipeFeedIssues(
  layer: Layer,
  maxFeed: number,
  recipeRuns: CncStageRecipeRuns,
  issues: PreflightIssue[],
): void {
  const recipes = layer.cnc?.stageRecipes;
  if (recipes === undefined) return;
  for (const stage of CNC_CUTTING_STAGES) {
    const recipe = recipes[stage];
    if (recipe === undefined || !recipeRuns(layer.id, stage, recipe.toolId)) continue;
    const subject = `The ${cncCuttingStageLabel(stage)} recipe on layer "${layer.name}"`;
    appendFeedIssue(subject, 'feed', recipe.feedMmPerMin, maxFeed, issues);
    appendFeedIssue(subject, 'plunge rate', recipe.plungeMmPerMin, maxFeed, issues);
  }
}

// CNC audit v3 N6r-P2-1: a non-positive RPM compiles to `M3 S0` followed by
// cutting moves, so the bit plunges into the stock without turning. That is
// not the operation the layer describes, so no truthful program for it exists
// (compile integrity, blocking-codes.ts). With the compiled job only a group
// that actually cuts counts; without it, every output layer does.
export function cncSpindleOffIssues(
  project: Project,
  outputLayers: ReadonlyArray<Layer>,
  compiledJob: Job | undefined,
): PreflightIssue[] {
  const subjects = new Set<string>();
  if (compiledJob === undefined) {
    for (const layer of outputLayers) {
      const rpm = (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).spindleRpm;
      if (!(rpm > 0)) subjects.add(`Layer "${layer.name}"`);
    }
  } else {
    for (const group of compiledJob.groups) {
      if (group.kind !== 'cnc' || group.passes.length === 0 || group.spindleRpm > 0) continue;
      const name =
        project.scene.layers.find((layer) => layer.id === group.layerId)?.name ?? group.layerId;
      subjects.add(
        group.cuttingStage === undefined
          ? `Layer "${name}"`
          : `The ${cncCuttingStageLabel(group.cuttingStage)} recipe on layer "${name}"`,
      );
    }
  }
  return [...subjects].map((subject) => ({
    code: 'cnc-spindle-off',
    message:
      `${subject} has a spindle speed of 0 RPM, so the program would start the spindle at S0 ` +
      'and cut with the bit standing still. Set a spindle speed of at least 1000 RPM.',
  }));
}
