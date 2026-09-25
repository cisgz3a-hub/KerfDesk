// Which geometry the minimum-feature check reads, and against what width
// (ADR-408). Only cutting operations are checked: laser Line operations
// against the kerf, CNC profile and pocket operations against the bit.
// Fill, Image, engrave, V-carve, drill and relief operations are skipped —
// their marks are not parts that can fall apart.
//
// Geometry is the artwork itself, flattened exactly as compile flattens it
// and placed in machine coordinates, not the kerf-compensated path. Kerf
// Offset moves the loss from one side of a cut to the other (parts keep their
// size, holes and gaps shrink) but cannot make a feature finer than the beam,
// so the design rule is the same with or without it.

import { toMachineCoords, type DeviceProfile } from '../devices';
import { artworkOperationRuns } from '../artwork-order';
import { collectLayerPolylines } from '../cnc/collect-cnc-contours';
import { compilationPolylines } from '../job/compilation-polylines';
import {
  applyTransform,
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  outputOperationLayers,
  pathUsesOperation,
  sceneObjectUsesOperation,
  type CncCutType,
  type Layer,
  type LayerOperationSettings,
  type Project,
  type SceneObject,
} from '../scene';
import { effectiveOperationForObject } from '../scene/effective-operation';
import type { MinFeatureRequest } from './min-feature-analysis';
import type { MinFeaturePath } from './piece-index';

/** Kerf assumed for a laser Line operation when neither its Kerf Offset nor
 * the laser head's spot size says otherwise: a typical diode or CO2 kerf in
 * 3 mm plywood or acrylic is 0.1 to 0.2 mm. */
export const DEFAULT_LASER_KERF_MM = 0.15;

export type MinFeatureWidthSource = 'kerf-offset' | 'spot-size' | 'default-kerf' | 'tool';

export type MinFeatureTarget = {
  readonly layerId: string;
  readonly layerName: string;
  readonly machine: 'laser' | 'cnc';
  readonly widthSource: MinFeatureWidthSource;
  readonly cutType?: CncCutType;
  readonly toolName?: string;
  readonly request: MinFeatureRequest;
  readonly paths: ReadonlyArray<MinFeaturePath>;
};

type VectorObject = Extract<SceneObject, { readonly paths: unknown }>;

function isVectorObject(object: SceneObject): object is VectorObject {
  return (
    object.kind === 'imported-svg' ||
    object.kind === 'text' ||
    object.kind === 'traced-image' ||
    object.kind === 'shape'
  );
}

/** Kerf for a laser Line operation: twice a non-zero Kerf Offset (the offset
 * is half the kerf, as in LightBurn), else the head's larger spot axis, else
 * DEFAULT_LASER_KERF_MM. */
export function laserKerfFor(
  operation: Pick<LayerOperationSettings, 'kerfOffsetMm'>,
  device: DeviceProfile,
): { readonly mm: number; readonly source: MinFeatureWidthSource } {
  const offset = Math.abs(operation.kerfOffsetMm);
  if (Number.isFinite(offset) && offset > 0) return { mm: 2 * offset, source: 'kerf-offset' };
  const spot = device.laserSubProfile?.spotSizeMm;
  const spotMm = spot === undefined ? 0 : Math.max(spot.x, spot.y);
  if (Number.isFinite(spotMm) && spotMm > 0) return { mm: spotMm, source: 'spot-size' };
  return { mm: DEFAULT_LASER_KERF_MM, source: 'default-kerf' };
}

const CNC_SIDES: Partial<Record<CncCutType, Pick<MinFeatureRequest, 'checkWidths' | 'checkGaps'>>> =
  {
    // The bit clears the inside of the shape: it cannot enter narrower areas.
    'profile-inside': { checkWidths: true, checkGaps: false },
    pocket: { checkWidths: true, checkGaps: false },
    // The bit runs outside the shape: it cannot fit into narrower gaps.
    'profile-outside': { checkWidths: false, checkGaps: true },
    // The bit is centred on the line: both sides lose what it cannot fit.
    'profile-on-path': { checkWidths: true, checkGaps: true },
  };

function objectPaths(
  object: VectorObject,
  operation: Layer,
  device: DeviceProfile,
): MinFeaturePath[] {
  const out: MinFeaturePath[] = [];
  for (const path of object.paths) {
    if (!pathUsesOperation(object, path, operation)) continue;
    for (const polyline of compilationPolylines(path, object.transform)) {
      out.push({
        closed: polyline.closed,
        points: polyline.points.map((point) =>
          toMachineCoords(applyTransform(point, object.transform), device),
        ),
      });
    }
  }
  return out;
}

function laserTargets(
  objects: ReadonlyArray<VectorObject>,
  operation: Layer,
  device: DeviceProfile,
): MinFeatureTarget[] {
  // Objects can override the operation's mode or Kerf Offset, so group them
  // by the kerf they are actually cut with.
  const byKerf = new Map<number, { source: MinFeatureWidthSource; paths: MinFeaturePath[] }>();
  for (const object of objects) {
    if (!sceneObjectUsesOperation(object, operation)) continue;
    const effective = effectiveOperationForObject(operation, object);
    if (effective.mode !== 'line') continue;
    const kerf = laserKerfFor(effective, device);
    const group = byKerf.get(kerf.mm) ?? { source: kerf.source, paths: [] };
    group.paths.push(...objectPaths(object, operation, device));
    byKerf.set(kerf.mm, group);
  }
  return [...byKerf].map(
    ([mm, group]): MinFeatureTarget => ({
      layerId: operation.id,
      layerName: operation.name,
      machine: 'laser',
      widthSource: group.source,
      request: { thresholdMm: mm, checkWidths: true, checkGaps: true },
      paths: group.paths,
    }),
  );
}

function cncTarget(
  objects: ReadonlyArray<VectorObject>,
  layer: Layer,
  project: Project,
): MinFeatureTarget | null {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return null;
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const sides = CNC_SIDES[settings.cutType];
  if (sides === undefined) return null;
  const tool = layerCncTool(machine, settings);
  const paths = collectLayerPolylines(objects, layer, project.device);
  return {
    layerId: layer.id,
    layerName: layer.name,
    machine: 'cnc',
    widthSource: 'tool',
    cutType: settings.cutType,
    toolName: tool.name,
    request: { thresholdMm: tool.diameterMm, ...sides },
    paths,
  };
}

/** The cutting operations to check in `project`, optionally only for the
 * objects in `objectIds` (a fresh trace). Operations with no geometry are
 * left out. */
export function minFeatureTargets(
  project: Project,
  objectIds?: ReadonlySet<string>,
): ReadonlyArray<MinFeatureTarget> {
  const objects = project.scene.objects
    .filter(isVectorObject)
    .filter((object) => objectIds === undefined || objectIds.has(object.id));
  const targets: MinFeatureTarget[] = [];
  for (const { layer } of artworkOperationRuns(project.scene)) {
    if (project.machine?.kind === 'cnc') {
      const target = cncTarget(objects, layer, project);
      if (target !== null) targets.push(target);
      continue;
    }
    for (const operation of outputOperationLayers(layer)) {
      targets.push(...laserTargets(objects, operation, project.device));
    }
  }
  return targets.filter((target) => target.paths.length > 0);
}
