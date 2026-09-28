import { describe, expect, it } from 'vitest';
import { applyAutomaticTabsToPolylines } from '../geometry/tabs-bridges';
import { createLayer, type Layer, type Polyline, type Vec2 } from '../scene';
import type { CutGroup, CutSegment } from './job';
import { applyLineTabs, lineTabSpanGroups } from './line-tabs';
import { tabCountForPerimeter, automaticTabLayoutFor } from './operation-cut-extras';

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
      { x, y },
    ],
  };
}

function segmentsOf(polylines: ReadonlyArray<Polyline>): ReadonlyArray<CutSegment> {
  return polylines.map((polyline) => ({ polyline: polyline.points, closed: polyline.closed }));
}

function layerWith(settings: Partial<Layer>): Layer {
  return {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    tabsEnabled: true,
    tabSizeMm: 1,
    tabsPerShape: 4,
    ...settings,
  };
}

const NO_PLACED = new Map<number, ReadonlyArray<Vec2>>();

function length(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

describe('laser Line tab layouts (ADR-494)', () => {
  const shapes: ReadonlyArray<Polyline> = [
    square(0, 0, 10),
    square(40, 0, 30),
    square(50, 10, 5),
    {
      closed: false,
      points: [
        { x: 0, y: 50 },
        { x: 20, y: 50 },
      ],
    },
    {
      closed: true,
      points: [
        { x: 90, y: 90 },
        { x: 90, y: 90 },
      ],
    },
  ];

  it.each([
    { tabsPerShape: 4, tabSizeMm: 1, tabSkipInnerShapes: false },
    { tabsPerShape: 3, tabSizeMm: 2.5, tabSkipInnerShapes: true },
    { tabsPerShape: 2.7, tabSizeMm: 0.5, tabSkipInnerShapes: false },
    { tabsPerShape: 1, tabSizeMm: 25, tabSkipInnerShapes: false },
  ])('splits by count exactly as the automatic tabs always have (%o)', (settings) => {
    const layer = layerWith(settings);
    const legacy = segmentsOf(applyAutomaticTabsToPolylines(shapes, layer));
    const tabbed = applyLineTabs(segmentsOf(shapes), NO_PLACED, layer);
    expect(tabbed.segments).toEqual(legacy);
    // The spacing fields do nothing until spacing is chosen.
    const counted = applyLineTabs(
      segmentsOf(shapes),
      NO_PLACED,
      layerWith({ ...settings, tabLayout: 'count', tabSpacingMm: 3, tabMaxPerShape: 2 }),
    );
    expect(counted.segments).toEqual(legacy);
  });

  it('leaves segments alone while tabs are off', () => {
    const segments = segmentsOf(shapes);
    const result = applyLineTabs(segments, NO_PLACED, layerWith({ tabsEnabled: false }));
    expect(result.segments).toBe(segments);
    expect(result.tabSpans).toEqual([]);
  });

  it('gives one tab per spacing length, at least one per shape', () => {
    const count = (perimeterMm: number, settings: Partial<Layer>): number =>
      tabCountForPerimeter(
        automaticTabLayoutFor(layerWith({ tabLayout: 'spacing', ...settings })),
        perimeterMm,
      );
    expect(count(40, { tabSpacingMm: 10 })).toBe(4);
    expect(count(40, { tabSpacingMm: 15 })).toBe(3);
    expect(count(40, { tabSpacingMm: 100 })).toBe(1);
    expect(count(120, {})).toBe(2);
    expect(count(40, { tabSpacingMm: 5 })).toBe(8);
    expect(count(40, { tabSpacingMm: 5, tabMaxPerShape: 6 })).toBe(6);
    expect(count(40, { tabSpacingMm: 5, tabMaxPerShape: 0 })).toBe(8);
  });

  it('spreads more tabs round a bigger shape in spacing mode', () => {
    const result = applyLineTabs(
      segmentsOf([square(0, 0, 10), square(40, 0, 30)]),
      NO_PLACED,
      layerWith({ tabLayout: 'spacing', tabSpacingMm: 10 }),
    );
    // 4 tabs on the 40 mm square and 12 on the 120 mm one: one burn and one span each.
    expect(result.segments).toHaveLength(16);
    expect(result.tabSpans).toHaveLength(16);
    for (const span of result.tabSpans) expect(length(span.polyline)).toBeCloseTo(1, 9);
  });

  it('caps the spacing count at the maximum per shape', () => {
    const result = applyLineTabs(
      segmentsOf([square(40, 0, 30)]),
      NO_PLACED,
      layerWith({ tabLayout: 'spacing', tabSpacingMm: 10, tabMaxPerShape: 6 }),
    );
    expect(result.segments).toHaveLength(6);
    expect(result.tabSpans).toHaveLength(6);
  });

  it('returns the tab spans as open pieces of the contour, joined across its start', () => {
    const result = applyLineTabs(
      segmentsOf([square(0, 0, 10)]),
      new Map([[0, [{ x: 0, y: 0 }]]]),
      layerWith({ tabSizeMm: 2 }),
    );
    expect(result.tabSpans).toHaveLength(1);
    expect(result.tabSpans[0]).toEqual({
      closed: false,
      polyline: [
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
    expect(result.segments).toHaveLength(1);
    expect(length(result.segments[0]!.polyline)).toBeCloseTo(38, 9);
  });

  it('puts placed tabs exactly where they were placed, even on a skipped hole', () => {
    const shapesWithHole = [square(0, 0, 30), square(10, 10, 10)];
    const result = applyLineTabs(
      segmentsOf(shapesWithHole),
      new Map([[1, [{ x: 15, y: 10 }]]]),
      layerWith({ tabSkipInnerShapes: true, tabsPerShape: 3 }),
    );
    // Outer: 3 automatic tabs. Hole: the one placed tab, where eligibility would skip it.
    expect(result.segments).toHaveLength(4);
    expect(result.tabSpans).toHaveLength(4);
    const holeSpan = result.tabSpans[3]!.polyline;
    expect(holeSpan[0]).toEqual({ x: 14.5, y: 10 });
    expect(holeSpan[holeSpan.length - 1]).toEqual({ x: 15.5, y: 10 });
  });

  it('keeps a shape the tab would swallow whole, as one tab span', () => {
    const shape = square(0, 0, 1);
    const result = applyLineTabs(segmentsOf([shape]), NO_PLACED, layerWith({ tabSizeMm: 5 }));
    expect(result.segments).toEqual([]);
    expect(result.tabSpans).toEqual(segmentsOf([shape]));
  });
});

describe('lineTabSpanGroups', () => {
  const cut: Omit<CutGroup, 'kind' | 'segments'> = {
    layerId: 'L1',
    color: '#ff0000',
    power: 50,
    speed: 600,
    passes: 2,
    airAssist: true,
    finalPassOvercutMm: 2,
  };
  const spans = segmentsOf([
    {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    },
  ]);

  it('adds no group while the tab power is 0 or unset', () => {
    expect(lineTabSpanGroups(cut, layerWith({}), spans)).toEqual([]);
    expect(lineTabSpanGroups(cut, layerWith({ tabCutPowerPercent: 0 }), spans)).toEqual([]);
    expect(lineTabSpanGroups(cut, layerWith({ tabCutPowerPercent: 20 }), [])).toEqual([]);
  });

  it('burns the spans at the tab share of the cut power, without overcut', () => {
    const [group] = lineTabSpanGroups(cut, layerWith({ tabCutPowerPercent: 20 }), spans);
    expect(group).toEqual({
      layerId: 'L1',
      color: '#ff0000',
      power: 10,
      speed: 600,
      passes: 2,
      airAssist: true,
      kind: 'cut',
      tabSpanPowerPercent: 20,
      segments: spans,
    });
  });

  it('never burns the tabs harder than the cut', () => {
    const [group] = lineTabSpanGroups(cut, layerWith({ tabCutPowerPercent: 250 }), spans);
    expect(group?.power).toBe(50);
    expect(group?.tabSpanPowerPercent).toBe(100);
  });
});
