import { type DeviceProfile, toMachineCoords } from '../devices';
import {
  applyTransform,
  assertNever,
  type ColoredPath,
  type Layer,
  pathUsesOperation,
  type Polyline,
  type SceneObject,
  type Vec2,
  withClosingPoint,
} from '../scene';
import { segmentNesting } from './cut-segment-nesting';
import { compilationPolylines } from './compilation-polylines';
import { laserArcFitFor } from './cut-arc-moves';
import type { CutSegment, CutTopologyRing, JobDiagnostic } from './job';
import { placedTabPointsForContour } from './laser-tab-anchors';
import { kerfArcSourceRings, type KerfSource, type PendingKerfGroup } from './layer-kerf';
import { laserLeadSourceKey } from './laser-lead-sides';

export type LineSegmentCollection = {
  readonly segments: ReadonlyArray<CutSegment>;
  readonly tabSpans: ReadonlyArray<CutSegment>;
  readonly kerfDiagnostics: ReadonlyArray<JobDiagnostic>;
  /** Closed contours split at tabs (ADR-494); laser leads skip them. */
  readonly tabbedContours?: number;
  /** Closed contours perforation cut into dashes; laser leads skip them. */
  readonly perforatedContours?: number;
  /** Whole outlines of the contours tabs or perforation split (ADR-626). */
  readonly topologyRings?: ReadonlyArray<CutTopologyRing>;
};

// Line segments as collected, with the machine-space centres of any tabs
// placed by hand on each, keyed by segment index (ADR-494), and the closed
// contours still waiting for the layer-wide kerf offset (ADR-486).
export type LineSegmentSink = {
  readonly segments: CutSegment[];
  readonly placedTabs: Map<number, ReadonlyArray<Vec2>>;
  readonly kerf: PendingKerfGroup[];
};

/** `leadSources`: stamp each closed contour with the scene contour it comes
 * from (CutSegment.leadSource), for laser leads (ADR-626 Amd 1). */
export function collectLineSourcesForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  leadSources = false,
): LineSegmentSink {
  const out: LineSegmentSink = { segments: [], placedTabs: new Map(), kerf: [] };
  for (const obj of objects) appendSegmentsFromObject(obj, layer, device, out, leadSources);
  return out;
}

function appendSegmentsFromObject(
  obj: SceneObject,
  layer: Layer,
  device: DeviceProfile,
  out: LineSegmentSink,
  leadSources: boolean,
): void {
  // Exhaustive over SceneObject.kind — enforced by
  // `@typescript-eslint/switch-exhaustiveness-check`. The default arm's
  // assertNever turns missing arms into compile errors when a new
  // variant lands (per ADR-014).
  switch (obj.kind) {
    case 'imported-svg':
      return appendPathSegments(obj, layer, device, out, leadSources);
    case 'text':
      return appendPathSegments(obj, layer, device, out, leadSources);
    case 'traced-image':
      return appendPathSegments(obj, layer, device, out, leadSources);
    case 'shape':
      return appendPathSegments(obj, layer, device, out, leadSources);
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
  leadSources: boolean,
): void {
  for (const [pathIndex, path] of object.paths.entries()) {
    if (!pathUsesOperation(object, path, layer)) continue;
    const closedForKerf: KerfSource[] = [];
    const withArcs = laserArcFitFor(path, object.transform, device);
    const nesting = segmentNesting(path, `${object.id}#${pathIndex}`);
    const kerfArcSource = kerfArcSourceRings(path, object.transform, layer, device);
    for (const [index, polyline] of compilationPolylines(path, object.transform).entries()) {
      const sceneContour = laserLeadSourceKey(object.id, pathIndex, index);
      const source = leadSourceOf(leadSources, polyline, sceneContour);
      const points: Vec2[] = polyline.points.map((p) =>
        toMachineCoords(applyTransform(p, object.transform), device),
      );
      // ADR-494: tabs placed by hand, looked up only while tabs are on.
      const placed = layer.tabsEnabled
        ? placedTabPointsForContour(object, pathIndex, index, device)
        : [];
      if (shouldApplyKerf(polyline, layer)) {
        const ring = kerfArcSource?.[index]?.points ?? points;
        const known = nesting(index);
        closedForKerf.push({
          polyline: { points: ring, closed: true },
          points: placed,
          ...(known === undefined ? {} : { nesting: known }),
          ...source,
          sceneContour,
        });
      } else {
        const segment = sourceLineSegment(
          polyline,
          points,
          polyline.closed ? nesting(index) : undefined,
        );
        pushLineSegment(out, { ...withArcs(index, segment), ...source }, placed);
      }
    }
    if (closedForKerf.length > 0) {
      out.kerf.push({ insertAt: out.segments.length, sources: closedForKerf });
    }
  }
}

// ADR-626 Amd 1: the scene contour a closed contour comes from, for leads.
function leadSourceOf(
  wanted: boolean,
  polyline: Polyline,
  key: string,
): Pick<CutSegment, 'leadSource'> {
  return wanted && polyline.closed ? { leadSource: key } : {};
}

// Closed output repeats its first point: emitters walk the coordinates and
// DXF/source contours may omit that seam vertex.
function sourceLineSegment(
  polyline: Polyline,
  points: ReadonlyArray<Vec2>,
  nesting: CutSegment['nesting'],
): CutSegment {
  const segment = { polyline: withClosingPoint(points, polyline.closed), closed: polyline.closed };
  return nesting === undefined ? segment : { ...segment, nesting };
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
