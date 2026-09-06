type ConstituentIntersection = {
  readonly x: number;
  readonly windingDelta: number;
  readonly group: number;
};

const INTERSECTION_EPS_MM = 1e-6;

/** Resolve nonzero winding within each text object, then XOR the constituent
 * regions. Group zero holds the ordinary vector contours under the base rule.
 * Work in the original scanline doubles; no polygon quantisation is needed. */
export function composedFillSpans(
  intersections: ConstituentIntersection[],
  baseRule: 'evenodd' | 'nonzero',
): Array<readonly [number, number]> {
  intersections.sort((a, b) => a.x - b.x);
  const winding = new Map<number, number>();
  const spans: Array<readonly [number, number]> = [];
  let parity = 0;
  let start = 0;
  for (let i = 0; i < intersections.length; ) {
    const first = intersections[i];
    if (first === undefined) break;
    const previousParity = parity;
    while (i < intersections.length) {
      const event = intersections[i];
      if (event === undefined || Math.abs(event.x - first.x) >= INTERSECTION_EPS_MM) break;
      const previous = winding.get(event.group) ?? 0;
      const next = previous + event.windingDelta;
      const evenOdd = event.group === 0 && baseRule === 'evenodd';
      if (isInside(previous, evenOdd) !== isInside(next, evenOdd)) parity ^= 1;
      winding.set(event.group, next);
      i += 1;
    }
    if (parity === previousParity) continue;
    if (parity === 1) start = first.x;
    else if (first.x - start >= INTERSECTION_EPS_MM) spans.push([start, first.x]);
  }
  return spans;
}

function isInside(winding: number, evenOdd: boolean): boolean {
  return evenOdd ? winding % 2 !== 0 : winding !== 0;
}
