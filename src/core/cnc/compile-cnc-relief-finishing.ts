import { toMachineCoords, type DeviceProfile } from '../devices';
import type { CncGroup, CncPass } from '../job';
import type { CncReliefPlanningEvidence } from '../job/job';
import { DEFAULT_RELIEF_SCALLOP_MM } from '../relief';
import { reliefScallopBallRadiusMm } from '../relief/relief-finishing';
import { finishedFlatDepthAt, type ReliefFinishedFlats } from '../relief/relief-flat-finish';
import {
  reliefFinishingPlan,
  reliefFinishRowSpacingMm,
  reliefFinishStrategyFor,
} from '../relief/relief-finishing-strategy';
import type { Heightmap } from '../relief/heightmap';
import { reliefObjectToHeightmap } from '../relief/relief-object-to-heightmap';
import {
  reliefMaterializationFailure,
  type ReliefMaterializationFailure,
} from '../relief/relief-materialization-failure';
import {
  applyTransform,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type ReliefObject,
} from '../scene';
import { kernelForTool } from '../sim';
import { reliefMachineSpaceGeometry } from './relief-machine-space';
import { cncSettingsForStage } from './cnc-stage-settings';
import { materialOnRightInMap } from './relief-material-side';
import { reliefGroup } from './cnc-relief-group';

export type ReliefFinishingRecord = {
  readonly relief: ReliefObject;
  readonly map: Heightmap;
  readonly passes: ReadonlyArray<CncPass>;
};
export function finishingCellSizeMm(rowSpacingMm: number, tool: CncTool): number {
  const ballRadiusMm = reliefScallopBallRadiusMm(tool);
  const contactDiameterMm = ballRadiusMm === null ? tool.diameterMm : 2 * ballRadiusMm;
  const finestCellMm = contactDiameterMm / 10;
  return rowSpacingMm / Math.max(1, Math.ceil(rowSpacingMm / finestCellMm - 1e-9));
}

type FinishingCompilation =
  | {
      readonly kind: 'compiled';
      readonly group: CncGroup | null;
      readonly plans: ReadonlyArray<CncReliefPlanningEvidence>;
      readonly records: ReadonlyArray<ReliefFinishingRecord>;
    }
  | ReliefMaterializationFailure;
export function reliefFinishingGroup(
  reliefs: ReadonlyArray<ReliefObject>,
  layer: Layer,
  settings: CncLayerSettings,
  device: DeviceProfile,
  config: CncMachineConfig,
  finishedFlats: ReadonlyArray<ReliefFinishedFlats | undefined>,
): FinishingCompilation {
  const tool = config.tools.find((tool) => tool.id === settings.reliefFinishToolId);
  if (tool === undefined) return { kind: 'compiled', group: null, plans: [], records: [] };
  const passes: CncPass[] = [],
    plans: CncReliefPlanningEvidence[] = [],
    records: ReliefFinishingRecord[] = [];
  for (const [index, relief] of reliefs.entries()) {
    const result = finishRelief(relief, layer, settings, device, tool, finishedFlats[index]);
    if (result.kind === 'relief-materialization-failed') return result;
    passes.push(...result.machinePasses);
    plans.push(result.plan);
    records.push(result.record);
  }
  return {
    kind: 'compiled',
    plans,
    records,
    group:
      passes.length === 0
        ? null
        : reliefGroup(
            layer,
            cncSettingsForStage(settings, 'relief-finish', tool),
            device,
            config,
            tool,
            'relief-finish',
            'relief-finish',
            passes,
            layerCncTool(config, settings),
          ),
  };
}

function finishRelief(
  relief: ReliefObject,
  layer: Layer,
  settings: CncLayerSettings,
  device: DeviceProfile,
  tool: CncTool,
  finished: ReliefFinishedFlats | undefined,
):
  | {
      readonly kind: 'compiled';
      readonly record: ReliefFinishingRecord;
      readonly machinePasses: ReadonlyArray<CncPass>;
      readonly plan: CncReliefPlanningEvidence;
    }
  | ReliefMaterializationFailure {
  const space = reliefMachineSpaceGeometry(relief);
  const scallopMm = settings.reliefScallopMm ?? DEFAULT_RELIEF_SCALLOP_MM;
  const strategy = reliefFinishStrategyFor(settings.reliefFinishStrategy, relief.reliefSource.kind);
  const rowSpacingMm = reliefFinishRowSpacingMm(tool, scallopMm, strategy);
  const result = reliefObjectToHeightmap(relief, {
    targetWidthMm: relief.targetWidthMm,
    reliefDepthMm: relief.reliefDepthMm,
    targetScaleX: space.targetScaleX,
    targetScaleY: space.targetScaleY,
    mmPerCell: finishingCellSizeMm(rowSpacingMm, tool),
    sampling: 'exact-mesh',
  });
  if (result.kind === 'error') return reliefMaterializationFailure(relief.source, result.reason);
  const map = result.heightmap;
  const localPasses = reliefFinishingPlan(map, {
    tool,
    kernel: kernelForTool(tool, map.mmPerCell),
    scallopMm,
    strategy,
    rasterAxis: settings.reliefRasterAxis ?? 'x',
    wallOnRight: materialOnRightInMap(space.residualTransform, device, settings),
    ...(finished === undefined
      ? {}
      : { finishedAt: (x: number, y: number) => finishedFlatDepthAt(finished, x, y) }),
  }).filter((pass) => pass.kind === 'path3d');
  const machinePasses = localPasses.map((pass) => ({
    ...pass,
    points: pass.points.map((p) => ({
      ...toMachineCoords(applyTransform(p, space.residualTransform), device),
      z: p.z,
    })),
  }));
  return {
    kind: 'compiled',
    record: { relief, map, passes: localPasses },
    machinePasses,
    plan: { ...finishingGridEvidence(layer, relief, map, tool), rowSpacingMm, scallopMm },
  };
}
function finishingGridEvidence(
  layer: Layer,
  relief: ReliefObject,
  map: Heightmap,
  tool: CncTool,
): CncReliefPlanningEvidence {
  const radius = reliefScallopBallRadiusMm(tool);
  return {
    layerId: layer.id,
    source: relief.source,
    targetObjectId: relief.id,
    stage: 'finishing',
    widthCells: map.widthCells,
    heightCells: map.heightCells,
    cellSizeMm: map.mmPerCell,
    toolDiameterMm: tool.diameterMm,
    toolKind: tool.kind,
    ...(tool.kind === 'tapered-ball-nose' && radius !== null
      ? { toolTipDiameterMm: 2 * radius }
      : {}),
  };
}
