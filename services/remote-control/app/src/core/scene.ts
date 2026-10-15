import type { Artwork, Bounds, Scene, SceneObject } from './types';

export type Point = { x: number; y: number };
export type Box = { minX: number; minY: number; maxX: number; maxY: number };
export type DecodedObject = {
  readonly source: SceneObject;
  readonly paths: {
    readonly color: string;
    readonly fill: boolean;
    readonly output: boolean;
    readonly d: string;
    readonly rings: { closed: boolean; points: Point[] }[];
  }[];
};

/** Inverse of the PC's "x,y dx,dy ..." encoding in hundredths of a millimetre. */
export function decodePoints(encoded: string): Point[] {
  const points: Point[] = [];
  let x = 0;
  let y = 0;
  for (const pair of encoded.split(' ')) {
    const comma = pair.indexOf(',');
    if (comma < 0) continue;
    x += Number(pair.slice(0, comma));
    y += Number(pair.slice(comma + 1));
    points.push({ x: x / 100, y: y / 100 });
  }
  return points;
}

export function decodeScene(scene: Scene | null): DecodedObject[] {
  if (scene?.status !== 'ready') return [];
  return (scene.objects ?? []).map((source) => ({
    source,
    paths: source.paths.map((path) => {
      const rings = path.polylines.map((polyline) => ({
        closed: polyline.closed,
        points: decodePoints(polyline.points),
      }));
      return {
        color: path.color,
        fill: path.fill,
        output: path.output,
        rings,
        d: rings.map((ring) => pathData(ring.points, ring.closed)).join(''),
      };
    }),
  }));
}

export function pathData(points: readonly Point[], closed: boolean): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points as [Point, ...Point[]];
  return `M${round(first.x)} ${round(first.y)}${rest.map((point) => `L${round(point.x)} ${round(point.y)}`).join('')}${closed ? 'Z' : ''}`;
}
const round = (value: number) => Math.round(value * 100) / 100;

export function toBox(bounds: Bounds): Box {
  return {
    minX: bounds.xMm,
    minY: bounds.yMm,
    maxX: bounds.xMm + bounds.widthMm,
    maxY: bounds.yMm + bounds.heightMm,
  };
}
export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

/** Artwork bounds from the always-available summary (works even when sharing is off). */
export function artworkBox(artwork: Artwork): Box | null {
  const bounds = artwork.transformBounds ?? artwork.bounds;
  return bounds === undefined ? null : toBox(bounds);
}

export function selectionBox(ids: readonly string[], artwork: readonly Artwork[]): Box | null {
  const wanted = new Set(ids);
  return unionBox(
    artwork.filter((item) => wanted.has(item.id)).flatMap((item) => artworkBox(item) ?? []),
  );
}

/** Whole persistent groups select together, matching the desktop. */
export function expandUnits(ids: readonly string[], scene: Scene | null): string[] {
  const objects = [...(scene?.objects ?? []), ...(scene?.images ?? [])];
  const units = new Set(objects.filter((item) => ids.includes(item.id)).map((item) => item.unitId));
  const expanded = objects.filter((item) => units.has(item.unitId)).map((item) => item.id);
  return [...new Set([...ids, ...expanded])];
}

/** Hidden and locked members never become a partial editable group. */
export function selectableIds(artwork: readonly Artwork[], scene: Scene | null): string[] {
  const members = [...(scene?.objects ?? []), ...(scene?.images ?? [])];
  const allowed = new Set(
    artwork
      .filter((item) => item.visible !== false && item.editable !== false)
      .map((item) => item.id),
  );
  const blockedUnits = new Set(
    members.filter((item) => !item.editable || !allowed.has(item.id)).map((item) => item.unitId),
  );
  for (const item of members) if (blockedUnits.has(item.unitId)) allowed.delete(item.id);
  return artwork.filter((item) => allowed.has(item.id)).map((item) => item.id);
}

export function selectUnits(
  ids: readonly string[],
  artwork: readonly Artwork[],
  scene: Scene | null,
): string[] {
  const allowed = new Set(selectableIds(artwork, scene));
  return expandUnits(
    ids.filter((id) => allowed.has(id)),
    scene,
  ).filter((id) => allowed.has(id));
}

/** Left-to-right encloses whole groups; right-to-left selects intersecting groups. */
export function marqueeSelection(
  start: Point,
  end: Point,
  artwork: readonly Artwork[],
  scene: Scene | null,
): string[] {
  const allowed = new Set(selectableIds(artwork, scene));
  const members = [...(scene?.objects ?? []), ...(scene?.images ?? [])];
  const units = new Map<string, Artwork[]>();
  for (const item of artwork) {
    if (!allowed.has(item.id)) continue;
    const key = members.find((member) => member.id === item.id)?.unitId ?? item.id;
    units.set(key, [...(units.get(key) ?? []), item]);
  }
  const area = {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
  return [...units.values()].flatMap((items) => {
    const box = unionBox(items.flatMap((item) => artworkBox(item) ?? []));
    if (box === null) return [];
    const contains =
      area.minX <= box.minX &&
      area.minY <= box.minY &&
      area.maxX >= box.maxX &&
      area.maxY >= box.maxY;
    return (end.x >= start.x ? contains : boxesIntersect(area, box))
      ? items.map((item) => item.id)
      : [];
  });
}

/** Topmost hit wins. Filled closed shapes hit inside; strokes hit within `tolerance` mm. */
export function hitTest(
  decoded: readonly DecodedObject[],
  scene: Scene | null,
  point: Point,
  tolerance: number,
): string | null {
  for (let index = decoded.length - 1; index >= 0; index -= 1) {
    const object = decoded[index] as DecodedObject;
    const box = toBox(object.source.bounds);
    if (
      point.x < box.minX - tolerance ||
      point.x > box.maxX + tolerance ||
      point.y < box.minY - tolerance ||
      point.y > box.maxY + tolerance
    )
      continue;
    for (const path of object.paths) {
      const closedRings = path.rings.filter((ring) => ring.closed);
      if (path.fill && closedRings.length > 0 && insideRings(point, closedRings))
        return object.source.id;
      for (const ring of path.rings) if (nearRing(point, ring, tolerance)) return object.source.id;
    }
  }
  for (const image of [...(scene?.images ?? [])].reverse()) {
    const corners: Point[] = [];
    for (let i = 0; i < 8; i += 2)
      corners.push({ x: image.corners[i] ?? 0, y: image.corners[i + 1] ?? 0 });
    if (insideRings(point, [{ points: corners }])) return image.id;
  }
  return null;
}

function insideRings(point: Point, rings: readonly { points: Point[] }[]): boolean {
  let inside = false;
  for (const ring of rings) {
    const pts = ring.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const a = pts[i] as Point;
      const b = pts[j] as Point;
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
  }
  return inside;
}
function nearRing(
  point: Point,
  ring: { closed: boolean; points: Point[] },
  tolerance: number,
): boolean {
  const pts = ring.points;
  const count = ring.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = pts[i] as Point;
    const b = pts[(i + 1) % pts.length] as Point;
    if (segmentDistance(point, a, b) <= tolerance) return true;
  }
  return false;
}
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Thin a freehand stroke to at most `limit` points, keeping the ends. */
export function thinStroke(points: readonly Point[], minGap: number, limit = 512): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last === undefined || Math.hypot(point.x - last.x, point.y - last.y) >= minGap)
      result.push(point);
  }
  const end = points[points.length - 1];
  if (end !== undefined && result[result.length - 1] !== end) result.push(end);
  if (result.length <= limit) return result;
  const step = (result.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => result[Math.round(index * step)] as Point);
}
