import { cncOpenContourOmissions } from './cnc-open-contour-omissions';
import type { DeviceProfile } from '../devices';
import type { CncMachineConfig, CncLayerSettings, Layer, Scene } from '../scene';
import type { ReliefMaterializationFailure } from '../relief/relief-materialization-failure';
import type { CncOperationSourceGeometry } from './cnc-compilation-artifact';
import { collectLayerContours, layerPolylinesFromContours } from './collect-cnc-contours';
import { compileReliefProjectionGroups } from './compile-cnc-relief-projection';
import { isProfileCutType } from './compile-cnc-helpers';
import { tagArtworkGroup, type CompiledCncOperation } from './compile-cnc-operation-result';

export function compileCncProjectedOperation(
  sourceObjects: Scene['objects'],
  allSourceObjects: Scene['objects'],
  layer: Layer,
  settings: CncLayerSettings,
  priorityObjectId: string,
  device: DeviceProfile,
  config: CncMachineConfig,
  sourceGeometry?: CncOperationSourceGeometry,
): CompiledCncOperation | ReliefMaterializationFailure {
  const contours = sourceGeometry?.contours ?? collectLayerContours(sourceObjects, layer, device);
  const polylines = sourceGeometry?.polylines ?? layerPolylinesFromContours(layer, contours);
  const projected = compileReliefProjectionGroups(
    allSourceObjects,
    layer,
    settings,
    device,
    config,
    polylines,
  );
  if (projected.kind === 'relief-materialization-failed') return projected;
  const groups = projected.groups.map((group) => tagArtworkGroup(group, priorityObjectId));
  return {
    kind: 'compiled',
    openContourOmissions: cncOpenContourOmissions(layer, contours),
    layerId: layer.id,
    clearingGroups: isProfileCutType(settings.cutType) ? [] : groups,
    profileGroups: isProfileCutType(settings.cutType) ? groups : [],
    reliefPlans: projected.plans,
    offsetLadderDiagnostics: [],
  };
}
