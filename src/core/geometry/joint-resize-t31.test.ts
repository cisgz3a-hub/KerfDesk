// Tools audit T31 (2026-11-13): Resize Joint Openings on placed tabs, cutouts,
// finger-jointed boxes and the tolerance edge. Every oracle is analytic: a tab
// placed on an edge the resize leaves alone stays where it was put, an opening
// widens about its centre, and every joint step of a converted box equals the
// new thickness.
import { describe, expect, it } from 'vitest';
import { analyseJointResize, previewJointResize, type JointResizeRequest } from './joint-resize';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Vec2 } from '../scene';
import { projectCncTabAnchor } from '../cnc/cnc-tab-anchors';
import { laserTabAnchorPosition } from '../job/laser-tab-anchors';
import { generateBox } from '../box/generate-box';
import type { BoxSpec } from '../box/box-spec';

const close = (points: ReadonlyArray<Vec2>) => ({ closed: true, points: [...points, points[0]!] });
function part(id: string, rings: ReadonlyArray<ReadonlyArray<Vec2>>, source = `${id}.svg`) {
  const all = rings.flat();
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id,
    name: `${id} part`,
    source,
    transform: IDENTITY_TRANSFORM,
    bounds: {
      minX: Math.min(...all.map((p) => p.x)),
      minY: Math.min(...all.map((p) => p.y)),
      maxX: Math.max(...all.map((p) => p.x)),
      maxY: Math.max(...all.map((p) => p.y)),
    },
    paths: [{ color: '#000000', operationIds: ['cut'], polylines: rings.map(close) }],
    operationIds: ['cut'],
  };
  return object;
}
function resizeAll(objects: ReadonlyArray<ImportedSvg>, request: JointResizeRequest) {
  const analysis = analyseJointResize(objects, request);
  if (analysis.kind !== 'ok') throw new Error(analysis.error.message);
  const ids = analysis.value.candidates.map((candidate) => candidate.id);
  const result = ids.length === 0 ? null : previewJointResize(objects, request, ids);
  if (result !== null && result.kind !== 'ok') throw new Error(result.error.message);
  const after = new Map((result?.value.objects ?? []).map((object) => [object.id, object]));
  return {
    analysis: analysis.value,
    movedTabs: result?.value.movedTabs ?? 0,
    ring: (id: string, index = 0): ReadonlyArray<Vec2> => {
      const object = (after.get(id) ?? objects.find((item) => item.id === id)) as ImportedSvg;
      return object.paths[0]!.polylines[index]!.points.slice(0, -1);
    },
    object: (id: string) => after.get(id) as ImportedSvg | undefined,
  };
}
const span = (points: ReadonlyArray<Vec2>, axis: 'x' | 'y') => {
  const values = points.map((point) => point[axis]);
  return [Math.min(...values), Math.max(...values)] as const;
};

describe('T31-P1-2: tabs placed by hand stay put when joints are resized', () => {
  // A 300 x 100 panel with 25 fingers, 6 wide and 3 deep, along its top edge.
  const outline: Vec2[] = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 100 },
  ];
  for (let i = 0; i < 25; i += 1) {
    const x = 297 - i * 12;
    outline.push({ x, y: 100 }, { x, y: 103 }, { x: x - 6, y: 103 }, { x: x - 6, y: 100 });
  }
  outline.push({ x: 0, y: 100 });
  const placed: Vec2[] = [
    { x: 150, y: 0 },
    { x: 300, y: 50 },
    { x: 0, y: 50 },
  ];
  function withTabs(points: ReadonlyArray<Vec2>): ImportedSvg {
    const object = part('panel', [outline]);
    const anchors = points.map((point) => {
      const anchor = projectCncTabAnchor(object, '#000000', point);
      if (anchor === null) throw new Error('tab off the outline');
      return anchor;
    });
    return { ...object, laserTabAnchors: anchors };
  }
  const request = {
    currentWidthMm: 3,
    materialThicknessMm: 4,
    fitAllowanceMm: 0.1,
    detectionToleranceMm: 0.05,
  };

  it('keeps every tab on an untouched edge exactly where it was placed (was 18.4 mm off)', () => {
    const source = withTabs(placed);
    const result = resizeAll([source], request);
    expect(result.analysis.candidates).toHaveLength(25);
    const resized = result.object('panel')!;
    expect(span(resized.paths[0]!.polylines[0]!.points, 'y')[1]).toBeCloseTo(104, 9);
    placed.forEach((point, index) => {
      const at = laserTabAnchorPosition(resized, resized.laserTabAnchors![index]!)!;
      expect(Math.hypot(at.x - point.x, at.y - point.y)).toBeLessThan(1e-6);
    });
    expect(result.movedTabs).toBe(0);
  });

  it('counts a tab on a finger tip as moved, onto the new tip', () => {
    const source = withTabs([{ x: 294, y: 103 }]);
    const result = resizeAll([source], request);
    const resized = result.object('panel')!;
    const at = laserTabAnchorPosition(resized, resized.laserTabAnchors![0]!)!;
    expect(at.x).toBeCloseTo(294, 6);
    expect(at.y).toBeCloseTo(104, 6);
    expect(result.movedTabs).toBe(1);
  });
});

describe('T31-P2-1: a cutout decides which side is material', () => {
  const plate: Vec2[] = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 60 },
    { x: 0, y: 60 },
  ];
  // A window 25..55 x 20..40 with a keyway cut up into the material at
  // x 38.5..41.5 (to y 43) and a material tooth up into the window at x 30..33.
  const window: Vec2[] = [
    { x: 25, y: 20 },
    { x: 30, y: 20 },
    { x: 30, y: 23 },
    { x: 33, y: 23 },
    { x: 33, y: 20 },
    { x: 55, y: 20 },
    { x: 55, y: 40 },
    { x: 41.5, y: 40 },
    { x: 41.5, y: 43 },
    { x: 38.5, y: 43 },
    { x: 38.5, y: 40 },
    { x: 25, y: 40 },
  ];
  const request = {
    currentWidthMm: 3,
    materialThicknessMm: 4,
    fitAllowanceMm: 0.2,
    detectionToleranceMm: 0.05,
  };

  for (const [winding, ring] of [
    ['same', window],
    ['opposite', [...window].reverse()],
  ] as const) {
    it(`widens a keyway and deepens a tooth on a cutout wound the ${winding} way`, () => {
      const result = resizeAll([part('plate', [plate, ring])], request);
      const kinds = result.analysis.candidates.map((c) => [c.kind, c.widthMm, c.depthMm]);
      expect(kinds).toEqual(
        expect.arrayContaining([
          ['inward-slot', expect.closeTo(3, 9), expect.closeTo(3, 9)],
          ['outward-tab', expect.closeTo(3, 9), expect.closeTo(3, 9)],
        ]),
      );
      expect(kinds).toHaveLength(2);
      const after = result.ring('plate', 1);
      const keyway = after.filter((point) => point.y > 40 + 1e-9);
      expect(span(keyway, 'x')[0]).toBeCloseTo(37.9, 9);
      expect(span(keyway, 'x')[1]).toBeCloseTo(42.1, 9);
      expect(span(keyway, 'y')[1]).toBeCloseTo(43, 9);
      const tooth = after.filter((point) => point.y > 20 + 1e-9 && point.y < 40 - 1e-9);
      expect(span(tooth, 'x')).toEqual([expect.closeTo(30, 9), expect.closeTo(33, 9)]);
      expect(span(tooth, 'y')[1]).toBeCloseTo(24, 9);
    });
  }

  it('leaves a rectangular part sitting in another part’s cutout alone', () => {
    const cutout = [
      { x: 20, y: 15 },
      { x: 60, y: 15 },
      { x: 60, y: 45 },
      { x: 20, y: 45 },
    ];
    const strip = [
      { x: 38.5, y: 22.5 },
      { x: 41.5, y: 22.5 },
      { x: 41.5, y: 37.5 },
      { x: 38.5, y: 37.5 },
    ];
    expect(resizeAll([part('sheet', [plate, cutout, strip])], request).analysis.candidates).toEqual(
      [],
    );
    const slot = resizeAll([part('sheet', [plate, strip])], request);
    expect(slot.analysis.candidates.map((candidate) => candidate.kind)).toEqual([
      'enclosed-rectangle',
    ]);
    expect(span(slot.ring('sheet', 1), 'x')).toEqual([
      expect.closeTo(37.9, 9),
      expect.closeTo(42.1, 9),
    ]);
  });
});

describe('T31-P1-1: finger-jointed boxes resize whole or not at all', () => {
  const spec = {
    widthMm: 80,
    depthMm: 50,
    heightMm: 40,
    dimensionMode: 'inner',
    thicknessMm: 3,
    targetFingerWidthMm: 10,
    style: 'closed',
    clearanceMm: 0,
    relief: { kind: 'none' },
    partSpacingMm: 8,
  } as BoxSpec;
  const request = {
    currentWidthMm: 3,
    materialThicknessMm: 4,
    fitAllowanceMm: 0,
    detectionToleranceMm: 0.1,
  };
  function panels(source: (name: string) => string): ReadonlyArray<ImportedSvg> {
    const box = generateBox(spec);
    if (box.kind !== 'generated') throw new Error('box fixture');
    return box.panels.map((panel) =>
      part(panel.name, [panel.outline.points.slice(0, -1)], source(panel.name)),
    );
  }
  // Every edge shorter than a finger is a joint step; its length is the depth.
  const steps = (points: ReadonlyArray<Vec2>): ReadonlyArray<number> =>
    points
      .map((point, i) => {
        const next = points[(i + 1) % points.length]!;
        return Math.round(Math.hypot(next.x - point.x, next.y - point.y) * 1e6) / 1e6;
      })
      .filter((length) => length < 6);

  it('never leaves an imported box panel with mixed joint depths (8 of 20 steps stayed at 3)', () => {
    const objects = panels(() => 'box.svg');
    const result = resizeAll(objects, request);
    for (const object of objects) {
      const depths = new Set(steps(result.ring(object.id)));
      expect(depths.size, object.id).toBe(1);
    }
    const withheld = objects.filter((object) => result.object(object.id) === undefined);
    expect(withheld.length).toBeGreaterThan(0);
    for (const object of withheld)
      expect(result.analysis.notices.some((notice) => notice.startsWith(`${object.name}:`))).toBe(
        true,
      );
    for (const object of objects.filter((item) => result.object(item.id) !== undefined))
      expect([...new Set(steps(result.ring(object.id)))]).toEqual([4]);
  });

  it('refuses Box Generator panels and points to Box Generator', () => {
    const objects = panels((name) => `Box panel: ${name}`);
    const analysis = analyseJointResize(objects, request);
    if (analysis.kind !== 'ok') throw new Error(analysis.error.message);
    expect(analysis.value.candidates).toEqual([]);
    expect(analysis.value.notices).toHaveLength(objects.length);
    for (const notice of analysis.value.notices) expect(notice).toContain('Box Generator');
  });
});

describe('T31 P3 fixes', () => {
  it('detects a width exactly at the tolerance edge wherever it lies (T31-P3-2)', () => {
    for (const [from, to] of [
      [0, 3.1],
      [0, 2.9],
    ] as const) {
      const notch = [
        { x: from - 20, y: 0 },
        { x: to + 20, y: 0 },
        { x: to + 20, y: 20 },
        { x: to, y: 20 },
        { x: to, y: 10 },
        { x: from, y: 10 },
        { x: from, y: 20 },
        { x: from - 20, y: 20 },
      ];
      const analysis = analyseJointResize([part('edge', [notch])], {
        currentWidthMm: 3,
        materialThicknessMm: 3.5,
        fitAllowanceMm: 0,
        detectionToleranceMm: 0.1,
      });
      expect(analysis.kind === 'ok' && analysis.value.candidates.length).toBe(1);
    }
  });

  it('reports a tab with its own width and depth, and the object by name (T31-P3-1)', () => {
    const tab = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 24, y: 20 },
      { x: 24, y: 23 },
      { x: 16, y: 23 },
      { x: 16, y: 20 },
      { x: 0, y: 20 },
    ];
    const analysis = analyseJointResize([part('front', [tab])], {
      currentWidthMm: 3,
      materialThicknessMm: 4,
      fitAllowanceMm: 0.1,
      detectionToleranceMm: 0.1,
    });
    if (analysis.kind !== 'ok') throw new Error(analysis.error.message);
    const [feature] = analysis.value.candidates;
    expect(feature).toMatchObject({ kind: 'outward-tab', objectName: 'front part' });
    expect(feature!.widthMm).toBeCloseTo(8, 9);
    expect(feature!.depthMm).toBeCloseTo(3, 9);
  });
});
