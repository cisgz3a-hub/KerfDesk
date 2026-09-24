import { describe, expect, it } from 'vitest';
import { CURRENT_POLYLINE_FAIRING_VERSION } from './create-polyline';
import {
  createPenPath,
  mirrorPenHandle,
  penNodeHandles,
  penNodesToCurve,
  type PenNode,
} from './pen-path';

const corner = (x: number, y: number): PenNode => ({ kind: 'corner', point: { x, y } });

describe('penNodesToCurve', () => {
  it('joins clicked corners with exact straight segments at the clicked points', () => {
    // Enough points that the old tracer fairing would have rounded them.
    const clicks = [corner(0, 0), corner(10, 0), corner(10, 10), corner(20, 10), corner(20, 0)];

    const curve = penNodesToCurve(clicks, false);

    expect(curve).toEqual({
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 10, y: 0 } },
        { kind: 'line', to: { x: 10, y: 10 } },
        { kind: 'line', to: { x: 20, y: 10 } },
        { kind: 'line', to: { x: 20, y: 0 } },
      ],
      closed: false,
    });
  });

  it('closes with an explicit segment back to the first node', () => {
    const curve = penNodesToCurve([corner(0, 0), corner(10, 0), corner(5, 8)], true);

    expect(curve?.closed).toBe(true);
    expect(curve?.segments.at(-1)).toEqual({ kind: 'line', to: { x: 0, y: 0 } });
    expect(curve?.segments).toHaveLength(3);
  });

  it('turns a dragged node into cubics with the dragged and mirrored handles', () => {
    const nodes: PenNode[] = [
      corner(0, 0),
      { kind: 'smooth', point: { x: 10, y: 0 }, handleOut: { x: 14, y: 3 } },
      corner(20, 0),
    ];

    const curve = penNodesToCurve(nodes, false);

    expect(curve?.segments).toEqual([
      { kind: 'cubic', control1: { x: 0, y: 0 }, control2: { x: 6, y: -3 }, to: { x: 10, y: 0 } },
      { kind: 'cubic', control1: { x: 14, y: 3 }, control2: { x: 20, y: 0 }, to: { x: 20, y: 0 } },
    ]);
  });

  it('keeps a straight segment between two corners next to a smooth node', () => {
    const nodes: PenNode[] = [
      { kind: 'smooth', point: { x: 0, y: 0 }, handleOut: { x: 0, y: 5 } },
      corner(10, 0),
      corner(20, 0),
    ];

    const segments = penNodesToCurve(nodes, false)?.segments;

    expect(segments?.[0]?.kind).toBe('cubic');
    expect(segments?.[1]).toEqual({ kind: 'line', to: { x: 20, y: 0 } });
  });

  it('bends both sides of an auto-smooth node along its neighbours', () => {
    const nodes: PenNode[] = [
      corner(0, 0),
      { kind: 'auto', point: { x: 10, y: 10 } },
      corner(20, 0),
    ];

    const [incoming, outgoing] = penNodesToCurve(nodes, false)?.segments ?? [];

    expect(incoming?.kind).toBe('cubic');
    expect(outgoing?.kind).toBe('cubic');
    if (incoming?.kind !== 'cubic' || outgoing?.kind !== 'cubic') return;
    // The tangent at the node is parallel to the chord between its neighbours.
    expect(incoming.control2.y).toBeCloseTo(10);
    expect(outgoing.control1.y).toBeCloseTo(10);
    expect(incoming.control2.x).toBeLessThan(10);
    expect(outgoing.control1.x).toBeGreaterThan(10);
  });

  it('leaves an auto-smooth open end without a handle', () => {
    const handles = penNodeHandles([{ kind: 'auto', point: { x: 0, y: 0 } }, corner(10, 0)], false);

    expect(handles[0]).toEqual({ handleIn: null, handleOut: null });
  });

  it('treats a zero-length drag as a corner', () => {
    const point = { x: 3, y: 4 };
    const handles = penNodeHandles([{ kind: 'smooth', point, handleOut: point }], false);

    expect(handles[0]).toEqual({ handleIn: null, handleOut: null });
  });
});

describe('mirrorPenHandle', () => {
  it('reflects the handle through its node', () => {
    expect(mirrorPenHandle({ x: 10, y: 10 }, { x: 13, y: 6 })).toEqual({ x: 7, y: 14 });
  });
});

describe('createPenPath', () => {
  it('stores the placed nodes and the exact curve, stamped against later fairing', () => {
    const nodes = [corner(2, 3), corner(12, 3), corner(12, 9), corner(2, 9)];

    const shape = createPenPath({ id: 'pen', color: '#ff0000', nodes, closed: false });

    expect(shape?.spec).toEqual({
      kind: 'polyline',
      points: nodes.map((node) => node.point),
      closed: false,
    });
    expect(shape?.fairingVersion).toBe(CURRENT_POLYLINE_FAIRING_VERSION);
    expect(shape?.bounds).toEqual({ minX: 2, minY: 3, maxX: 12, maxY: 9 });
    expect(shape?.paths[0]?.polylines[0]?.points).toEqual(nodes.map((node) => node.point));
    expect(shape?.paths[0]?.curves?.[0]?.segments.every((s) => s.kind === 'line')).toBe(true);
  });

  it('flattens a curved drawing within the machine tolerance', () => {
    const nodes: PenNode[] = [
      corner(0, 0),
      { kind: 'smooth', point: { x: 10, y: 0 }, handleOut: { x: 10, y: 8 } },
      corner(20, 0),
    ];

    const shape = createPenPath({ id: 'pen', color: '#000000', nodes, closed: false });
    const points = shape?.paths[0]?.polylines[0]?.points ?? [];

    expect(points.length).toBeGreaterThan(nodes.length);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 20, y: 0 });
    expect(shape?.bounds.maxY).toBeGreaterThan(0);
  });

  it('refuses an empty node list', () => {
    expect(createPenPath({ id: 'pen', color: '#000000', nodes: [], closed: false })).toBeNull();
  });
});
