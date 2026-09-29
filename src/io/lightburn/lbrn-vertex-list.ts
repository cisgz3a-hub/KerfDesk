import type { Vec2 } from '../../core/scene';

// A LightBurn 2 <VertList> runs vertices together as `V<x> <y>` followed by
// optional Bezier handles, all in the shape's local coordinates:
//   c0x / c0y  the handle the curve LEAVES this vertex along (outgoing);
//   c1x / c1y  the handle the curve ARRIVES at this vertex along (incoming).
// A `B<i> <j>` primitive is the cubic V[i] -> V[i].c0 -> V[j].c1 -> V[j].
// LightBurn omits a handle coordinate that is zero, so `c0x-2.24` alone is the
// handle (-2.24, 0) and `c1y2.24` alone is (0, 2.24). A handle written as a
// bare `x1` (`c0x1`, `c1x1`) is LightBurn's "no handle here" marker. The real
// LightBurn 2.0.05 fixtures in src/__fixtures__/lightburn/external/lbrn show
// all three forms: their circles and fillets only come out as true arcs this
// way.

export type LbrnVertex = {
  readonly point: Vec2;
  /** `c0`: where a curve leaving this vertex heads first. */
  readonly outgoing?: Vec2;
  /** `c1`: where a curve arriving at this vertex comes from. */
  readonly incoming?: Vec2;
};

const NUMBER = String.raw`-?(?:\d+\.?\d*|\.\d+)`;
const VERTEX_PATTERN = new RegExp(String.raw`V(${NUMBER})\s+(${NUMBER})([\s\S]*?)(?=V|$)`, 'g');

export function parseLbrnVertexList(text: string): LbrnVertex[] {
  const vertices: LbrnVertex[] = [];
  for (const match of text.matchAll(VERTEX_PATTERN)) {
    const handles = match[3] ?? '';
    const outgoing = handlePoint(handles, '0');
    const incoming = handlePoint(handles, '1');
    vertices.push({
      point: { x: Number(match[1]), y: Number(match[2]) },
      ...(outgoing === null ? {} : { outgoing }),
      ...(incoming === null ? {} : { incoming }),
    });
  }
  return vertices;
}

function handlePoint(handles: string, which: '0' | '1'): Vec2 | null {
  const x = new RegExp(String.raw`c${which}x(${NUMBER})`).exec(handles)?.[1];
  const y = new RegExp(String.raw`c${which}y(${NUMBER})`).exec(handles)?.[1];
  if (x === undefined && y === undefined) return null;
  if (y === undefined && Number(x) === 1) return null;
  return { x: x === undefined ? 0 : Number(x), y: y === undefined ? 0 : Number(y) };
}
