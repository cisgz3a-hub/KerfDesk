import { describe, expect, it } from 'vitest';
import type { Job, RasterGroup } from './job';
import { buildToolpath, sliceToolpath, summarizeToolpathDistances } from './toolpath';

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
        airAssist: false,
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

function rasterGroup(overrides: Partial<RasterGroup> = {}): RasterGroup {
  const pixelWidth = overrides.pixelWidth ?? 1;
  const pixelHeight = overrides.pixelHeight ?? 1;
  return {
    kind: 'raster',
    layerId: 'image',
    color: '#444444',
    power: 30,
    speed: 1000,
    passes: 1,
    airAssist: false,
    sValues: new Uint16Array(pixelWidth * pixelHeight).fill(500),
    pixelWidth,
    pixelHeight,
    bounds: { minX: 0, minY: 0, maxX: pixelWidth, maxY: pixelHeight },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
    ...overrides,
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
          airAssist: false,
          overscanMm: 2,
          segments: [
            {
              polyline: [
                { x: 10, y: 5 },
                { x: 20, y: 5 },
              ],
              closed: false,
              reverse: false,
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

  it('renders a multi-hole sweep as cut / gap-travel / cut steps (continuous sweep, ADR-034)', () => {
    const tp = buildToolpath({
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000',
          power: 30,
          speed: 1000,
          passes: 1,
          airAssist: false,
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 5, y: 0 },
              ],
              closed: false,
              reverse: false,
            },
            {
              polyline: [
                { x: 8, y: 0 },
                { x: 12, y: 0 },
              ],
              closed: false,
              reverse: false,
            },
            {
              polyline: [
                { x: 15, y: 0 },
                { x: 20, y: 0 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    });
    // One scanline, 3 ink spans / 2 holes: ink spans are cuts, the interior
    // holes are laser-off travels — the preview matches the emitted sweep.
    expect(tp.steps.map((s) => s.kind)).toEqual(['cut', 'travel', 'cut', 'travel', 'cut']);
    expect(tp.steps[1]).toMatchObject({
      kind: 'travel',
      from: { x: 5, y: 0 },
      to: { x: 8, y: 0 },
      length: 3,
    });
    expect(tp.steps[3]).toMatchObject({
      kind: 'travel',
      from: { x: 12, y: 0 },
      to: { x: 15, y: 0 },
      length: 3,
    });
    expect(tp.totalLength).toBe(20);
  });

  it('renders offset fill contours as normal contour cuts without overscan', () => {
    const offsetGroup = {
      kind: 'fill' as const,
      fillStyle: 'offset' as const,
      layerId: 'fill',
      color: '#000',
      power: 30,
      speed: 1000,
      passes: 1,
      airAssist: false,
      overscanMm: 2,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
            { x: 10, y: 10 },
          ],
          closed: true,
          reverse: false,
        },
      ],
    };
    const tp = buildToolpath({ groups: [offsetGroup] });

    expect(tp.steps.map((s) => s.kind)).toEqual(['cut']);
    expect(tp.totalLength).toBe(40);
  });

  it('renders raster image rows as route preview sweeps with overscan and bidirectional travel', () => {
    const tp = buildToolpath({
      groups: [
        rasterGroup({
          pixelWidth: 4,
          pixelHeight: 2,
          bounds: { minX: 10, minY: 20, maxX: 14, maxY: 22 },
          overscanMm: 1,
          sValues: new Uint16Array([0, 500, 500, 0, 0, 0, 500, 500]),
        }),
      ],
    });

    expect(tp.steps.map((step) => step.kind)).toEqual([
      'travel',
      'cut',
      'travel',
      'travel',
      'travel',
      'cut',
      'travel',
    ]);
    expect(tp.steps[0]).toMatchObject({
      kind: 'travel',
      from: { x: 10, y: 20.5 },
      to: { x: 11, y: 20.5 },
    });
    expect(tp.steps[1]).toMatchObject({
      kind: 'cut',
      color: '#444444',
      polyline: [
        { x: 11, y: 20.5 },
        { x: 13, y: 20.5 },
      ],
    });
    expect(tp.steps[4]).toMatchObject({
      kind: 'travel',
      from: { x: 15, y: 21.5 },
      to: { x: 14, y: 21.5 },
    });
    expect(tp.steps[5]).toMatchObject({
      kind: 'cut',
      color: '#444444',
      polyline: [
        { x: 14, y: 21.5 },
        { x: 12, y: 21.5 },
      ],
    });
  });
});

describe('summarizeToolpathDistances', () => {
  it('separates laser-on cut distance from laser-off travel distance', () => {
    const tp = buildToolpath(aJob());

    expect(summarizeToolpathDistances(tp)).toEqual({
      cutMm: 15,
      travelMm: 10,
      totalMm: 25,
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
