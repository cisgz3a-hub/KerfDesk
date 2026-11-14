// Whole-run source parity and surviving output topology precede process-local extras.
import type { DeviceProfile } from '../devices';
import { artworkOperationName, type Polyline, type SceneObject } from '../scene';
import { collectLineSourcesForLayer, type LineSegmentCollection } from './collect-line-segments';
import type { CutSegment, CutTopologyRing, JobDiagnostic } from './job';
import type { KerfSceneSides } from './kerf-scene-sides';
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

/** The scene's kerf sides (ADR-486 Amd 3) and the operation being compiled. */
export type KerfSidesFor = {
  readonly operationId: string;
  readonly sides: () => KerfSceneSides;
};

type Collected = {
  readonly bucket: VectorProcessBucket;
  readonly source: ReturnType<typeof collectLineSourcesForLayer>;
};

export function lineTopologyCollections(
  buckets: ReadonlyArray<VectorProcessBucket>,
  device: DeviceProfile,
  scope: string,
  keepLeadRings = false,
  kerfSides?: KerfSidesFor,
): ReadonlyMap<VectorProcessBucket, LineSegmentCollection> {
  const collected = buckets.map((bucket) => ({
    bucket,
    source: collectLineSourcesForLayer(bucket.objects, bucket.layer, device, keepLeadRings),
  }));
  const { context, assumed } = kerfContext(collected, kerfSides);
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
      kerfDiagnostics: [
        ...layerKerfDiagnostics(line, bucket.layer, sceneContourNamer(bucket.objects)),
        ...assumedSideDiagnostics(assumed.get(bucket), bucket),
      ],
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
    if (!segment.closed || contour === undefined || whole.has(contour)) return [];
    const ring = { forest, contour, polyline: segment.polyline };
    return [segment.leadSource === undefined ? ring : { ...ring, leadSource: segment.leadSource }];
  });
}

// Each kerf contour's depth: among the scene's part edges when the scene knows
// its contour (kerf-scene-sides.ts, ADR-486 Amd 3), so a hole on its own
// operation, or selected alone, is still a hole; otherwise among this run's
// closed contours, as before. Its own path's depth is this run's either way.
function kerfContext(
  collected: ReadonlyArray<Collected>,
  kerfSides: KerfSidesFor | undefined,
): {
  readonly context: ReadonlyMap<Polyline, KerfContextDepth>;
  readonly assumed: ReadonlyMap<VectorProcessBucket, ReadonlyMap<string, number>>;
} {
  const context = new Map<Polyline, KerfContextDepth>();
  const assumed = new Map<VectorProcessBucket, Map<string, number>>();
  if (!collected.some(({ source }) => source.kerf.length > 0)) return { context, assumed };
  const sides = kerfSides?.sides();
  let runDepths: number[] | undefined;
  const runDepth = (index: number): number => {
    runDepths ??= properContourDepths(
      collected.flatMap(({ source }) => [
        ...source.kerf.flatMap((path) => path.sources.map(asContour)),
        ...source.segments.filter((segment) => segment.closed),
      ]),
    );
    return runDepths[index] ?? 0;
  };
  let cursor = 0;
  for (const { bucket, source } of collected) {
    for (const path of source.kerf) {
      const own = properContourDepths(path.sources.map(asContour));
      path.sources.forEach((ring, index) => {
        const at = cursor++;
        const ownDepth = own[index] ?? 0;
        const holders =
          sides === undefined || kerfSides === undefined || ring.sceneContour === undefined
            ? undefined
            : sides(ring.sceneContour, kerfSides.operationId);
        if (holders === undefined) {
          const total = runDepth(at);
          context.set(ring.polyline, { total, outside: total - ownDepth });
          return;
        }
        context.set(ring.polyline, {
          total: ownDepth + holders.outside,
          outside: holders.outside,
        });
        if (holders.assumedAround === undefined) return;
        const counts = assumed.get(bucket) ?? new Map<string, number>();
        counts.set(holders.assumedAround, (counts.get(holders.assumedAround) ?? 0) + 1);
        assumed.set(bucket, counts);
      });
    }
    cursor += source.segments.filter((segment) => segment.closed).length;
  }
  return { context, assumed };
}

// ADR-486 Amd 3: kerf contours inside a closed shape that was not read as a
// part edge, so Job Review can say what the offset assumed.
function assumedSideDiagnostics(
  counts: ReadonlyMap<string, number> | undefined,
  bucket: VectorProcessBucket,
): JobDiagnostic[] {
  return [...(counts ?? [])].map(([aroundName, count]) => ({
    kind: 'kerf-side-assumed',
    layerId: bucket.layer.id,
    layerName: bucket.layer.name,
    count,
    aroundName,
    kerfOffsetMm: bucket.layer.kerfOffsetMm,
  }));
}

// ADR-486 Amd 5: a scene contour key (laserLeadSourceKey) names its object as
// the Layers panel does.
function sceneContourNamer(
  objects: ReadonlyArray<SceneObject>,
): (key: string | undefined) => string {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return (key) => {
    const object = key === undefined ? undefined : byId.get(key.slice(0, key.lastIndexOf('#')));
    return object === undefined ? '' : artworkOperationName(object);
  };
}

function asContour(source: KerfSource): CutSegment {
  return {
    polyline: source.polyline.points,
    closed: true,
    ...(source.nesting === undefined ? {} : { nesting: source.nesting }),
  };
}
