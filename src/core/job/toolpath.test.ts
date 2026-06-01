import { describe, expect, it } from 'vitest';
import type { Job } from './job';
import { buildToolpath, sliceToolpath } from './toolpath';

function aJob(): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#000',
        power: 30,
        speed: 1000,
        passes: 1,
        segments: [
          {
            polyline: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
            closed: false,
          },
          {
            polyline: [
              { x: 20, y: 0 },
              { x: 20, y: 5 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}

describe('buildToolpath', () => {
  it('returns cut + travel steps with cumulative lengths', () => {
    const tp = buildToolpath(aJob());
    expect(tp.steps.map((s) => s.kind)).toEqual(['cut', 'travel', 'cut']);
    // cut1 length=10, travel length=10, cut2 length=5 → total 25
    expect(tp.totalLength).toBe(25);
  });

  it('returns empty toolpath for an empty job', () => {
    expect(buildToolpath({ groups: [] })).toEqual({ steps: [], totalLength: 0 });
  });

  it('renders fill overscan as laser-off runway around the burn span', () => {
    const tp = buildToolpath({
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000',
          power: 30,
          speed: 1000,
          passes: 1,
          overscanMm: 2,
          segments: [
            {
              polyline: [
                { x: 10, y: 5 },
                { x: 20, y: 5 },
              ],
              closed: false,
            },
          ],
        },
      ],
    });

    expect(tp.steps.map((s) => s.kind)).toEqual(['travel', 'cut', 'travel']);
    expect(tp.totalLength).toBe(14);
    expect(tp.steps[0]).toMatchObject({
      kind: 'travel',
      from: { x: 8, y: 5 },
      to: { x: 10, y: 5 },
      length: 2,
    });
    expect(tp.steps[1]).toMatchObject({
      kind: 'cut',
      color: '#000',
      polyline: [
        { x: 10, y: 5 },
        { x: 20, y: 5 },
      ],
      length: 10,
    });
    expect(tp.steps[2]).toMatchObject({
      kind: 'travel',
      from: { x: 20, y: 5 },
      to: { x: 22, y: 5 },
      length: 2,
    });
  });
});

describe('sliceToolpath', () => {
  it('returns all steps when cut >= totalLength', () => {
    const tp = buildToolpath(aJob());
    const sliced = sliceToolpath(tp, 1000);
    expect(sliced.whole).toEqual(tp.steps);
    expect(sliced.partial).toBeNull();
    expect(sliced.head).toEqual({ x: 20, y: 5 });
  });

  it('returns empty steps when cut <= 0', () => {
    const tp = buildToolpath(aJob());
    const sliced = sliceToolpath(tp, 0);
    expect(sliced.whole).toEqual([]);
    expect(sliced.partial).toBeNull();
    expect(sliced.head).toEqual({ x: 0, y: 0 });
  });

  it('truncates a cut step mid-polyline', () => {
    const tp = buildToolpath(aJob());
    const sliced = sliceToolpath(tp, 5);
    expect(sliced.whole).toHaveLength(0);
    expect(sliced.partial?.kind).toBe('cut');
    if (sliced.partial?.kind === 'cut') {
      expect(sliced.partial.polyline).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ]);
    }
    expect(sliced.head).toEqual({ x: 5, y: 0 });
  });

  it('truncates a travel step mid-segment', () => {
    const tp = buildToolpath(aJob());
    // cut1 (10) + half of travel (5) = 15
    const sliced = sliceToolpath(tp, 15);
    expect(sliced.whole).toHaveLength(1);
    expect(sliced.partial?.kind).toBe('travel');
    if (sliced.partial?.kind === 'travel') {
      expect(sliced.partial.to).toEqual({ x: 15, y: 0 });
    }
  });
});
