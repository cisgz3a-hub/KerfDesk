import type { DeviceProfile } from '../devices';
import type { Layer, Polyline, SceneObject } from '../scene';
import { layerOperationOutputEqual } from '../scene/layer';
import {
  collectFillContoursForLayer,
  collectFillSegmentsForLayer,
  islandFillGroupsForLayer,
} from './layer-fill';
import { fillRampApplies, rampedFillGroups, rotaryRampLayer } from './fill-ramp';
import type { LaserPowerScaleVersion } from '../output/laser-power-scale-version';
import { buildFillGroup } from './fill-group-build';
import { hasExecutableFillSweep } from './fill-group-emission';
import { contourEntryRunwayMm, contourExitRunwayMm } from './contour-entry';
import type { CutGroup, JobDiagnostic } from './job';
import { fillPassLayers } from './scan-pass-angles';
import { lineLeadDiagnostics, lineLeadFields, lineOvercutFields } from './line-cut-extras';
import { lineTabSpanGroups } from './line-tabs';
import { offsetFillDiagnostics } from './offset-fill-diagnostics';
import { commonVectorGroupFields } from './vector-group-fields';
import { resolveFillScanDirection } from './scan-direction-policy';
import { vectorCompilation, type VectorCompilation } from './vector-compilation';
import { vectorProcessBuckets, type VectorProcessBucket } from './vector-process-buckets';
import { stableFillArtworkSubset } from './stable-fill-artwork-subset';
import { lineTopologyCollections } from './compile-line-topology';
import type { KerfSceneSides } from './kerf-scene-sides';
import { ownedFillMaterial } from './fill-material-ownership';
import { normalizeClosedPolylinesNonZeroChecked } from '../geometry/polygon-difference';
import type { LineSegmentCollection } from './collect-line-segments';
import { allMaterialTestCells } from './material-test-cell-order';

const NO_DIAGNOSTICS: ReadonlyArray<JobDiagnostic> = [];

export function compileVectorGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  priorityObjectId: string,
  scope: string,
  keepLeadRings = false,
  kerfSides?: () => KerfSceneSides,
  laserPowerScaleVersion?: LaserPowerScaleVersion,
): VectorCompilation {
  const buckets = vectorProcessBuckets(objects, layer);
  const fillBuckets = buckets.filter((bucket) => bucket.layer.mode === 'fill');
  const lineBuckets = buckets.filter((bucket) => bucket.layer.mode === 'line');
  const lines = lineTopologyCollections(
    lineBuckets,
    device,
    scope,
    keepLeadRings,
    kerfSides === undefined ? undefined : { operationId: layer.id, sides: kerfSides },
  );
  const fill = resolveFillContext(objects, fillBuckets, device);
  const output = vectorCompilation(
    buckets.map((bucket, bucketIndex) =>
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
                laserPowerScaleVersion,
              )
        : lineGroups(
            lines.get(bucket) ?? { segments: [], tabSpans: [], kerfDiagnostics: [] },
            bucket.layer,
            device,
            bucket.powerSource,
            priorityObjectId,
            // ADR-497 Amendment 1: a Material Test cell is planned on its own,
            // so its row keeps the generated lowest-risk-first order.
            allMaterialTestCells(bucket.objects) ? `${scope}:cell:${bucketIndex}` : scope,
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
  readonly uniformFillObjects: ReadonlyArray<SceneObject>;
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
        layerOperationOutputEqual(bucket.layer, firstFill.layer),
    );
  const uniformMembers = new Set<SceneObject>(
    uniformFill ? fillBuckets.flatMap((bucket) => bucket.objects) : [],
  );
  const uniformFillObjects = uniformFill ? stableFillArtworkSubset(objects, uniformMembers) : [];
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
  laserPowerScaleVersion?: LaserPowerScaleVersion,
): VectorCompilation {
  // ADR-699 Amd 1: a ramped Fill on a rotary scans one way along X, as an image does.
  const rotaryRamp = rotaryRampLayer(layer, device);
  const rotaryNotice: VectorCompilation = {
    groups: [],
    diagnostics:
      rotaryRamp?.turnedAside === true
        ? [{ kind: 'fill-ramp-scan-angle-rotary', layerName: layer.name }]
        : NO_DIAGNOSTICS,
  };
  // ADR-492: with an angle change per pass, each angle hatches as its own group.
  const passLayers = rotaryRamp === null ? fillPassLayers(layer) : [rotaryRamp.layer];
  return vectorCompilation([
    rotaryNotice,
    ...passLayers.map((passLayer) => {
      if (!fillRampApplies(passLayer))
        return flatFillGroups(
          objects,
          passLayer,
          device,
          powerSource,
          sourceObjectId,
          suppliedContours,
        );
      // ADR-699: a ramp too large to grade burns flat, with a warning.
      const ramped = rampedFillGroups({
        contours: suppliedContours ?? collectFillContoursForLayer(objects, passLayer, device),
        layer: passLayer,
        device,
        powerSource,
        sourceObjectId,
        laserPowerScaleVersion,
      });
      if (ramped.diagnostics.length === 0) return ramped;
      return vectorCompilation([
        { groups: [], diagnostics: ramped.diagnostics },
        flatFillGroups(objects, passLayer, device, powerSource, sourceObjectId, suppliedContours),
      ]);
    }),
  ]);
}

function flatFillGroups(
  objects: ReadonlyArray<SceneObject>,
  passLayer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
  sourceObjectId?: string,
  suppliedContours?: ReadonlyArray<Polyline>,
): VectorCompilation {
  return passLayer.fillStyle === 'island'
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
  const diagnostics = [
    ...line.kerfDiagnostics,
    ...lineLeadDiagnostics(layer, {
      tabbed: line.tabbedContours ?? 0,
      perforated: line.perforatedContours ?? 0,
    }),
  ];
  if (line.segments.length === 0 && line.tabSpans.length === 0) return { groups: [], diagnostics };
  const common = {
    ...commonVectorGroupFields(layer, device, powerSource, sourceObjectId),
    topologyScope: scope,
  };
  const entryRunwayMm = contourEntryRunwayMm(device, layer.fillOverscanMm);
  // ADR-239 Amendment 2: an M3 contour also leaves by a laser-off exit.
  const exitRunwayMm = contourExitRunwayMm(device, entryRunwayMm, 'cut', common.powerMode);
  const runway = {
    ...(entryRunwayMm === undefined ? {} : { entryRunwayMm }),
    ...(exitRunwayMm === undefined ? {} : { exitRunwayMm }),
  };
  const cut: ReadonlyArray<CutGroup> =
    line.segments.length === 0
      ? []
      : [
          {
            ...common,
            kind: 'cut' as const,
            ...runway,
            ...lineOvercutFields(layer, line.segments),
            ...lineLeadFields(layer, line.segments),
            ...(line.topologyRings === undefined ? {} : { topologyRings: line.topologyRings }),
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
