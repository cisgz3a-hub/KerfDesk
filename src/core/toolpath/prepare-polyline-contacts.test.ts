import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { preparePolylineContacts } from './prepare-polyline-contacts';

describe('preparePolylineContacts', () => {
  it('sorts multiple interior attachments along a reversed receiver without mutation', () => {
    const receiver: Polyline = {
      closed: false,
      points: [
        { x: 10, y: 0 },
        { x: 0, y: 0 },
      ],
    };
    const contacts = [
      { x: 3, y: 0 },
      { x: 8, y: 0 },
    ];
    const branches = contacts.map((p) => ({ closed: false, points: [{ x: p.x, y: 5 }, p] }));
    const result = preparePolylineContacts([receiver, ...branches]);
    expect(receiver.points).toHaveLength(2);
    expect(result.polylines[0]?.points).toEqual([
      receiver.points[0],
      contacts[1],
      contacts[0],
      receiver.points[1],
    ]);
    expect(result.polylines[1]).toBe(branches[0]);
    for (const contact of contacts) expect(result.pinnedPoints.has(contact)).toBe(true);
    expect(result.polylines[0]?.points[1]).toBe(contacts[1]);
  });

  it('deduplicates coincident branch attachments and retains every owner pin', () => {
    const first = { x: 5, y: 0 },
      second = { x: 5, y: 0 };
    const result = preparePolylineContacts([
      {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
      { closed: false, points: [{ x: 5, y: 5 }, first] },
      { closed: false, points: [{ x: 5, y: -5 }, second] },
    ]);
    expect(result.polylines[0]?.points).toHaveLength(3);
    expect(result.pinnedPoints.has(first)).toBe(true);
    expect(result.pinnedPoints.has(second)).toBe(true);
  });

  it('handles an implicit ring closing edge and nonincident self-contact', () => {
    const ring: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const result = preparePolylineContacts([
      ring,
      {
        closed: false,
        points: [
          { x: -5, y: 5 },
          { x: 0, y: 5 },
        ],
      },
    ]);
    expect(result.polylines[0]?.points.at(-1)).toEqual({ x: 0, y: 5 });
    const self: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 5, y: 0 },
      ],
    };
    expect(preparePolylineContacts([self]).polylines[0]?.points[1]).toBe(self.points[3]);
  });

  it('does not turn ordinary adjacency, a ring seam or nearby strokes into pins', () => {
    const ring: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
      ],
    };
    const other: Polyline = {
      closed: false,
      points: [
        { x: 5, y: -5 },
        { x: 5, y: -1e-12 },
      ],
    };
    const result = preparePolylineContacts([ring, other]);
    expect(result.pinnedPoints.size).toBe(0);
    expect(result.polylines[0]).toBe(ring);
    expect(result.polylines[1]).toBe(other);
  });

  it('preserves empty, singleton and duplicate-point chains', () => {
    const inputs: Polyline[] = [
      { closed: false, points: [] },
      { closed: false, points: [{ x: 1, y: 1 }] },
      {
        closed: false,
        points: [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
      },
    ];
    expect(preparePolylineContacts(inputs).polylines).toEqual(inputs);
  });
});
