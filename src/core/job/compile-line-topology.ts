// Whole-run source parity and surviving output topology precede process-local extras.
import type { DeviceProfile } from '../devices';
import type { Polyline } from '../scene';
import { collectLineSourcesForLayer, type LineSegmentCollection } from './collect-line-segments';
import type { CutSegment } from './job';
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
    result.set(bucket, {
      segments: perforateLineSegments(tabbed.segments, bucket.layer),
      tabSpans: tabbed.tabSpans,
      kerfDiagnostics: layerKerfDiagnostics(line, bucket.layer),
    });
  }
  return result;
}

function asContour(source: KerfSource): CutSegment {
  return {
    polyline: source.polyline.points,
    closed: true,
    ...(source.nesting === undefined ? {} : { nesting: source.nesting }),
  };
}
