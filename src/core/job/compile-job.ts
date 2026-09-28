// compileJob — Scene + DeviceProfile → Job.
//
// Walks every output-enabled Layer, materializes its polylines from the
// SceneObjects that match its color, applies each object's transform and the
// device's origin transform, and bundles the result with the layer's
// power / speed / passes.
//
// Pure: depends only on its arguments. No clock, no random, no I/O.
// Determinism: iteration order matches scene.layers and scene.objects (both
// arrays, indexed loops) → repeatable across runs.

import { type DeviceProfile, toMachineCoords } from '../devices';
import { artworkOperationRuns, orderedArtworkObjects } from '../artwork-order';
import {
  applyTransform,
  assertNever,
  type ColoredPath,
  type Layer,
  layerOperationSettingsEqual,
  outputOperationLayers,
  pathUsesOperation,
  sceneObjectUsesOperation,
  type Polyline,
  type Scene,
  type SceneObject,
  type Vec2,
  withClosingPoint,
} from '../scene';
import { segmentNesting } from './cut-segment-nesting';
import {
  effectiveOperationForObject,
  operationOverrideForObject,
} from '../scene/effective-operation';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import { sharedObjectPowerScalePercent } from './compile-job-object-policy';
import { compilationPolylines } from './compilation-polylines';
import { laserArcFitFor } from './cut-arc-moves';
import {
  contourEntryBoundsForDevice,
  contourEntryRunwayMm,
  withContourEntryBounds,
} from './contour-entry';
import { hasExecutableFillSweep } from './fill-group-emission';
import { buildFillGroup } from './fill-group-build';
import { collectFillSegmentsForLayer, islandFillGroupsForLayer } from './layer-fill';
import type { CutGroup, CutSegment, Group, Job, JobDiagnostic } from './job';
import { placedTabPointsForContour } from './laser-tab-anchors';
import {
  kerfArcSourceRings,
  withLayerKerf,
  type KerfSource,
  type PendingKerfGroup,
} from './layer-kerf';
import { fillPassLayers } from './scan-pass-angles';
import { lineOvercutFields, perforateLineSegments } from './line-cut-extras';
import { applyLineTabs, lineTabSpanGroups } from './line-tabs';
import { offsetFillDiagnostics } from './offset-fill-diagnostics';
import { commonVectorGroupFields } from './vector-group-fields';
import { resolveFillScanDirection } from './scan-direction-policy';
import { registrationJigCompilationRuns } from './registration-jig-compilation-runs';

// Groups plus anything the operator should be told about them. Threaded up
// rather than logged, because src/core/ has no logger and a warning that never
// reaches Job Review is the same as no warning at all.
type VectorCompilation = {
  readonly groups: ReadonlyArray<Group>;
  readonly diagnostics: ReadonlyArray<JobDiagnostic>;
};

// Line-mode segments plus whether the kerf offset lost any of them. A failed
// offset and a layer with no closed contours both yield fewer segments, so
// without the flag a dropped cut is indistinguishable from a layer that never
// had one.
type LineSegmentCollection = {
  readonly segments: ReadonlyArray<CutSegment>;
  readonly tabSpans: ReadonlyArray<CutSegment>;
  readonly kerfOffsetFailed: boolean;
};

// Line segments as collected, with the machine-space centres of any tabs
// placed by hand on each, keyed by segment index (ADR-494), and the closed
// contours still waiting for the layer-wide kerf offset (ADR-486).
type LineSegmentSink = {
  readonly segments: CutSegment[];
  readonly placedTabs: Map<number, ReadonlyArray<Vec2>>;
  readonly kerf: PendingKerfGroup[];
};

const NO_DIAGNOSTICS: ReadonlyArray<JobDiagnostic> = [];

function vectorCompilation(parts: ReadonlyArray<VectorCompilation>): VectorCompilation {
  return {
    groups: parts.flatMap((part) => part.groups),
    diagnostics: parts.flatMap((part) => part.diagnostics),
  };
}

export function compileJob(scene: Scene, device: DeviceProfile): Job {
  const groups: Group[] = [];
  const diagnostics: JobDiagnostic[] = [];
  const completeSceneObjects = [...scene.objects, ...(scene.outputDependencies ?? [])];
  const jigRuns = registrationJigCompilationRuns(scene);
  if (jigRuns !== null) {
    for (const run of jigRuns) {
      appendOperationCompilation(
        { groups, diagnostics },
        run.vectorObjects,
        run.rasterObjects,
        run.layer,
        device,
        run.priorityObjectId,
        completeSceneObjects,
      );
    }
    return withContourEntryBounds(
      diagnostics.length === 0 ? { groups } : { groups, diagnostics },
      contourEntryBoundsForDevice(device),
    );
  }
  const orderedObjects = orderedArtworkObjects(scene);
  for (const { layer, priorityObjectId } of artworkOperationRuns(scene)) {
    appendOperationCompilation(
      { groups, diagnostics },
      scene.objects,
      orderedObjects,
      layer,
      device,
      priorityObjectId,
      completeSceneObjects,
    );
  }
  return withContourEntryBounds(
    diagnostics.length === 0 ? { groups } : { groups, diagnostics },
    contourEntryBoundsForDevice(device),
  );
}

function appendOperationCompilation(
  output: { readonly groups: Group[]; readonly diagnostics: JobDiagnostic[] },
  vectorObjects: ReadonlyArray<SceneObject>,
  rasterObjects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  priorityObjectId: string,
  completeSceneObjects: ReadonlyArray<SceneObject>,
): void {
  for (const operationLayer of outputOperationLayers(layer)) {
    if (operationLayer.mode !== 'image') {
      const vector = compileVectorGroupsForLayer(
        vectorObjects,
        operationLayer,
        device,
        priorityObjectId,
      );
      for (const group of vector.groups) output.groups.push(group);
      for (const diagnostic of vector.diagnostics) output.diagnostics.push(diagnostic);
    }
    const raster = compileRasterGroupsForLayer(rasterObjects, operationLayer, device, {
      sceneObjects: completeSceneObjects,
    });
    for (const group of raster.groups) output.groups.push(group);
    for (const diagnostic of raster.diagnostics) output.diagnostics.push(diagnostic);
  }
}

function compileVectorGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  priorityObjectId: string,
): VectorCompilation {
  const matchingObjects = objects.filter((obj) => vectorObjectMatchesLayer(obj, layer));
  if (matchingObjects.every((obj) => operationOverrideForObject(layer, obj) === undefined)) {
    return vectorGroupsForObjects(objects, matchingObjects, layer, device, priorityObjectId);
  }

  return vectorCompilation(
    vectorObjectBucketsForLayer(objects, layer).map((bucket) =>
      vectorGroupsForObjects(
        bucket.objects,
        bucket.objects,
        bucket.layer,
        device,
        priorityObjectId,
      ),
    ),
  );
}

function vectorGroupsForObjects(
  sourceObjects: ReadonlyArray<SceneObject>,
  matchingObjects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  priorityObjectId: string,
): VectorCompilation {
  const onlyObject = matchingObjects.length === 1 ? matchingObjects[0] : undefined;
  if (onlyObject !== undefined) {
    return vectorGroupsForLayer(sourceObjects, layer, device, onlyObject, priorityObjectId);
  }
  const sharedScale = sharedObjectPowerScalePercent(matchingObjects);
  if (sharedScale !== undefined) {
    const overrideSource = matchingObjects.find(
      (object) => operationOverrideForObject(layer, object) !== undefined,
    );
    return vectorGroupsForLayer(
      sourceObjects,
      layer,
      device,
      overrideSource ?? { powerScale: sharedScale },
      priorityObjectId,
    );
  }
  return vectorCompilation(
    matchingObjects.map((obj) => vectorGroupsForLayer([obj], layer, device, obj, priorityObjectId)),
  );
}

function vectorObjectBucketsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
): ReadonlyArray<{ readonly layer: Layer; readonly objects: ReadonlyArray<SceneObject> }> {
  const buckets: Array<{ layer: Layer; objects: SceneObject[] }> = [];
  for (const obj of objects) {
    if (!vectorObjectMatchesLayer(obj, layer)) continue;
    const effectiveLayer = effectiveOperationForObject(layer, obj);
    if (effectiveLayer.mode === 'image') continue;
    const bucket = buckets.find((candidate) =>
      layerOperationSettingsEqual(candidate.layer, effectiveLayer),
    );
    if (bucket === undefined) {
      buckets.push({ layer: effectiveLayer, objects: [obj] });
    } else {
      bucket.objects.push(obj);
    }
  }
  return buckets;
}

function vectorGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
  sourceObjectId?: string,
): VectorCompilation {
  if (layer.mode === 'fill') {
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
              ),
              diagnostics: NO_DIAGNOSTICS,
            }
          : offsetOrHatchFillGroups(objects, passLayer, device, powerSource, sourceObjectId),
      ),
    );
  }
  const line = collectLineSegmentsForLayer(objects, layer, device);
  // Reported even when no segments survived: a failed kerf offset takes every
  // closed contour on the layer with it, which is precisely the case where the
  // layer would otherwise vanish from the job without a trace.
  const diagnostics: ReadonlyArray<JobDiagnostic> = line.kerfOffsetFailed
    ? [{ kind: 'kerf-offset-failed', layerName: layer.name }]
    : NO_DIAGNOSTICS;
  if (line.segments.length === 0 && line.tabSpans.length === 0) return { groups: [], diagnostics };
  const common = commonVectorGroupFields(layer, device, powerSource, sourceObjectId);
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
): VectorCompilation {
  const scanDirection = resolveFillScanDirection(device, layer);
  const hatchingLayer =
    layer.fillStyle === 'offset'
      ? layer
      : { ...layer, fillBidirectional: scanDirection.bidirectional };
  const fill = collectFillSegmentsForLayer(objects, hatchingLayer, device);
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

function vectorObjectMatchesLayer(obj: SceneObject, layer: Layer): boolean {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return sceneObjectUsesOperation(obj, layer);
    case 'raster-image':
    case 'relief':
      return false;
    default:
      assertNever(obj, 'SceneObject');
  }
}

function collectLineSegmentsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): LineSegmentCollection {
  const out: LineSegmentSink = { segments: [], placedTabs: new Map(), kerf: [] };
  for (const obj of objects) appendSegmentsFromObject(obj, layer, device, out);
  // The kerf offset runs once for the whole layer, so a hole drawn as its own
  // object is offset as a hole (ADR-486). A failure is reported, not dropped.
  const kerfed = withLayerKerf(out, layer, device);
  const tabbed = applyLineTabs(kerfed.segments, kerfed.placedTabs, layer);
  return {
    segments: perforateLineSegments(tabbed.segments, layer),
    tabSpans: tabbed.tabSpans,
    kerfOffsetFailed: kerfed.failed,
  };
}

function appendSegmentsFromObject(
  obj: SceneObject,
  layer: Layer,
  device: DeviceProfile,
  out: LineSegmentSink,
): void {
  // Exhaustive over SceneObject.kind — enforced by
  // `@typescript-eslint/switch-exhaustiveness-check`. The default arm's
  // assertNever turns missing arms into compile errors when a new
  // variant lands (per ADR-014).
  switch (obj.kind) {
    case 'imported-svg':
      return appendPathSegments(obj, layer, device, out);
    case 'text':
      return appendPathSegments(obj, layer, device, out);
    case 'traced-image':
      return appendPathSegments(obj, layer, device, out);
    case 'shape':
      return appendPathSegments(obj, layer, device, out);
    case 'raster-image':
      // F.2.c: SceneObject union now includes raster-image. The
      // dedicated raster emit path (compileRasterGroup → emitRaster)
      // lands in F.2.d; for this commit, raster images don't
      // contribute polyline segments and the compile path skips
      // them. Behaviour parity with the F.2.b standalone emit-raster
      // tests preserved.
      return;
    case 'relief':
      // CNC-only geometry — the laser compiler never emits it.
      return;
    default:
      assertNever(obj, 'SceneObject');
  }
}

// Shared materializer for any SceneObject whose paths are already
// available as ColoredPath polylines (ImportedSvg, TextObject,
// TracedImage). The switch above stays one-arm-per-kind for
// exhaustiveness, but each arm just delegates here — no duplicated
// coordinate-transform math.
//
// Line mode transforms source contours directly. Fill mode uses the
// layer-wide machine-space path above so hatch spacing is physical and
// same-layer contours interact before hatching.
function appendPathSegments(
  object: Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>,
  layer: Layer,
  device: DeviceProfile,
  out: LineSegmentSink,
): void {
  for (const [pathIndex, path] of object.paths.entries()) {
    if (!pathUsesOperation(object, path, layer)) continue;
    const closedForKerf: KerfSource[] = [];
    const withArcs = laserArcFitFor(path, object.transform, device);
    const nesting = segmentNesting(path, `${object.id}#${pathIndex}`);
    const kerfArcSource = kerfArcSourceRings(path, object.transform, layer, device);
    for (const [index, polyline] of compilationPolylines(path, object.transform).entries()) {
      const points: Vec2[] = polyline.points.map((p) =>
        toMachineCoords(applyTransform(p, object.transform), device),
      );
      // ADR-494: tabs placed by hand, looked up only while tabs are on.
      const placed = layer.tabsEnabled
        ? placedTabPointsForContour(object, pathIndex, index, device)
        : [];
      if (shouldApplyKerf(polyline, layer)) {
        const ring = kerfArcSource?.[index]?.points ?? points;
        closedForKerf.push({ polyline: { points: ring, closed: true }, points: placed });
      } else {
        // Enforce the CutSegment invariant "a closed segment's last point
        // equals its first" so the emitter (which walks points and ignores the
        // `closed` flag) draws the closing edge. DXF entities drop the seam
        // vertex, which otherwise left the final edge uncut.
        const segment = {
          polyline: withClosingPoint(points, polyline.closed),
          closed: polyline.closed,
        };
        const known = polyline.closed ? nesting(index) : undefined;
        pushLineSegment(
          out,
          withArcs(index, known === undefined ? segment : { ...segment, nesting: known }),
          placed,
        );
      }
    }
    if (closedForKerf.length > 0) {
      out.kerf.push({ insertAt: out.segments.length, sources: closedForKerf });
    }
  }
}

function pushLineSegment(
  out: LineSegmentSink,
  segment: CutSegment,
  placedTabs: ReadonlyArray<Vec2>,
): void {
  if (placedTabs.length > 0) out.placedTabs.set(out.segments.length, placedTabs);
  out.segments.push(segment);
}

function shouldApplyKerf(polyline: Polyline, layer: Layer): boolean {
  return layer.mode === 'line' && layer.kerfOffsetMm !== 0 && polyline.closed;
}
