// Whole-run source parity and surviving output topology precede process-local extras.
import type { DeviceProfile } from '../devices';
import type { Polyline } from '../scene';
import { collectLineSourcesForLayer, type LineSegmentCollection } from './collect-line-segments';
import type { CutSegment, CutTopologyRing } from './job';
import {
  layerKerfDiagnostics,
  withLayerKerf,
  type KerfContextDepth,
  type KerfSource,
} from './layer-kerf';
import { applyLineTabs } from './line-tabs';
import { perforateLineSegments } from './line-cut-extras';
import { properContourDepths } from './proper-contour-containment';
import type { VectorProcessBucket } from './vector-process-buckets';

export function lineTopologyCollections(
  buckets: ReadonlyArray<VectorProcessBucket>,
  device: DeviceProfile,
  scope: string,
  keepLeadRings = false,
): ReadonlyMap<VectorProcessBucket, LineSegmentCollection> {
  const collected = buckets.map((bucket) => ({
    bucket,
    source: collectLineSourcesForLayer(bucket.objects, bucket.layer, device),
  }));
  const all = collected.flatMap(({ source }) => [
    ...source.kerf.flatMap((path) => path.sources.map(asContour)),
    ...source.segments.filter((segment) => segment.closed),
  ]);
  const depths = properContourDepths(all);
  const context = new Map<Polyline, KerfContextDepth>();
  let cursor = 0;
  for (const { source } of collected) {
    for (const path of source.kerf) {
      const own = properContourDepths(path.sources.map(asContour));
      path.sources.forEach((ring, index) => {
        const total = depths[cursor++] ?? 0;
        context.set(ring.polyline, { total, outside: total - (own[index] ?? 0) });
      });
    }
    cursor += source.segments.filter((segment) => segment.closed).length;
  }
  const kerfed = collected.map(({ bucket, source }) => ({
    bucket,
    line: withLayerKerf(source, bucket.layer, device, context),
  }));
  const survivors = kerfed.flatMap(({ line }) => line.segments.filter((segment) => segment.closed));
  const survivingDepths = properContourDepths(survivors);
  let contour = 0;
  const result = new Map<VectorProcessBucket, LineSegmentCollection>();
  for (const { bucket, line } of kerfed) {
    const segments = line.segments.map((segment) => {
      if (!segment.closed) return segment;
      const index = contour++;
      return {
        ...segment,
        nesting: {
          forest: scope,
          depth: survivingDepths[index] ?? 0,
          topologyContour: String(index),
        },
      };
    });
    const tabbed = applyLineTabs(segments, line.placedTabs, bucket.layer);
    const output = perforateLineSegments(tabbed.segments, bucket.layer);
    const perforatedContours =
      output === tabbed.segments ? 0 : segments.filter((segment) => segment.closed).length;
    // Only a job with leads somewhere reads them (ADR-626); others never carry them.
    const topologyRings = keepLeadRings ? brokenContourRings(segments, output, scope) : [];
    result.set(bucket, {
      segments: output,
      tabSpans: tabbed.tabSpans,
      kerfDiagnostics: layerKerfDiagnostics(line, bucket.layer),
      ...(tabbed.tabbedContours === undefined ? {} : { tabbedContours: tabbed.tabbedContours }),
      ...(perforatedContours === 0 ? {} : { perforatedContours }),
      ...(topologyRings.length === 0 ? {} : { topologyRings }),
    });
  }
  return result;
}

// ADR-626: the whole outline of each contour tabs or perforation cut into
// pieces, so laser leads can tell which side of it is scrap and keep out of
// its uncut gaps without guessing it back from the pieces.
function brokenContourRings(
  before: ReadonlyArray<CutSegment>,
  after: ReadonlyArray<CutSegment>,
  forest: string,
): CutTopologyRing[] {
  const whole = new Set(
    after.flatMap((segment) =>
      segment.closed && segment.nesting?.topologyContour !== undefined
        ? [segment.nesting.topologyContour]
        : [],
    ),
  );
  return before.flatMap((segment) => {
    const contour = segment.nesting?.topologyContour;
    return segment.closed && contour !== undefined && !whole.has(contour)
      ? [{ forest, contour, polyline: segment.polyline }]
      : [];
  });
}

function asContour(source: KerfSource): CutSegment {
  return {
    polyline: source.polyline.points,
    closed: true,
    ...(source.nesting === undefined ? {} : { nesting: source.nesting }),
  };
}
