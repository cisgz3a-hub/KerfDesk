import type { CncTool, Transform } from '../scene';
import type { Heightmap } from '../relief/heightmap';
import { toMachineCoords, toSceneCoords, type DeviceProfile } from '../devices';
import type { CncGroup, CncPass } from '../job';
import type { CncReliefPlanningEvidence } from '../job/job';
import { reliefProjectionPlan } from '../relief/relief-projection-plan';
import { reliefObjectToHeightmap } from '../relief/relief-object-to-heightmap';
import {
  reliefMaterializationFailure,
  type ReliefMaterializationFailure,
} from '../relief/relief-materialization-failure';
import { inverseReliefPoint } from '../relief/relief-vector-boundary';
import {
  applyTransform,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
  type Polyline,
  type SceneObject,
} from '../scene';
import { reliefMachineSpaceGeometry } from './relief-machine-space';
import { reliefGroup } from './cnc-relief-group';

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

function projectionEvidence(
  layer: Layer,
  source: string,
  targetObjectId: string,
  targetRevision: number,
  settings: CncLayerSettings,
  tool: CncTool,
  map: Heightmap,
  liftedVertices: number,
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
