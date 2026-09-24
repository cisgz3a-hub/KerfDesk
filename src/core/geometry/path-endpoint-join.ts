import { curveEndpointJoin, type CurveSubpath, type PathSegment, type Vec2 } from '../scene';

export type JoinableCurve = {
  readonly curve: CurveSubpath;
  readonly signature: string;
  readonly protected?: boolean;
};

export type EndpointJoinResult = {
  /** Index of the earliest source curve -> replacement. Other consumed curves -> null. */
  readonly replacements: ReadonlyMap<number, CurveSubpath | null>;
  readonly joins: number;
  readonly closures: number;
  readonly ambiguousEndpoints: number;
};

type Endpoint = { readonly curve: number; readonly end: 0 | 1; readonly point: Vec2 };

/** Connect only mutual, unique neighbours in physical millimetres. Discover
 * pairs before editing so a T-junction never depends on source/click order. */
export function joinCurveEndpointsWithin(
  curves: ReadonlyArray<JoinableCurve>,
  toleranceMm: number,
): EndpointJoinResult {
  const endpoints = curves.flatMap(({ curve }, index): Endpoint[] => [
    { curve: index, end: 0, point: curve.start },
    { curve: index, end: 1, point: curve.segments.at(-1)?.to ?? curve.start },
  ]);
  const { links, ambiguousEndpoints } = endpointLinks(curves, endpoints, toleranceMm);
  const replacements = new Map<number, CurveSubpath | null>();
  let joins = 0;
  let closures = 0;
  const visited = new Set<number>();
  for (let index = 0; index < curves.length; index += 1) {
    if (visited.has(index) || (!links.has(index * 2) && !links.has(index * 2 + 1))) continue;
    const component = connectedCurves(index, links);
    for (const member of component) visited.add(member);
    const free = component
      .flatMap((member) => [member * 2, member * 2 + 1])
      .find((id) => !links.has(id));
    const firstEndpoint = free ?? index * 2;
    const result = assembleChain(curves, links, firstEndpoint, free === undefined);
    if (result === null) continue;
    const leader = component[0] ?? index;
    for (const member of component) replacements.set(member, member === leader ? result : null);
    joins += component.length - 1;
    if (free === undefined) closures += 1;
  }
  return { replacements, joins, closures, ambiguousEndpoints };
}

function endpointLinks(
  curves: ReadonlyArray<JoinableCurve>,
  endpoints: ReadonlyArray<Endpoint>,
  toleranceMm: number,
): { readonly links: ReadonlyMap<number, number>; readonly ambiguousEndpoints: number } {
  const radius = Math.max(toleranceMm, 1e-9);
  const grid = new Map<string, number[]>();
  endpoints.forEach((endpoint, index) => {
    const key = gridKey(curves[endpoint.curve]?.signature ?? '', endpoint.point, radius);
    const bucket = grid.get(key);
    if (bucket === undefined) grid.set(key, [index]);
    else bucket.push(index);
  });
  let ambiguousEndpoints = 0;
  const candidates = endpoints.map((endpoint, index) => {
    const found = nearbyEndpoints(endpoint, index, curves, endpoints, grid, radius);
    if (found.length > 1) ambiguousEndpoints += 1;
    return found.length === 1 ? found[0] : undefined;
  });
  const links = new Map<number, number>();
  candidates.forEach((other, index) => {
    if (
      other !== undefined &&
      candidates[other] === index &&
      curves[Math.floor(index / 2)]?.protected !== true &&
      curves[Math.floor(other / 2)]?.protected !== true
    )
      links.set(index, other);
  });
  return { links, ambiguousEndpoints };
}

function nearbyEndpoints(
  endpoint: Endpoint,
  index: number,
  curves: ReadonlyArray<JoinableCurve>,
  endpoints: ReadonlyArray<Endpoint>,
  grid: ReadonlyMap<string, ReadonlyArray<number>>,
  radius: number,
): number[] {
  const found: number[] = [];
  const own = curves[endpoint.curve];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const key = `${own?.signature ?? ''}:${Math.floor(endpoint.point.x / radius) + dx}:${Math.floor(endpoint.point.y / radius) + dy}`;
      for (const otherIndex of grid.get(key) ?? []) {
        if (otherIndex === index || !canPair(endpoint, endpoints[otherIndex], own, radius))
          continue;
        found.push(otherIndex);
        if (found.length === 2) return found;
      }
    }
  }
  return found;
}

function canPair(
  endpoint: Endpoint,
  other: Endpoint | undefined,
  own: JoinableCurve | undefined,
  radius: number,
): boolean {
  if (other === undefined) return false;
  // A lone line must not become a two-point closed contour.
  if (other.curve === endpoint.curve && (own?.curve.segments.length ?? 0) < 2) return false;
  return Math.hypot(other.point.x - endpoint.point.x, other.point.y - endpoint.point.y) <= radius;
}

function gridKey(signature: string, point: Vec2, radius: number): string {
  return `${signature}:${Math.floor(point.x / radius)}:${Math.floor(point.y / radius)}`;
}

function connectedCurves(start: number, links: ReadonlyMap<number, number>): number[] {
  const found = new Set([start]);
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop() as number;
    for (const endpoint of [current * 2, current * 2 + 1]) {
      const linked = links.get(endpoint);
      if (linked === undefined) continue;
      const next = Math.floor(linked / 2);
      if (found.has(next)) continue;
      found.add(next);
      pending.push(next);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function assembleChain(
  curves: ReadonlyArray<JoinableCurve>,
  links: ReadonlyMap<number, number>,
  firstEndpoint: number,
  closed: boolean,
): CurveSubpath | null {
  let entry = firstEndpoint;
  let curve = enteredCurve(curves, entry);
  if (curve === undefined) return null;
  const start = curve.start;
  let end = start;
  const segments: PathSegment[] = [];
  const visited = new Set<number>();
  while (true) {
    end = appendCurve(curve, segments, end);
    visited.add(Math.floor(entry / 2));
    const next = links.get(entry ^ 1);
    if (next === undefined || visited.has(Math.floor(next / 2))) break;
    entry = next;
    curve = enteredCurve(curves, entry);
    if (curve === undefined) return null;
  }
  const result: CurveSubpath = { start, segments, closed: false };
  if (!closed) return result;
  const closing = curveEndpointJoin.close(result, 0, result.segments.length);
  return closing.kind === 'ok' ? closing.curve : null;
}

function enteredCurve(
  curves: ReadonlyArray<JoinableCurve>,
  endpoint: number,
): CurveSubpath | undefined {
  const original = curves[Math.floor(endpoint / 2)]?.curve;
  if (original === undefined) return undefined;
  return endpoint % 2 === 0 ? original : curveEndpointJoin.reverse(original);
}

function appendCurve(curve: CurveSubpath, segments: PathSegment[], end: Vec2): Vec2 {
  if (Math.hypot(end.x - curve.start.x, end.y - curve.start.y) > 1e-9) {
    segments.push({ kind: 'line', to: curve.start });
  }
  for (const segment of curve.segments) segments.push(segment);
  return curve.segments.at(-1)?.to ?? curve.start;
}
