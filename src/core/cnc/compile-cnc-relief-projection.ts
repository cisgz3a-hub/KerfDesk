import type { CncTool, Transform } from '../scene';
import type { Heightmap } from '../relief/heightmap';
import { toMachineCoords, toSceneCoords, type DeviceProfile } from '../devices';
import type { CncGroup, CncPass } from '../job';
import type { CncReliefPlanningEvidence } from '../job/job';
import {
  reliefProjectionPlan,
  type ReliefProjectionFacts,
  type ReliefProjectionOptions,
} from '../relief/relief-projection-plan';
import { reliefObjectToHeightmap } from '../relief/relief-object-to-heightmap';
import { DEFAULT_RELIEF_ALLOWANCE_MM } from '../relief/relief-roughing';
import {
  reliefMaterializationFailure,
  type ReliefMaterializationFailure,
} from '../relief/relief-materialization-failure';
import { inverseReliefPoint } from '../relief/relief-vector-boundary';
import {
  applyTransform,
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
  type Polyline,
  type SceneObject,
} from '../scene';
import { reliefMachineSpaceGeometry } from './relief-machine-space';
import { reliefGroup } from './cnc-relief-group';
import { isProfileCutType } from './compile-cnc-helpers';
import { cutCanFreePart, stockLimitedTabHeightMm } from './cnc-tabs';
import { setStockThicknessMm } from '../scene/machine';

export type ReliefProjectionCompilation =
  | {
      readonly kind: 'compiled';
      readonly groups: ReadonlyArray<CncGroup>;
      readonly plans: ReadonlyArray<CncReliefPlanningEvidence>;
    }
  | ReliefMaterializationFailure;
/** Input polylines are the operation's already resolved MACHINE-coordinate vectors.
 * Target lookup must use the full project scene, including an unselected relief.
 */
export function compileReliefProjectionGroups(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  settings: CncLayerSettings,
  device: DeviceProfile,
  config: CncMachineConfig,
  polylines: ReadonlyArray<Polyline>,
  // X6-P2-1: the job's layers and the objects it carves, to tell whether the
  // target is only roughed before this operation. Absent: from its surface.
  carve?: ProjectionTargetCarve,
): ReliefProjectionCompilation {
  const projection = settings.reliefProjection;
  if (projection === undefined) return { kind: 'compiled', groups: [], plans: [] };
  if (projection.depthConvention !== 'vertical')
    return reliefMaterializationFailure(
      layer.name,
      'Relief vector projection requires the vertical depth convention.',
    );
  if (settings.cutType !== 'engrave' && settings.cutType !== 'profile-on-path')
    return reliefMaterializationFailure(
      layer.name,
      'Relief vector projection supports engraving and profiles on the vector path.',
    );
  const target = objects.find((o) => o.id === projection.reliefObjectId);
  if (target?.kind !== 'relief' || target.reliefSource.kind !== 'heightfield-v1')
    return reliefMaterializationFailure(
      layer.name,
      'The named projection target is missing or has no scalar heightfield.',
    );
  const space = reliefMachineSpaceGeometry(target),
    tool = layerCncTool(config, settings);
  const result = reliefObjectToHeightmap(target, {
    targetWidthMm: target.targetWidthMm,
    reliefDepthMm: target.reliefDepthMm,
    targetScaleX: space.targetScaleX,
    targetScaleY: space.targetScaleY,
    mmPerCell: Math.min(projection.sampleSpacingMm, tool.diameterMm / 10),
    sampling: 'exact-mesh',
  });
  if (result.kind === 'error') return reliefMaterializationFailure(target.source, result.reason);
  const local = polylines.map((line) => ({
    ...line,
    points: line.points.map((p) =>
      inverseReliefPoint(toSceneCoords(p, device), space.residualTransform),
    ),
  }));
  if (local.some((line) => line.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))))
    return reliefMaterializationFailure(
      target.source,
      'The projection target placement is not invertible.',
    );

  const plan = reliefProjectionPlan(
    result.heightmap,
    local,
    tool,
    projection.depthMm,
    projection.sampleSpacingMm,
    projectionOptions(settings, config, tool, roughedOnlyStockMm(target, config, carve)),
  );
  if (plan.kind === 'error') return reliefMaterializationFailure(target.source, plan.reason);
  const passes = projectedMachinePasses(plan.passes, space.residualTransform, device);
  const map = result.heightmap;
  const evidence = projectionEvidence(
    layer,
    target.source,
    target.id,
    target.reliefSource.revision,
    settings,
    tool,
    map,
    plan.liftedVertices,
    plan.facts,
  );
  return {
    kind: 'compiled',
    groups:
      passes.length === 0
        ? []
        : [reliefGroup(layer, settings, device, config, tool, settings.cutType, undefined, passes)],
    plans: [evidence],
  };
}

const TAB_EPS = 1e-9;

/** The job's layers and the objects it carves (X6-P2-1). */
export type ProjectionTargetCarve = {
  readonly layers: ReadonlyArray<Layer>;
  readonly carvedObjects: ReadonlyArray<SceneObject>;
};

// X6-P2-1: a target this job carves with roughing only still stands up to its
// finish allowance plus one roughing step above its surface (a terrace), so
// the projection's first level starts that far up. A finished target, or one
// carved earlier (not in this job), stands at its surface. A finished target
// cut after this operation is the order warning's case.
function roughedOnlyStockMm(
  target: SceneObject,
  config: CncMachineConfig,
  carve: ProjectionTargetCarve | undefined,
): number {
  if (carve === undefined || !carve.carvedObjects.some((o) => o.id === target.id)) return 0;
  const owner = carve.layers.find((l) => l.output && sceneObjectUsesOperation(target, l));
  if (owner === undefined) return 0;
  const roughing = owner.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const finishTool = roughing.reliefFinishToolId;
  if (finishTool !== undefined && config.tools.some((tool) => tool.id === finishTool)) return 0;
  const allowance = roughing.finishAllowanceMm ?? DEFAULT_RELIEF_ALLOWANCE_MM;
  const terrace = Math.min(
    roughing.depthPerPassMm,
    roughing.reliefFineStepMm ?? Number.POSITIVE_INFINITY,
  );
  return [allowance, terrace].reduce(
    (sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0),
    0,
  );
}

// The layer's step-down and tabs as the projection honours them (W6-P2-1).
// Tabs follow the 2D rules (cnc-tabs.ts, ADR-258 Amendments 1, 3 and 4),
// judged on the loop's deepest emitted tip instead of the ignored Cut depth: a
// set stock thickness keeps each tab one tab height above the stock bottom
// (half the stock when the tab is no thinner than it) and drops tabs where the
// floor under the cut holds the part; the shipped default thickness measures
// the tab from the cut floor.
function projectionOptions(
  settings: CncLayerSettings,
  config: CncMachineConfig,
  tool: CncTool,
  startAboveMm: number,
): ReliefProjectionOptions {
  const stockMm = config.stock.thicknessMm;
  const base = {
    depthPerPassMm: settings.depthPerPassMm,
    stockThicknessMm: stockMm,
    startAboveMm,
  };
  if (!isProfileCutType(settings.cutType) || !settings.tabsEnabled) return base;
  const tabHeightMm = Math.max(0, settings.tabHeightMm);
  const setStockMm = setStockThicknessMm(config.stock);
  const tabTopZ = (deepestZ: number): number | null => {
    const depthMm = -deepestZ;
    if (!cutCanFreePart(depthMm, tabHeightMm, setStockMm)) return null;
    const top =
      setStockMm === undefined
        ? deepestZ + Math.min(tabHeightMm, Math.max(0, depthMm))
        : -setStockMm + stockLimitedTabHeightMm(tabHeightMm, setStockMm);
    return top > deepestZ + TAB_EPS && top < 0 ? top : null;
  };
  return {
    ...base,
    tabs: {
      tabsPerShape: settings.tabsPerShape,
      windowMm: Math.max(0, settings.tabWidthMm) + Math.max(0, tool.diameterMm),
      tabTopZ,
    },
  };
}

function projectionEvidence(
  layer: Layer,
  source: string,
  targetObjectId: string,
  targetRevision: number,
  settings: CncLayerSettings,
  tool: CncTool,
  map: Heightmap,
  liftedVertices: number,
  facts: ReliefProjectionFacts,
): CncReliefPlanningEvidence {
  const projection = settings.reliefProjection;
  if (projection === undefined)
    throw new Error('Projection evidence requires its admitted settings.');
  return {
    layerId: layer.id,
    source: source,
    targetObjectId,
    stage: 'projection',
    widthCells: map.widthCells,
    heightCells: map.heightCells,
    cellSizeMm: map.mmPerCell,
    toolDiameterMm: tool.diameterMm,
    toolKind: tool.kind,
    targetRevision: targetRevision,
    verticalDepthMm: projection.depthMm,
    requestedSampleSpacingMm: projection.sampleSpacingMm,
    projection: facts,
    ...(liftedVertices > 0
      ? {
          restFallbackReason: `${liftedVertices} projected samples were lifted for cutter reach or excluded stock; nominal vertical depth is not reached there.`,
        }
      : {}),
  };
}

function projectedMachinePasses(
  passes: ReadonlyArray<CncPass>,
  placement: Transform,
  device: DeviceProfile,
): ReadonlyArray<CncPass> {
  return passes.map((pass) =>
    pass.kind === 'path3d'
      ? {
          ...pass,
          points: pass.points.map((p) => ({
            ...toMachineCoords(applyTransform(p, placement), device),
            z: p.z,
          })),
        }
      : pass,
  );
}
