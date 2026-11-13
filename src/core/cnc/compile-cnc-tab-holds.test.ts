// ADR-258 Amendment 5: holding tabs measured from the EMITTED program (CNC
// audit v3 N1 and J1). Every case here was wrong on main before the amendment:
// a small hole or part never cut through (J1-P1-1), corner tabs that narrowed
// or vanished (N1-P2-1), an open outline freed with no tab (N1-P2-2), leads
// that thinned the seam tabs (N1-P2-3), and split loops that each took every
// tab (N1-P3-1), and "Edit positions" handles that moved the tabs (N1-P3-2).
// tab-bridge-measure.test-support.ts reads the G-code with no code shared with
// the planner.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Polyline,
} from '../scene';
import { seedCncTabAnchors } from './cnc-tab-anchors';
import { compileCncJob } from './compile-cnc-job';
import {
  deepestZWithin,
  feedSegments,
  throughCut,
  type Box,
  type FeedSegment,
} from './tab-bridge-measure.test-support';

const COLOR = '#ff0000';
const DEVICE = DEFAULT_DEVICE_PROFILE;
const BIT = 3.175;
const QUARTER = 6.35;
// Through 6.35 mm stock at 2 mm a pass; the default 2 mm tab tops out at -4.35.
const THROUGH: Partial<CncLayerSettings> = { depthMm: 6.35, depthPerPassMm: 2 };
const TAB_TOP = -4.35;

function square(x: number, y: number, size: number): Polyline {
  return rectangle(x, y, size, size);
}

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function circle(cx: number, cy: number, diameter: number): Polyline {
  return {
    closed: true,
    points: Array.from({ length: 128 }, (_, index) => {
      const angle = (index / 128) * Math.PI * 2;
      return { x: cx + (diameter / 2) * Math.cos(angle), y: cy + (diameter / 2) * Math.sin(angle) };
    }),
  };
}

function art(polylines: ReadonlyArray<Polyline>, extra: Partial<ImportedSvg> = {}): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: COLOR, polylines: [...polylines] }],
    ...extra,
  };
}

function compiled(objects: ReadonlyArray<ImportedSvg>, cnc: Partial<CncLayerSettings>) {
  const layer = {
    ...createLayer({ id: 'L1', color: COLOR }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...THROUGH, ...cnc },
  };
  const job = compileCncJob(
    { objects: [...objects], layers: [layer] },
    DEVICE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  return { job, segments: feedSegments(cncGrblStrategy.emit(job, DEVICE)) };
}

// The design-space box around a shape, in the machine coordinates the program uses.
function machineBox(x: number, y: number, width: number, height: number, margin = 6): Box {
  const corners = [
    toMachineCoords({ x: x - margin, y: y - margin }, DEVICE),
    toMachineCoords({ x: x + width + margin, y: y + height + margin }, DEVICE),
  ];
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    maxX: Math.max(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

function holeBox(cx: number, cy: number, diameter: number): Box {
  return machineBox(cx - diameter / 2, cy - diameter / 2, diameter, diameter, -0.01);
}

// Tab walls climbed from the full depth: one per tab on the deepest level.
function tabRises(segments: ReadonlyArray<FeedSegment>, box: Box): number {
  return segments.filter(
    ({ a, b }) =>
      a.x === b.x &&
      a.y === b.y &&
      Math.abs(a.z + 6.35) < 1e-6 &&
      b.z > a.z &&
      a.x >= box.minX &&
      a.x <= box.maxX &&
      a.y >= box.minY &&
      a.y <= box.maxY,
  ).length;
}

describe('J1-P1-1: small holes and parts still cut through', () => {
  it('cuts 8 and 12 mm holes in a plate, and a 6 mm part beside it, through', () => {
    const { segments } = compiled(
      [
        art([
          rectangle(50, 50, 80, 60),
          circle(70, 80, 8),
          circle(100, 80, 12),
          square(160, 60, 6),
        ]),
      ],
      { cutType: 'profile-outside' },
    );

    // On main every one stopped at the 4.35 mm tab top all the way round.
    expect(deepestZWithin(segments, holeBox(70, 80, 8))).toBeCloseTo(-6.35, 6);
    expect(deepestZWithin(segments, holeBox(100, 80, 12))).toBeCloseTo(-6.35, 6);
    expect(deepestZWithin(segments, machineBox(160, 60, 6, 6))).toBeCloseTo(-6.35, 6);
    // ... and each keeps a tab: the slug and the part are still held.
    expect(tabRises(segments, holeBox(70, 80, 8))).toBeGreaterThan(0);
    expect(tabRises(segments, machineBox(160, 60, 6, 6))).toBeGreaterThan(0);
  });

  it('names, by size, a hole too small for even one tab among shapes that cut through', () => {
    const { job, segments } = compiled(
      [art([rectangle(50, 50, 80, 60), circle(70, 80, 5), circle(100, 80, 12)])],
      { cutType: 'profile-outside' },
    );

    expect(deepestZWithin(segments, holeBox(70, 80, 5))).toBeCloseTo(TAB_TOP, 6);
    const shapes = job.cncCompilation?.tabHoldShapes ?? [];
    const never = shapes.filter((shape) => shape.kind === 'never-through');
    expect(never).toHaveLength(1);
    expect(never[0]).toMatchObject({ layerId: 'L1', role: 'hole', tabsCut: 0, tabsSet: 4 });
    expect(never[0]?.widthMm).toBeCloseTo(5, 1);
    expect(shapes.some((shape) => shape.kind === 'fewer-tabs' && shape.role === 'hole')).toBe(true);
  });
});

describe('N1-P2-1: tabs keep their width off the corners', () => {
  it.each([
    { label: 'default 6 mm tabs', tabWidthMm: 6 },
    { label: '1 mm tabs (cut free on main)', tabWidthMm: 1 },
  ])('keeps four full bridges on a 60 mm square with $label', ({ tabWidthMm }) => {
    const { segments } = compiled([art([square(50, 50, 60)])], {
      cutType: 'profile-outside',
      tabWidthMm,
    });
    const cut = throughCut(segments, TAB_TOP, BIT, machineBox(50, 50, 60, 60));

    // Main: 3.31 mm bridges at 6 mm, and one piece (the part free) at 1 mm.
    expect(cut.pieces).toBe(4);
    expect(cut.narrowestBridgeMm).toBeGreaterThan(tabWidthMm - 0.05);
  });

  it('keeps all three tabs of a triangle on the quarter-inch bit', () => {
    const triangle: Polyline = {
      closed: true,
      points: [
        { x: 50, y: 50 },
        { x: 130, y: 50 },
        { x: 90, y: 50 + 40 * Math.sqrt(3) },
      ],
    };
    const { segments } = compiled([art([triangle])], {
      cutType: 'profile-outside',
      toolId: 'em-6350',
      tabsPerShape: 3,
    });
    const cut = throughCut(segments, TAB_TOP, QUARTER, machineBox(50, 50, 80, 70));

    // Main: two pieces, one tab milled away at the corner.
    expect(cut.pieces).toBe(3);
    expect(cut.narrowestBridgeMm).toBeGreaterThan(5.95);
  });

  it('names a dragged tab whose bridge an outline turning inside it narrows', () => {
    const wedge: Polyline = {
      closed: true,
      points: [
        { x: 50, y: 50 },
        { x: 110, y: 50 },
        { x: 50, y: 50 + 60 * Math.tan(Math.PI / 9) },
      ],
    };
    const { job } = compiled(
      [
        art([wedge], {
          cncTabAnchors: [{ layerColor: COLOR, pathIndex: 0, polylineIndex: 0, pathT: 60 / 145 }],
        }),
      ],
      { cutType: 'profile-outside' },
    );

    // The anchor sits just past the 20 degree tip, where the far leg's cut
    // closes in on the near kerf end.
    const narrow = job.cncCompilation?.tabHoldShapes?.find(
      (shape) => shape.kind === 'narrow-bridge',
    );
    expect(narrow?.bridgeMm).toBeLessThan(3);
  });
});

describe('N1-P2-2: an open outline the bit closes is tabbed', () => {
  function openOutline(gapMm: number): Polyline {
    return {
      closed: false,
      points: [
        { x: 50 + gapMm, y: 50 },
        { x: 130, y: 50 },
        { x: 130, y: 110 },
        { x: 50, y: 110 },
        { x: 50, y: 50 },
      ],
    };
  }

  it.each([
    { cutType: 'profile-on-path' as const, gapMm: 0.3 },
    { cutType: 'profile-on-path' as const, gapMm: 2 },
    { cutType: 'profile-outside' as const, gapMm: 1 },
  ])('holds the part cut $cutType with a $gapMm mm gap', ({ cutType, gapMm }) => {
    const { job, segments } = compiled([art([openOutline(gapMm)])], { cutType });
    const cut = throughCut(segments, TAB_TOP, BIT, machineBox(50, 50, 80, 60));

    // Main: one through-cut piece with no tab level at all: the part came free.
    expect(cut.pieces).toBeGreaterThanOrEqual(4);
    expect(job.cncCompilation?.tabHoldShapes?.map((shape) => shape.kind)).toContain('closed-gap');
  });

  it('leaves an open line wider apart than the cut untabbed (ADR-258 Amendment 4)', () => {
    const { job, segments } = compiled([art([openOutline(10)])], {
      cutType: 'profile-on-path',
    });

    expect(tabRises(segments, machineBox(50, 50, 80, 60))).toBe(0);
    expect(job.cncCompilation?.tabHoldShapes).toBeUndefined();
  });
});

describe('N1-P2-3: leads leave the tabs beside them whole', () => {
  it.each([
    { label: 'a 16 mm hole with the default lead', diameter: 16, lead: undefined },
    { label: 'an 18 mm hole with a 5 mm lead radius', diameter: 18, lead: 5 },
  ])('keeps every bridge of $label as wide as with leads off', ({ diameter, lead }) => {
    const hole = [art([circle(80, 80, diameter)])];
    const box = holeBox(80, 80, diameter);
    const led = compiled(hole, {
      cutType: 'profile-inside',
      ...(lead === undefined ? {} : { profileLead: { shape: 'arc' as const, radiusMm: lead } }),
    });
    const unled = compiled(hole, {
      cutType: 'profile-inside',
      profileLead: { shape: 'none' },
    });
    const ledCut = throughCut(led.segments, TAB_TOP, BIT, box);
    const unledCut = throughCut(unled.segments, TAB_TOP, BIT, box);

    // Main: 3.28 mm beside the 16 mm hole's seam (5.2 off), and the 5 mm lead
    // erased both seam tabs of the 18 mm hole.
    expect(ledCut.pieces).toBe(unledCut.pieces);
    expect(ledCut.narrowestBridgeMm).toBeCloseTo(unledCut.narrowestBridgeMm, 2);
  });
});

describe('N1-P3-1: one outline split into two loops', () => {
  const necked: Polyline = {
    closed: true,
    points: [
      { x: 50, y: 50 },
      { x: 70, y: 50 },
      { x: 70, y: 59 },
      { x: 72, y: 59 },
      { x: 72, y: 50 },
      { x: 92, y: 50 },
      { x: 92, y: 70 },
      { x: 72, y: 70 },
      { x: 72, y: 61 },
      { x: 70, y: 61 },
      { x: 70, y: 70 },
      { x: 50, y: 70 },
    ],
  };
  const left = machineBox(50, 50, 20, 20, 0);
  const right = machineBox(72, 50, 20, 20, 0);

  it('shares the tabs per shape between the loops', () => {
    const { segments } = compiled([art([necked])], { cutType: 'profile-inside' });

    // Main: four on each loop, eight for one shape.
    expect(tabRises(segments, left) + tabRises(segments, right)).toBe(4);
  });

  it('puts a dragged tab on the loop it was dragged onto only', () => {
    // The anchor is 10 mm along the left lobe's bottom edge.
    const { segments } = compiled(
      [
        art([necked], {
          cncTabAnchors: [{ layerColor: COLOR, pathIndex: 0, polylineIndex: 0, pathT: 10 / 124 }],
        }),
      ],
      { cutType: 'profile-inside' },
    );

    expect(tabRises(segments, left)).toBe(1);
    // Main copied the anchor onto the right loop's nearest corner instead; that
    // loop now keeps its own automatic share.
    expect(tabRises(segments, right)).toBe(2);
  });
});

describe('N1-P3-2: Edit positions shows the tabs the job already cuts', () => {
  it('seeds handles where the automatic tabs are, so opening the editor changes nothing', () => {
    const object = art([square(50, 50, 60)]);
    const automatic = compiled([object], { cutType: 'profile-outside' });
    const cncTabAnchors = seedCncTabAnchors(object, COLOR, 4, { tabWidthMm: 6, cutWidthMm: BIT });
    const seeded = compiled([{ ...object, cncTabAnchors }], { cutType: 'profile-outside' });
    const walls = (segments: ReadonlyArray<FeedSegment>) =>
      segments
        .filter(
          ({ a, b }) => a.x === b.x && a.y === b.y && Math.abs(a.z + 6.35) < 1e-6 && b.z > a.z,
        )
        .map(({ a }) => `${a.x.toFixed(2)},${a.y.toFixed(2)}`)
        .sort();

    // Main seeded the middle of each edge while the job cut its tabs on the corners.
    expect(walls(seeded.segments)).toHaveLength(4);
    expect(walls(seeded.segments)).toEqual(walls(automatic.segments));
  });
});
