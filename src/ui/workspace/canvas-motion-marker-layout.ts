import type { Vec2 } from '../../core/scene';

export type StartMarkerKind = 'frame' | 'job';
export type MarkerBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};
export type StartMarkerLabel = {
  readonly kind: StartMarkerKind;
  readonly label: string;
  /** Exact planned point in screen pixels. Label placement never changes it. */
  readonly anchor: Vec2;
  readonly width: number;
  readonly height: number;
};
export type PlacedStartMarker = StartMarkerLabel & { readonly box: MarkerBox };

const GAP = 14;
const LABEL_GAP = 6;
const ANCHOR_CLEARANCE = 10;
const CANDIDATE_OBSTACLE_LIMIT = 12;
type PlacementScore = readonly [markerOverlap: number, artworkOverlap: number, distance: number];

/** Screen-space layout: a zoom changes the anchors, never the label/glyph sizes. */
export function layoutCanvasStartLabels(
  markers: ReadonlyArray<StartMarkerLabel>,
  bounds: MarkerBox,
  artwork: ReadonlyArray<MarkerBox> = [],
): ReadonlyArray<PlacedStartMarker> {
  const placed: PlacedStartMarker[] = [];
  const visibleArtwork = artwork.filter((box) => overlapArea(box, bounds) > 0);
  const artworkExtent = unionBoxes(visibleArtwork);
  const anchors = markers.map(({ anchor }) => ({
    x: anchor.x - ANCHOR_CLEARANCE,
    y: anchor.y - ANCHOR_CLEARANCE,
    width: ANCHOR_CLEARANCE * 2,
    height: ANCHOR_CLEARANCE * 2,
  }));
  for (const marker of markers) {
    const occupied = placed.map(({ box }) => expandBox(box, LABEL_GAP));
    const nearby = nearbyObstacles(marker.anchor, visibleArtwork);
    // The extent proposes exterior blank space even for a dense cluster. It is
    // not scored as occupied: genuine gaps between artwork remain usable.
    const candidates = labelCandidates(marker, [
      ...occupied,
      ...nearby,
      ...(artworkExtent === null ? [] : [artworkExtent]),
    ]);
    let best: MarkerBox | null = null;
    let bestScore: PlacementScore = [Infinity, Infinity, Infinity];
    for (const candidate of candidates) {
      const box = clampBox({ ...candidate, width: marker.width, height: marker.height }, bounds);
      const end = markerLeaderEnd(marker.anchor, box);
      const distance = (end.x - marker.anchor.x) ** 2 + (end.y - marker.anchor.y) ** 2;
      // Names/glyphs remain distinct even when a crowded viewport has no blank
      // area. Otherwise zero artwork overlap always wins over a shorter leader.
      const score: PlacementScore = [
        overlapTotal(box, [...anchors, ...occupied]),
        overlapTotal(box, visibleArtwork),
        distance,
      ];
      if (!betterScore(score, bestScore)) continue;
      best = box;
      bestScore = score;
    }
    if (best !== null) placed.push({ ...marker, box: best });
  }
  return placed;
}

function nearbyObstacles(anchor: Vec2, artwork: ReadonlyArray<MarkerBox>): MarkerBox[] {
  return artwork
    .map((box) => {
      const end = markerLeaderEnd(anchor, box);
      return { box, distance: Math.hypot(end.x - anchor.x, end.y - anchor.y) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, CANDIDATE_OBSTACLE_LIMIT)
    .map(({ box }) => box);
}

function unionBoxes(boxes: ReadonlyArray<MarkerBox>): MarkerBox | null {
  if (boxes.length < 2) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function overlapTotal(box: MarkerBox, obstacles: ReadonlyArray<MarkerBox>): number {
  return obstacles.reduce((area, obstacle) => area + overlapArea(box, obstacle), 0);
}

function betterScore(score: PlacementScore, best: PlacementScore): boolean {
  for (let i = 0; i < score.length; i += 1) {
    if (score[i] !== best[i]) return (score[i] ?? Infinity) < (best[i] ?? Infinity);
  }
  return false;
}

function labelCandidates(marker: StartMarkerLabel, occupied: ReadonlyArray<MarkerBox>): Vec2[] {
  const { anchor, width, height } = marker;
  const above = anchor.y - GAP - height;
  const below = anchor.y + GAP;
  const right = anchor.x + GAP;
  const left = anchor.x - GAP - width;
  const ys = marker.kind === 'frame' ? [above, below] : [below, above];
  const candidates = ys.flatMap((y) => [
    { x: right, y },
    { x: left, y },
  ]);
  candidates.push(
    { x: right, y: anchor.y - height / 2 },
    { x: left, y: anchor.y - height / 2 },
    { x: anchor.x - width / 2, y: above },
    { x: anchor.x - width / 2, y: below },
  );
  for (const box of occupied) {
    candidates.push(
      { x: box.x, y: box.y - height },
      { x: box.x, y: box.y + box.height },
      { x: box.x - width, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: anchor.x - width / 2, y: box.y - height },
      { x: anchor.x - width / 2, y: box.y + box.height },
      { x: box.x - width, y: anchor.y - height / 2 },
      { x: box.x + box.width, y: anchor.y - height / 2 },
    );
  }
  return candidates;
}

/** A leader ends on the plate edge; the other end stays on the exact anchor. */
export function markerLeaderEnd(anchor: Vec2, box: MarkerBox): Vec2 {
  return {
    x: clamp(anchor.x, box.x, box.x + box.width),
    y: clamp(anchor.y, box.y, box.y + box.height),
  };
}

function clampBox(box: MarkerBox, bounds: MarkerBox): MarkerBox {
  return {
    ...box,
    x: clamp(box.x, bounds.x, Math.max(bounds.x, bounds.x + bounds.width - box.width)),
    y: clamp(box.y, bounds.y, Math.max(bounds.y, bounds.y + bounds.height - box.height)),
  };
}

function expandBox(box: MarkerBox, amount: number): MarkerBox {
  return {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}

function overlapArea(a: MarkerBox, b: MarkerBox): number {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
