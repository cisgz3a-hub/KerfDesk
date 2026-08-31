// Nonblocking CNC planning disclosures for stored Stepover and relief grids.
// These strings feed the single Job Review warning surface. They never alter,
// cap, refuse, or authorize a plan.

import type { Job } from '../../core/job';
import {
  DEFAULT_RELIEF_SCALLOP_MM,
  MAX_HEIGHTMAP_CELLS,
  scallopRowSpacingMm,
} from '../../core/relief';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
} from '../../core/scene';

const RECOMMENDED_STEPOVER_MIN_PERCENT = 10;
const RECOMMENDED_STEPOVER_MAX_PERCENT = 85;

type CncCompilation = NonNullable<Job['cncCompilation']>;
type CncReliefPlan = NonNullable<CncCompilation['reliefPlans']>[number];
type CncStepoverOperation = NonNullable<CncCompilation['stepoverOperations']>[number];

export function detectCncReliefPlanningWarnings(
  project: Project,
  compiledJob?: Job,
  sourceGeometryChecks: 'full' | 'compiled-evidence-only' = 'full',
): ReadonlyArray<string> {
  if (project.machine?.kind !== 'cnc') return [];
  const compiled = compiledJob?.cncCompilation;
  const warnings = [
    ...stepoverPlanningWarnings(
      project,
      stepoverOperations(project, compiled, sourceGeometryChecks),
    ),
    ...compiledReliefPlanningWarnings(project, compiled?.reliefPlans ?? []),
    ...sourceReliefPlanningWarnings(project, compiled, sourceGeometryChecks),
    ...(sourceGeometryChecks === 'full' ? mixedReliefLayerWarnings(project) : []),
  ];
  return unique(warnings);
}

function stepoverOperations(
  project: Project,
  compiled: CncCompilation | undefined,
  sourceGeometryChecks: 'full' | 'compiled-evidence-only',
): ReadonlyArray<CncStepoverOperation> {
  if (compiled?.stepoverOperations !== undefined) return compiled.stepoverOperations;
  return sourceGeometryChecks === 'compiled-evidence-only' ? [] : sourceStepoverOperations(project);
}

function stepoverPlanningWarnings(
  project: Project,
  operations: ReadonlyArray<CncStepoverOperation>,
): ReadonlyArray<string> {
  return operations.flatMap(({ layerId, stepoverPercent }) =>
    stepoverWarning(layerNameFor(project, layerId), stepoverPercent),
  );
}

function compiledReliefPlanningWarnings(
  project: Project,
  plans: ReadonlyArray<CncReliefPlan>,
): ReadonlyArray<string> {
  return plans.flatMap((plan) => [
    ...oversizedReliefGridWarnings(project, plan),
    ...compiledReliefScallopWarnings(project, plan),
    ...(plan.stage === 'finishing'
      ? [
          `Relief "${plan.source}" on layer "${layerNameFor(project, plan.layerId)}" uses ` +
            'cutter-dilated stationary samples, but the G1 interpolants between samples are not ' +
            'a continuous swept-volume proof. Finishing rows are open serpentine cuts and ' +
            'alternate direction rather than applying the layer Climb/Conventional setting. ' +
            'Check the finishing preview before running.',
        ]
      : []),
  ]);
}

function mixedReliefLayerWarnings(project: Project): ReadonlyArray<string> {
  return project.scene.layers.flatMap((layer) => {
    if (!layer.output) return [];
    const bound = project.scene.objects.filter((object) => sceneObjectUsesOperation(object, layer));
    if (!bound.some((object) => object.kind === 'relief')) return [];
    if (!bound.some((object) => object.kind !== 'relief')) return [];
    return [
      `Layer "${layer.name}" mixes relief and vector artwork. Relief depth comes from each ` +
        'height map while vector depth comes from the layer CNC Depth setting; Job Review ' +
        'shows their compiled motions together.',
    ];
  });
}

function oversizedReliefGridWarnings(project: Project, plan: CncReliefPlan): ReadonlyArray<string> {
  const cellCount = plan.widthCells * plan.heightCells;
  if (cellCount <= MAX_HEIGHTMAP_CELLS) return [];
  return [
    `Relief "${plan.source}" on layer "${layerNameFor(project, plan.layerId)}" uses its exact ` +
      `${format(plan.cellSizeMm)} mm ${plan.stage} grid: ${plan.widthCells} x ${plan.heightCells} ` +
      `(${cellCount.toLocaleString('en-US')} cells), above the ${MAX_HEIGHTMAP_CELLS.toLocaleString(
        'en-US',
      )}-cell advisory threshold. CurveDesk did not coarsen the requested grid; compilation can use substantial memory and time. Check the preview before running.`,
  ];
}

function compiledReliefScallopWarnings(
  project: Project,
  plan: CncReliefPlan,
): ReadonlyArray<string> {
  if (!hasBallNoseScallopAboveRadius(plan)) return [];
  return [
    scallopWarning(
      plan.source,
      layerNameFor(project, plan.layerId),
      plan.scallopMm,
      plan.toolDiameterMm,
      plan.rowSpacingMm ?? plan.toolDiameterMm,
    ),
  ];
}

function hasBallNoseScallopAboveRadius(
  plan: CncReliefPlan,
): plan is CncReliefPlan & { readonly scallopMm: number } {
  return (
    plan.stage === 'finishing' &&
    plan.toolKind === 'ball-nose' &&
    plan.scallopMm !== undefined &&
    plan.scallopMm > plan.toolDiameterMm / 2
  );
}

function sourceReliefPlanningWarnings(
  project: Project,
  compiled: CncCompilation | undefined,
  sourceGeometryChecks: 'full' | 'compiled-evidence-only',
): ReadonlyArray<string> {
  if (compiled?.reliefPlans !== undefined || sourceGeometryChecks !== 'full') return [];
  return sourceReliefScallopWarnings(project);
}

function sourceStepoverOperations(
  project: Project,
): ReadonlyArray<{ readonly layerId: string; readonly stepoverPercent: number }> {
  return project.scene.layers.flatMap((layer) => {
    if (!layer.output || !layerUsesStepover(project, layer)) return [];
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    return [{ layerId: layer.id, stepoverPercent: settings.stepoverPercent }];
  });
}

function layerUsesStepover(project: Project, layer: Layer): boolean {
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  if (
    project.scene.objects.some(
      (object) => object.kind === 'relief' && sceneObjectUsesOperation(object, layer),
    )
  ) {
    return true;
  }
  if (settings.cutType === 'pocket') return settings.pocketStrategy !== 'adaptive';
  if (settings.cutType === 'inlay-pair') return true;
  if (
    settings.cutType === 'v-carve' &&
    (settings.vCarveFlatDepthEnabled ?? true) &&
    settings.vClearToolId !== undefined
  ) {
    return true;
  }
  return false;
}

function sourceReliefScallopWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return [];
  return project.scene.layers.flatMap((layer) => {
    if (!layer.output) return [];
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const finishTool = machine.tools.find((tool) => tool.id === settings.reliefFinishToolId);
    if (finishTool?.kind !== 'ball-nose') return [];
    const scallopMm = settings.reliefScallopMm ?? DEFAULT_RELIEF_SCALLOP_MM;
    if (scallopMm <= finishTool.diameterMm / 2) return [];
    return project.scene.objects.flatMap((object) =>
      object.kind === 'relief' && sceneObjectUsesOperation(object, layer)
        ? [
            scallopWarning(
              object.source,
              layer.name,
              scallopMm,
              finishTool.diameterMm,
              scallopRowSpacingMm(finishTool, scallopMm),
            ),
          ]
        : [],
    );
  });
}

function stepoverWarning(layerName: string, stepoverPercent: number): ReadonlyArray<string> {
  if (
    stepoverPercent >= RECOMMENDED_STEPOVER_MIN_PERCENT &&
    stepoverPercent <= RECOMMENDED_STEPOVER_MAX_PERCENT
  ) {
    return [];
  }
  return [
    `Stored Stepover on layer "${layerName}" is ${format(stepoverPercent)}%, outside the ` +
      `${RECOMMENDED_STEPOVER_MIN_PERCENT}-${RECOMMENDED_STEPOVER_MAX_PERCENT}% recommended range. ` +
      'The planner uses this positive value as stored; it does not clamp it into that range. ' +
      'Check the resulting route density in Preview before running.',
  ];
}

function scallopWarning(
  source: string,
  layerName: string,
  scallopMm: number,
  toolDiameterMm: number,
  rowSpacingMm: number,
): string {
  return (
    `Relief "${source}" on layer "${layerName}" requests a ${format(
      scallopMm,
    )} mm ball-nose scallop target, above the ${format(toolDiameterMm / 2)} mm cutter radius. ` +
    `That target is outside the minor-sagitta cusp domain. The established planner retains the stored value, limits the cusp calculation to the cutter radius, and uses ${format(
      rowSpacingMm,
    )} mm row spacing. Check the finishing preview before running.`
  );
}

function layerNameFor(project: Project, layerId: string): string {
  return project.scene.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
}

function unique(warnings: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(warnings)];
}

function format(value: number): string {
  const rounded = Number(value.toFixed(6));
  return rounded === 0 && value !== 0 ? value.toString() : rounded.toString();
}
