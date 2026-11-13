// Which geometry the minimum-feature check reads, and against what width
// (ADR-433). Only cutting operations are checked: laser Line operations
// against the kerf, CNC profile, pocket and straight inlay operations against
// the bit. Fill, Image, engrave, V-carve, drill and relief operations are
// skipped — their marks are not parts that can fall apart — and so is a
// tapered inlay pair, which V-carves its detail into both halves.
//
// Geometry is the artwork itself, flattened exactly as compile flattens it
// and placed in machine coordinates, not the kerf-compensated path; a CNC
// profile first keeps only the edge of a traced double-line ring that compile
// machines (ADR-218), through compile's own selection. Kerf Offset moves the
// loss from one side of a cut to the other (parts keep their size, holes and
// gaps shrink) but cannot make a feature finer than the beam, so the design
// rule is the same with or without it.
//
// A laser Line operation is as often a score or an engrave as a cut, and its
// settings rarely say which. It counts as a DECLARED cut only when the
// operator set something only a through-cut uses: a Kerf Offset, tabs or more
// than one pass. Otherwise its findings are ASSUMED: Job Review shows them as
// one optional line and a fresh trace gets no notice.

import { toMachineCoords, type DeviceProfile } from '../devices';
import { artworkOperationRuns } from '../artwork-order';
import { collectLayerContours, layerPolylinesFromContours } from '../cnc/collect-cnc-contours';
import { lineArtContoursForLayer } from '../cnc/compile-cnc-layer-passes';
import { cncLayoutCutWidths } from '../cnc/layout-cut-widths';
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
  type Polyline,
  type Project,
  type SceneObject,
} from '../scene';
import { effectiveOperationForObject } from '../scene/effective-operation';
import type { MinFeatureRequest } from './min-feature-analysis';
import type { MinFeaturePath } from './piece-index';
import { appendAll } from '../util';

/** Kerf assumed for a laser Line operation when neither its Kerf Offset nor
 * the laser head's spot size says otherwise: a typical diode or CO2 kerf in
 * 3 mm plywood or acrylic is 0.1 to 0.2 mm. */
export const DEFAULT_LASER_KERF_MM = 0.15;

/** How much wider than a CNC cut an area may be and still get no path: half
 * the 0.001 mm G-code grid. The pocket planner insets by exactly the bit
 * radius, so an area the bit's width wide collapses to a line it drops, while
 * one 0.001 mm wider is cut (CNC audit v3 N3r-P2-2, ADR-433 Amendment 6). */
export const CNC_WIDTH_TIE_MM = 0.0005;

export type MinFeatureWidthSource = 'kerf-offset' | 'spot-size' | 'default-kerf' | 'tool';

/** 'declared': the operation is set up to cut through (always so for CNC
 * profiles and pockets); 'assumed': a laser Line operation that may as well
 * score or engrave. */
export type MinFeatureCutIntent = 'declared' | 'assumed';

export type MinFeatureTarget = {
  readonly layerId: string;
  readonly layerName: string;
  readonly machine: 'laser' | 'cnc';
  readonly widthSource: MinFeatureWidthSource;
  readonly cutIntent: MinFeatureCutIntent;
  readonly cutType?: CncCutType;
  readonly toolName?: string;
  /** Set when the bit cuts narrower than its stored diameter at this depth
   * (V-bit, ball nose, tapered ball nose): the threshold is that cut width. */
  readonly cutDepthMm?: number;
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

/** Whether a laser Line operation's settings say it cuts through: Kerf
 * Offset, tabs and extra passes serve only through-cuts. The head's spot size
 * says how wide the beam is, not whether this operation cuts. */
export function laserCutIntent(
  operation: Pick<LayerOperationSettings, 'kerfOffsetMm' | 'tabsEnabled' | 'passes'>,
): MinFeatureCutIntent {
  const offset = Math.abs(operation.kerfOffsetMm);
  const hasOffset = Number.isFinite(offset) && offset > 0;
  return hasOffset || operation.tabsEnabled || operation.passes > 1 ? 'declared' : 'assumed';
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
    // A straight pair cuts both halves from one bit-radius design (ADR-155): a part narrower
    // than the bit is left out of the pocket and the insert, a narrower gap is closed in both
    // (ADR-433 Amendment 2).
    'inlay-pair': { checkWidths: true, checkGaps: true },
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

type LaserGroup = {
  readonly mm: number;
  readonly source: MinFeatureWidthSource;
  readonly cutIntent: MinFeatureCutIntent;
  readonly paths: MinFeaturePath[];
};

function laserTargets(
  objects: ReadonlyArray<VectorObject>,
  operation: Layer,
  device: DeviceProfile,
): MinFeatureTarget[] {
  // Objects can override the operation's mode, Kerf Offset, tabs or passes,
  // so group them by the kerf they are cut with, where that kerf comes from
  // and whether they are declared cuts: a warning states all three.
  const groups = new Map<string, LaserGroup>();
  for (const object of objects) {
    if (!sceneObjectUsesOperation(object, operation)) continue;
    const effective = effectiveOperationForObject(operation, object);
    if (effective.mode !== 'line') continue;
    const kerf = laserKerfFor(effective, device);
    const cutIntent = laserCutIntent(effective);
    const key = `${kerf.mm}|${kerf.source}|${cutIntent}`;
    const group = groups.get(key) ?? { mm: kerf.mm, source: kerf.source, cutIntent, paths: [] };
    appendAll(group.paths, objectPaths(object, operation, device));
    groups.set(key, group);
  }
  return [...groups.values()].map(
    (group): MinFeatureTarget => ({
      layerId: operation.id,
      layerName: operation.name,
      machine: 'laser',
      widthSource: group.source,
      cutIntent: group.cutIntent,
      request: { thresholdMm: group.mm, checkWidths: true, checkGaps: true },
      paths: group.paths,
    }),
  );
}

/** The contours compile machines for `layer`: the layer's pool minus the
 * dropped edge of each traced double-line ring, then limited to `objectIds`.
 * Rings pair across every object, as in compile, before the limit applies. */
function cncMachinedPaths(
  objects: ReadonlyArray<VectorObject>,
  layer: Layer,
  project: Project,
  toolDiameterMm: number,
  objectIds: ReadonlySet<string> | undefined,
): MinFeaturePath[] {
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const contours = collectLayerContours(objects, layer, project.device);
  const polylines = layerPolylinesFromContours(layer, contours);
  const machined = lineArtContoursForLayer(polylines, settings, toolDiameterMm, contours);
  if (objectIds === undefined) return [...machined];
  const owner = new Map<Polyline, string | undefined>(
    contours.map((contour) => [contour.polyline, contour.objectId]),
  );
  return machined.filter((polyline) => {
    const id = owner.get(polyline);
    return id !== undefined && objectIds.has(id);
  });
}

function cncTarget(
  objects: ReadonlyArray<VectorObject>,
  layer: Layer,
  project: Project,
  objectIds: ReadonlySet<string> | undefined,
): MinFeatureTarget | null {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return null;
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const sides = CNC_SIDES[settings.cutType];
  if (sides === undefined) return null;
  const tool = layerCncTool(machine, settings);
  // A tapered pair V-carves both halves (ADR-665), and a straight pair with another bit is
  // refused outright (cnc-inlay-issues), so only an end-mill straight pair is checked.
  if (
    settings.cutType === 'inlay-pair' &&
    (settings.taperedInlay !== undefined || tool.kind !== 'end-mill')
  )
    return null;
  const paths = cncMachinedPaths(objects, layer, project, tool.diameterMm, objectIds);
  // The compiler lays a bit that narrows toward its tip out by what it cuts
  // at the operation's full depth (ADR-368 Amendment 3), so only a feature
  // narrower than that width is left uncut (second CNC audit P2-toolpath-4).
  const { wallDiameterMm } = cncLayoutCutWidths(tool, settings.depthMm, settings.depthPerPassMm);
  return {
    layerId: layer.id,
    layerName: layer.name,
    machine: 'cnc',
    widthSource: 'tool',
    cutIntent: 'declared',
    cutType: settings.cutType,
    toolName: tool.name,
    ...(wallDiameterMm < tool.diameterMm ? { cutDepthMm: settings.depthMm } : {}),
    // A bit drops a closed shape it cannot enter whole, however small, so no
    // such shape is a speck (ADR-433 Amendment 3). An area exactly as wide as
    // the cut insets to a zero-width line the planner drops (Amendment 6).
    request: {
      thresholdMm: wallDiameterMm,
      ...sides,
      wholeShapes: true,
      widthTieMm: CNC_WIDTH_TIE_MM,
    },
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
  const vectors = project.scene.objects.filter(isVectorObject);
  const objects = vectors.filter((object) => objectIds === undefined || objectIds.has(object.id));
  const targets: MinFeatureTarget[] = [];
  for (const { layer } of artworkOperationRuns(project.scene)) {
    if (project.machine?.kind === 'cnc') {
      const target = cncTarget(vectors, layer, project, objectIds);
      if (target !== null) targets.push(target);
      continue;
    }
    for (const operation of outputOperationLayers(layer)) {
      targets.push(...laserTargets(objects, operation, project.device));
    }
  }
  return targets.filter((target) => target.paths.length > 0);
}
