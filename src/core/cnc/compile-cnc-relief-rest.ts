import { reliefCutterBudgetError } from '../relief/relief-cutter-budget';
import { toMachineCoords, type DeviceProfile } from '../devices';
import type { CncGroup, CncPass } from '../job';
import type { CncReliefPlanningEvidence } from '../job/job';
import { reliefFinishingPlan, reliefFinishRowSpacingMm } from '../relief/relief-finishing-strategy';
import { reliefObjectToHeightmap } from '../relief/relief-object-to-heightmap';
import {
  reliefMaterializationFailure,
  type ReliefMaterializationFailure,
} from '../relief/relief-materialization-failure';
import {
  predictReliefResidual,
  type ReliefResidualPrediction,
} from '../relief/relief-residual-stock';
import { reliefRestPasses } from '../relief/relief-rest-passes';
import type { Heightmap } from '../relief/heightmap';
import {
  applyTransform,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
} from '../scene';
import { kernelForTool } from '../sim';
import { reliefGroup } from './cnc-relief-group';
import { cncSettingsForStage } from './cnc-stage-settings';
import { finishingCellSizeMm, type ReliefFinishingRecord } from './compile-cnc-relief-finishing';
import { reliefMachineSpaceGeometry } from './relief-machine-space';
import { materialOnRightInMap } from './relief-material-side';

type RestContext = {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly device: DeviceProfile;
  readonly tool: CncTool;
  readonly predecessor: CncTool;
};
export function compileReliefRestGroup(
  records: ReadonlyArray<ReliefFinishingRecord>,
  layer: Layer,
  settings: CncLayerSettings,
  device: DeviceProfile,
  config: CncMachineConfig,
):
  | {
      readonly kind: 'compiled';
      readonly group: CncGroup | null;
      readonly plans: ReadonlyArray<CncReliefPlanningEvidence>;
    }
  | ReliefMaterializationFailure {
  if (settings.reliefRestFinishToolId === undefined)
    return { kind: 'compiled', group: null, plans: [] };
  const predecessor = config.tools.find((tool) => tool.id === settings.reliefFinishToolId);
  const tool = config.tools.find((tool) => tool.id === settings.reliefRestFinishToolId);
  if (predecessor === undefined || tool === undefined || records.length === 0)
    return reliefMaterializationFailure(
      layer.name,
      'Relief rest finishing requires a named predecessor finishing cutter and an available rest cutter.',
    );
  const passes: CncPass[] = [],
    plans: CncReliefPlanningEvidence[] = [];
  for (const record of records) {
    const result = restForRelief(record, { layer, settings, device, tool, predecessor });
    if (result.kind === 'relief-materialization-failed') return result;
    passes.push(...result.passes);
    plans.push(result.plan);
  }
  const stageSettings = cncSettingsForStage(settings, 'relief-rest-finish', tool);
  return {
    kind: 'compiled',
    plans,
    group:
      passes.length === 0
        ? null
        : reliefGroup(
            layer,
            stageSettings,
            device,
            config,
            tool,
            'relief-finish',
            'relief-rest-finish',
            passes,
            layerCncTool(config, settings),
          ),
  };
}
function restForRelief(
  record: ReliefFinishingRecord,
  context: RestContext,
):
  | {
      readonly kind: 'compiled';
      readonly passes: ReadonlyArray<CncPass>;
      readonly plan: CncReliefPlanningEvidence;
    }
  | ReliefMaterializationFailure {
  const { settings, device, tool, predecessor } = context;
  const scallopMm = settings.reliefRestScallopMm ?? settings.reliefScallopMm ?? 0.05;
  const thresholdMm = settings.reliefRestResidualMm ?? 0.05;
  if (!validRestParameters(scallopMm, thresholdMm))
    return reliefMaterializationFailure(
      record.relief.source,
      'Relief rest finishing requires a positive finite scallop and a finite nonnegative residual threshold.',
    );
  const strategy = settings.reliefFinishStrategy ?? 'raster';
  const rowSpacingMm = reliefFinishRowSpacingMm(tool, scallopMm, strategy);
  const space = reliefMachineSpaceGeometry(record.relief);
  const result = reliefObjectToHeightmap(record.relief, {
    targetWidthMm: record.relief.targetWidthMm,
    reliefDepthMm: record.relief.reliefDepthMm,
    targetScaleX: space.targetScaleX,
    targetScaleY: space.targetScaleY,
    mmPerCell: finishingCellSizeMm(rowSpacingMm, tool),
    sampling: 'footprint-max',
  });
  if (result.kind === 'error')
    return reliefMaterializationFailure(record.relief.source, result.reason);
  const map = result.heightmap;
  const budgetError = reliefCutterBudgetError(tool, map.mmPerCell);
  if (budgetError !== null) return reliefMaterializationFailure(record.relief.source, budgetError);
  const kernel = kernelForTool(tool, map.mmPerCell);
  const prediction = predictReliefResidual(map, record.passes, predecessor, thresholdMm);
  const fullPasses = reliefFinishingPlan(map, {
    tool,
    kernel,
    scallopMm,
    strategy,
    rasterAxis: settings.reliefRasterAxis ?? 'x',
    wallOnRight: materialOnRightInMap(space.residualTransform, device, settings),
  });
  const selected = reliefRestPasses(map, fullPasses, prediction.selected, kernel.radiusMm);
  const passes = selected.passes
    .filter((pass) => pass.kind === 'path3d')
    .map((pass) => ({
      ...pass,
      points: pass.points.map((p) => ({
        ...toMachineCoords(applyTransform(p, space.residualTransform), device),
        z: p.z,
      })),
    }));
  return {
    kind: 'compiled',
    passes,
    plan: restEvidence(record, context, map, prediction, {
      rowSpacingMm,
      scallopMm,
      thresholdMm,
      fallbackReason: prediction.fallbackReason ?? selected.fallbackReason,
    }),
  };
}
function restEvidence(
  record: ReliefFinishingRecord,
  context: RestContext,
  map: Heightmap,
  prediction: ReliefResidualPrediction,
  values: {
    rowSpacingMm: number;
    scallopMm: number;
    thresholdMm: number;
    fallbackReason: string | undefined;
  },
): CncReliefPlanningEvidence {
  return {
    layerId: context.layer.id,
    source: record.relief.source,
    targetObjectId: record.relief.id,
    stage: 'rest-finishing',
    widthCells: map.widthCells,
    heightCells: map.heightCells,
    cellSizeMm: map.mmPerCell,
    toolDiameterMm: context.tool.diameterMm,
    toolKind: context.tool.kind,
    ...(context.tool.kind === 'tapered-ball-nose' && context.tool.tipDiameterMm !== undefined
      ? { toolTipDiameterMm: context.tool.tipDiameterMm }
      : {}),
    rowSpacingMm: values.rowSpacingMm,
    scallopMm: values.scallopMm,
    predecessorToolId: context.predecessor.id,
    residualThresholdMm: values.thresholdMm,
    maximumResidualMm: prediction.maximumResidualMm,
    selectedCells: prediction.selectedCells,
    ...(values.fallbackReason === undefined ? {} : { restFallbackReason: values.fallbackReason }),
    ...(record.relief.reliefSource.kind === 'heightfield-v1'
      ? { targetRevision: record.relief.reliefSource.revision }
      : {}),
  };
}

function validRestParameters(scallopMm: number, thresholdMm: number): boolean {
  return (
    Number.isFinite(scallopMm) && scallopMm > 0 && Number.isFinite(thresholdMm) && thresholdMm >= 0
  );
}
