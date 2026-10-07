import type { DeviceProfile } from '../devices';
import { layerOperationSettingsEqual, type Layer, type Polyline, type SceneObject } from '../scene';
import { collectFillSegmentsForLayer, islandFillGroupsForLayer } from './layer-fill';
import { buildFillGroup } from './fill-group-build';
import { hasExecutableFillSweep } from './fill-group-emission';
import { contourEntryRunwayMm } from './contour-entry';
import type { CutGroup, JobDiagnostic } from './job';
import { fillPassLayers } from './scan-pass-angles';
import { lineOvercutFields } from './line-cut-extras';
import { lineTabSpanGroups } from './line-tabs';
import { offsetFillDiagnostics } from './offset-fill-diagnostics';
import { commonVectorGroupFields } from './vector-group-fields';
import { resolveFillScanDirection } from './scan-direction-policy';
import { vectorCompilation, type VectorCompilation } from './vector-compilation';
import {
  vectorProcessBuckets,
  type VectorProcessBucket,
  type VectorArtwork,
} from './vector-process-buckets';
import { lineTopologyCollections } from './compile-line-topology';
import { ownedFillMaterial } from './fill-material-ownership';
import { normalizeClosedPolylinesNonZeroChecked } from '../geometry/polygon-difference';
import type { LineSegmentCollection } from './collect-line-segments';

const NO_DIAGNOSTICS: ReadonlyArray<JobDiagnostic> = [];

export function compileVectorGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  priorityObjectId: string,
  scope: string,
): VectorCompilation {
  const buckets = vectorProcessBuckets(objects, layer);
  const fillBuckets = buckets.filter((bucket) => bucket.layer.mode === 'fill');
  const lineBuckets = buckets.filter((bucket) => bucket.layer.mode === 'line');
  const lines = lineTopologyCollections(lineBuckets, device, scope);
  const fill = resolveFillContext(objects, fillBuckets, device);
  const output = vectorCompilation(
    buckets.map((bucket) =>
      bucket.layer.mode === 'fill'
        ? fill.uniformFill && bucket !== fill.firstFill
          ? { groups: [], diagnostics: [] }
          : fill.failedObjectIds !== null
            ? { groups: [], diagnostics: [] }
            : vectorGroupsForLayer(
                fill.uniformFill ? fill.uniformFillObjects : bucket.objects,
                bucket.layer,
                device,
                bucket.powerSource,
                priorityObjectId,
                fill.fillContours.get(bucket),
              )
        : lineGroups(
            lines.get(bucket) ?? { segments: [], tabSpans: [], kerfDiagnostics: [] },
            bucket.layer,
            device,
            bucket.powerSource,
            priorityObjectId,
            scope,
          ),
    ),
  );
  const scoped = {
    ...output,
    groups: output.groups.map((group) =>
      group.kind === 'fill' ? { ...group, topologyScope: scope } : group,
    ),
  };
  if (fill.failedObjectIds === null) return scoped;
  const objectIds = fill.failedObjectIds;
  return {
    ...scoped,
    diagnostics: [
      ...output.diagnostics,
      {
        kind: 'fill-ownership-failed',
        layerId: layer.id,
        layerName: layer.name,
        runScope: scope,
        objectIds,
        count: objectIds.length,
      },
    ],
  };
}

type FillContext = {
  readonly firstFill: VectorProcessBucket | undefined;
  readonly uniformFill: boolean;
  readonly uniformFillObjects: ReadonlyArray<VectorArtwork>;
  readonly fillContours: ReadonlyMap<VectorProcessBucket, ReadonlyArray<Polyline>>;
  readonly failedObjectIds: ReadonlyArray<string> | null;
};

function resolveFillContext(
  objects: ReadonlyArray<SceneObject>,
  fillBuckets: ReadonlyArray<VectorProcessBucket>,
  device: DeviceProfile,
): FillContext {
  const fillContours = new Map<VectorProcessBucket, ReadonlyArray<Polyline>>();
  let failedObjectIds: ReadonlyArray<string> | null = null;
  // Uniform settings AND actual power bypass ownership normalization entirely (dense Sharp).
  const firstFill = fillBuckets[0];
  const uniformFill =
    firstFill !== undefined &&
    fillBuckets.every(
      (bucket) =>
        bucket.power === firstFill.power &&
        layerOperationSettingsEqual(bucket.layer, firstFill.layer),
    );
  const uniformMembers = new Set<SceneObject>(
    uniformFill ? fillBuckets.flatMap((bucket) => bucket.objects) : [],
  );
  const uniformFillObjects = uniformFill
    ? objects.filter((object): object is VectorArtwork => uniformMembers.has(object))
    : [];
  if (fillBuckets.length > 1 && !uniformFill) {
    const byObject = new Map(
      fillBuckets.flatMap((bucket) =>
        bucket.objects.map((object) => [object, bucket.layer] as const),
      ),
    );
    const contributors = objects.flatMap((object, canvasIndex) => {
      if (!('paths' in object)) return [];
      const effective = byObject.get(object);
      return effective === undefined ? [] : [{ object, layer: effective, canvasIndex }];
    });
    const owned = ownedFillMaterial(contributors, device);
    if (owned.kind === 'error') {
      failedObjectIds = owned.error.objectIds;
    } else
      for (const bucket of fillBuckets) {
        const merged = normalizeClosedPolylinesNonZeroChecked(
          bucket.objects.flatMap((object) => owned.value.byObject.get(object) ?? []),
        );
        if (merged.kind === 'error') {
          failedObjectIds = owned.value.objectIds;
          break;
        }
        fillContours.set(bucket, merged.value);
      }
  }
  return { firstFill, uniformFill, uniformFillObjects, fillContours, failedObjectIds };
}

function vectorGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
  sourceObjectId?: string,
  suppliedContours?: ReadonlyArray<Polyline>,
): VectorCompilation {
  // ADR-492: with an angle change per pass, each angle hatches as its own group.
  return vectorCompilation(
    fillPassLayers(layer).map((passLayer) =>
      passLayer.fillStyle === 'island'
        ? {
            groups: islandFillGroupsForLayer(
              objects,
              passLayer,
              device,
              powerSource,
              sourceObjectId,
              suppliedContours,
            ),
            diagnostics: NO_DIAGNOSTICS,
          }
        : offsetOrHatchFillGroups(
            objects,
            passLayer,
            device,
            powerSource,
            sourceObjectId,
            suppliedContours,
          ),
    ),
  );
}

function lineGroups(
  line: LineSegmentCollection,
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject,
  sourceObjectId: string,
  scope: string,
): VectorCompilation {
  // Reported even when no segments survived: a failed kerf offset takes every
  // closed contour on the layer with it, which is precisely the case where the
  // layer would otherwise vanish from the job without a trace.
  const diagnostics = line.kerfDiagnostics;
  if (line.segments.length === 0 && line.tabSpans.length === 0) return { groups: [], diagnostics };
  const common = {
    ...commonVectorGroupFields(layer, device, powerSource, sourceObjectId),
    topologyScope: scope,
  };
  const entryRunwayMm = contourEntryRunwayMm(device, layer.fillOverscanMm);
  const runway = entryRunwayMm === undefined ? {} : { entryRunwayMm };
  const cut: ReadonlyArray<CutGroup> =
    line.segments.length === 0
      ? []
      : [
          {
            ...common,
            kind: 'cut' as const,
            ...runway,
            ...lineOvercutFields(layer, line.segments),
            segments: line.segments,
          },
        ];
  return {
    groups: [...cut, ...lineTabSpanGroups({ ...common, ...runway }, layer, line.tabSpans)],
    diagnostics,
  };
}

function offsetOrHatchFillGroups(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
  sourceObjectId?: string,
  suppliedContours?: ReadonlyArray<Polyline>,
): VectorCompilation {
  const scanDirection = resolveFillScanDirection(device, layer);
  const hatchingLayer =
    layer.fillStyle === 'offset'
      ? layer
      : { ...layer, fillBidirectional: scanDirection.bidirectional };
  const fill = collectFillSegmentsForLayer(objects, hatchingLayer, device, suppliedContours);
  const diagnostics =
    fill.offsetFillTermination === undefined
      ? NO_DIAGNOSTICS
      : offsetFillDiagnostics(fill.offsetFillTermination, layer.name);
  if (fill.segments.length === 0) return { groups: [], diagnostics };
  const common = commonVectorGroupFields(layer, device, powerSource, sourceObjectId);
  const group = buildFillGroup({
    layer,
    device,
    common,
    scanDirection,
    segments: fill.segments,
  });
  if (!hasExecutableFillSweep(group, device.scanningOffsets)) {
    return {
      groups: [],
      diagnostics: [...diagnostics, { kind: 'fill-collapsed-at-precision', layerName: layer.name }],
    };
  }
  return { groups: [group], diagnostics };
}
