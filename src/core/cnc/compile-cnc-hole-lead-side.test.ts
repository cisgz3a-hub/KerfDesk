import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncCutDirection,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Vec2,
} from '../scene';
import { cncPassXyPoints, type CncGroup, type CncPass } from '../job';
import { pointInPolygon } from '../geometry';
import { compileCncJob } from './compile-cnc-job';

// ADR-252 regression. A hole's waste is the slug INSIDE its tool-center ring, so
// every point of the hole's lead must lie inside that ring. Measuring against the
// hole's drawn boundary instead is too loose: a point one tool radius outside the
// ring still falls inside the drawn boundary while the cutter is already eating
// the kept part beyond the finished wall.

type Rect = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
type SourceWinding = 'forward' | 'reversed';
type Side = 'left' | 'right';
type OuterHoleRoles = Readonly<{ hole: CncPass; outer: CncPass }>;
type NestedRoles = Readonly<{ island: CncPass; hole: CncPass; outer: CncPass }>;

const CUT_COLOR = '#2563eb';
const SVG_EXTENSION = '.svg';
const LAYER_ID = 'op';
const STANDARD_OBJECT_ID = 'holed';
const DISJOINT_OBJECT_ID = 'two-holed-parts';
const NESTED_OBJECT_ID = 'nested-island';
const STANDARD_OUTER = { minX: 50, minY: 50, maxX: 150, maxY: 150 } satisfies Rect;
const STANDARD_HOLE = { minX: 85, minY: 85, maxX: 115, maxY: 115 } satisfies Rect;
const LEFT_OUTER = { minX: 20, minY: 30, maxX: 80, maxY: 90 } satisfies Rect;
const LEFT_HOLE = { minX: 40, minY: 50, maxX: 60, maxY: 70 } satisfies Rect;
const RIGHT_OUTER = { minX: 120, minY: 30, maxX: 200, maxY: 110 } satisfies Rect;
const RIGHT_HOLE = { minX: 145, minY: 55, maxX: 175, maxY: 85 } satisfies Rect;
const NESTED_OUTER = { minX: 20, minY: 20, maxX: 200, maxY: 200 } satisfies Rect;
const NESTED_HOLE = { minX: 60, minY: 60, maxX: 160, maxY: 160 } satisfies Rect;
const NESTED_ISLAND = { minX: 90, minY: 90, maxX: 130, maxY: 130 } satisfies Rect;
const PARTITION_X_MM = 100;
const DEFAULT_DEPTH_MM = 2;
const DEEP_DEPTH_MM = 4;
const FINISH_ALLOWANCE_MM = 1;
const SECOND_TOOL_ID = 'em-6350';
const SECOND_TOOL_DIAMETER_MM = 6.35;
const EXPECTED_SIMPLE_ROLE_COUNT = 2;
const EXPECTED_NESTED_ROLE_COUNT = 3;
const EXPECTED_DEEP_HOLE_PASS_COUNT = 3;
const EXPECTED_FULL_DEPTH_SPAN_COUNT = 2;
const HOLE_ROLE_MAX_SPAN_MM = 50;
const SPAN_PRECISION_DIGITS = 3;
const ON_RING_TOLERANCE_MM = 1e-6;
const EXPECTED_HOLE_DEPTHS_MM: readonly [number, number] = [-DEEP_DEPTH_MM, -DEFAULT_DEPTH_MM];
const CUT_DIRECTIONS: readonly [CncCutDirection, CncCutDirection] = ['climb', 'conventional'];
const PART_SIDES: readonly [Side, Side] = ['left', 'right'];
const NO_PROFILE_LEAD: NonNullable<CncLayerSettings['profileLead']> = { shape: 'none' };
const EMPTY_FIXTURE_ERROR = 'fixture must contain points';
const EXPECTED_CNC_GROUP_ERROR = 'expected a cnc group';
const EXPECTED_PROFILE_PASS_ERROR = 'expected a contour or path3d profile pass';
const EXPECTED_ROLE_ERROR = 'expected all role passes';
const EXPECTED_RING_EDGE_ERROR = 'expected a complete ring edge';

function rectangle(rect: Rect, winding: SourceWinding = 'forward'): Polyline {
  const points: Vec2[] = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  return { closed: true, points: winding === 'reversed' ? [...points].reverse() : points };
}

function fixtureObject(id: string, polylines: ReadonlyArray<Polyline>): ImportedSvg {
  const points = polylines.flatMap((polyline) => polyline.points);
  if (points.length === 0) throw new Error(EMPTY_FIXTURE_ERROR);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}${SVG_EXTENSION}`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: CUT_COLOR, polylines }],
  };
}

function holedPart(winding: SourceWinding = 'forward'): ImportedSvg {
  return fixtureObject(STANDARD_OBJECT_ID, [
    rectangle(STANDARD_OUTER, winding),
    rectangle(STANDARD_HOLE, winding),
  ]);
}

function disjointHoledParts(): ImportedSvg {
  return fixtureObject(DISJOINT_OBJECT_ID, [
    rectangle(LEFT_OUTER),
    rectangle(LEFT_HOLE),
    rectangle(RIGHT_OUTER),
    rectangle(RIGHT_HOLE),
  ]);
}

function nestedIslandPart(): ImportedSvg {
  return fixtureObject(NESTED_OBJECT_ID, [
    rectangle(NESTED_OUTER),
    rectangle(NESTED_HOLE),
    rectangle(NESTED_ISLAND),
  ]);
}

function compileFixture(
  object: ImportedSvg,
  direction: CncCutDirection,
  extra: Partial<CncLayerSettings> = {},
): CncGroup {
  const layer: Layer = {
    ...createLayer({ id: LAYER_ID, color: CUT_COLOR }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside',
      depthMm: DEFAULT_DEPTH_MM,
      depthPerPassMm: DEFAULT_DEPTH_MM,
      ...extra,
      cutDirection: direction,
    },
  };
  const group = compileCncJob(
    { objects: [object], layers: [layer] },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  ).groups[0];
  if (group?.kind !== 'cnc') throw new Error(EXPECTED_CNC_GROUP_ERROR);
  return group;
}

function compileWithAndWithoutLead(
  object: ImportedSvg,
  direction: CncCutDirection,
  extra: Partial<CncLayerSettings> = {},
): Readonly<{ ring: CncGroup; led: CncGroup }> {
  return {
    ring: compileFixture(object, direction, { ...extra, profileLead: NO_PROFILE_LEAD }),
    led: compileFixture(object, direction, extra),
  };
}

function passSpanX(pass: CncPass): number {
  const xs = cncPassXyPoints(pass).map((point) => point.x);
  return Math.max(...xs) - Math.min(...xs);
}

function passCenterX(pass: CncPass): number {
  const xs = cncPassXyPoints(pass).map((point) => point.x);
  return (Math.min(...xs) + Math.max(...xs)) / 2;
}

function passDepthMm(pass: CncPass): number {
  if (pass.kind === 'contour') return pass.zMm;
  if (pass.kind === 'path3d') return Math.min(...pass.points.map((point) => point.z));
  throw new Error(EXPECTED_PROFILE_PASS_ERROR);
}

function sortedBySpan(group: CncGroup): ReadonlyArray<CncPass> {
  return [...group.passes].sort((first, second) => passSpanX(first) - passSpanX(second));
}

function outerHoleRoles(group: CncGroup): OuterHoleRoles {
  const roles = sortedBySpan(group);
  expect(roles).toHaveLength(EXPECTED_SIMPLE_ROLE_COUNT);
  const [hole, outer] = roles;
  if (hole === undefined || outer === undefined) throw new Error(EXPECTED_ROLE_ERROR);
  return { hole, outer };
}

function rolesOnSide(group: CncGroup, side: Side): OuterHoleRoles {
  const roles = sortedBySpan(group).filter((pass) =>
    side === 'left' ? passCenterX(pass) < PARTITION_X_MM : passCenterX(pass) > PARTITION_X_MM,
  );
  expect(roles).toHaveLength(EXPECTED_SIMPLE_ROLE_COUNT);
  const [hole, outer] = roles;
  if (hole === undefined || outer === undefined) throw new Error(EXPECTED_ROLE_ERROR);
  return { hole, outer };
}

function nestedRoles(group: CncGroup): NestedRoles {
  const roles = sortedBySpan(group);
  expect(roles).toHaveLength(EXPECTED_NESTED_ROLE_COUNT);
  const [island, hole, outer] = roles;
  if (island === undefined || hole === undefined || outer === undefined) {
    throw new Error(EXPECTED_ROLE_ERROR);
  }
  return { island, hole, outer };
}

function deepHolePasses(group: CncGroup): ReadonlyArray<CncPass> {
  return group.passes
    .filter((pass) => passSpanX(pass) < HOLE_ROLE_MAX_SPAN_MM)
    .sort((first, second) => {
      const depthDifference = passDepthMm(first) - passDepthMm(second);
      return depthDifference === 0 ? passSpanX(first) - passSpanX(second) : depthDifference;
    });
}

function distanceToRingMm(point: Vec2, ring: ReadonlyArray<Vec2>): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    if (start === undefined || end === undefined) throw new Error(EXPECTED_RING_EDGE_ERROR);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared <= ON_RING_TOLERANCE_MM
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
          );
    nearest = Math.min(
      nearest,
      Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t)),
    );
  }
  return nearest;
}

function worstOutsideRingMm(led: CncPass, ring: CncPass): number {
  const ringPoints = cncPassXyPoints(ring);
  const excursions = cncPassXyPoints(led)
    .filter((point) => !pointInPolygon(point, ringPoints))
    .map((point) => distanceToRingMm(point, ringPoints));
  return excursions.length === 0 ? 0 : Math.max(...excursions);
}

function worstInsideRingMm(led: CncPass, ring: CncPass): number {
  const ringPoints = cncPassXyPoints(ring);
  const excursions = cncPassXyPoints(led)
    .filter((point) => pointInPolygon(point, ringPoints))
    .map((point) => distanceToRingMm(point, ringPoints));
  return excursions.length === 0 ? 0 : Math.max(...excursions);
}

function expectInteriorWasteLead(ring: CncPass, led: CncPass): void {
  expect(led.kind).toBe('path3d');
  expect(worstOutsideRingMm(led, ring)).toBeLessThanOrEqual(ON_RING_TOLERANCE_MM);
}

function expectExteriorWasteLead(ring: CncPass, led: CncPass): void {
  expect(led.kind).toBe('path3d');
  expect(worstOutsideRingMm(led, ring)).toBeGreaterThan(ON_RING_TOLERANCE_MM);
  expect(worstInsideRingMm(led, ring)).toBeLessThanOrEqual(ON_RING_TOLERANCE_MM);
}

describe('hole lead side under cut-direction enforcement', () => {
  for (const direction of CUT_DIRECTIONS) {
    it(`keeps the hole lead inside the hole tool-center ring (${direction})`, () => {
      const pair = compileWithAndWithoutLead(holedPart(), direction);
      const ring = outerHoleRoles(pair.ring);
      const led = outerHoleRoles(pair.led);
      expectInteriorWasteLead(ring.hole, led.hole);
    });

    it(`normalizes reversed source winding before resolving lead sides (${direction})`, () => {
      const pair = compileWithAndWithoutLead(holedPart('reversed'), direction);
      const ring = outerHoleRoles(pair.ring);
      const led = outerHoleRoles(pair.led);
      expectInteriorWasteLead(ring.hole, led.hole);
      expectExteriorWasteLead(ring.outer, led.outer);
    });

    it(`resolves each disjoint outer/hole part independently (${direction})`, () => {
      const pair = compileWithAndWithoutLead(disjointHoledParts(), direction);
      for (const side of PART_SIDES) {
        const ring = rolesOnSide(pair.ring, side);
        const led = rolesOnSide(pair.led, side);
        expectInteriorWasteLead(ring.hole, led.hole);
        expectExteriorWasteLead(ring.outer, led.outer);
      }
    });

    it(`keeps a depth-two island on the outer lead side (${direction})`, () => {
      const pair = compileWithAndWithoutLead(nestedIslandPart(), direction);
      const ring = nestedRoles(pair.ring);
      const led = nestedRoles(pair.led);
      expectExteriorWasteLead(ring.island, led.island);
      expectInteriorWasteLead(ring.hole, led.hole);
      expectExteriorWasteLead(ring.outer, led.outer);
    });

    it(`keeps every roughing and finishing hole lead inside across depth steps (${direction})`, () => {
      const pair = compileWithAndWithoutLead(holedPart(), direction, {
        depthMm: DEEP_DEPTH_MM,
        depthPerPassMm: DEFAULT_DEPTH_MM,
        finishAllowanceMm: FINISH_ALLOWANCE_MM,
        tabsEnabled: false,
        toolId: SECOND_TOOL_ID,
      });
      const ringPasses = deepHolePasses(pair.ring);
      const ledPasses = deepHolePasses(pair.led);
      expect(pair.led.toolId).toBe(SECOND_TOOL_ID);
      expect(pair.led.toolDiameterMm).toBe(SECOND_TOOL_DIAMETER_MM);
      expect(ringPasses).toHaveLength(EXPECTED_DEEP_HOLE_PASS_COUNT);
      expect(ledPasses).toHaveLength(EXPECTED_DEEP_HOLE_PASS_COUNT);
      const holeDepths = [...new Set(ledPasses.map(passDepthMm))].sort(
        (first, second) => first - second,
      );
      expect(holeDepths).toEqual(EXPECTED_HOLE_DEPTHS_MM);
      for (const [index, ring] of ringPasses.entries()) {
        const led = ledPasses[index];
        if (led === undefined) throw new Error(EXPECTED_ROLE_ERROR);
        expectInteriorWasteLead(ring, led);
      }
      const fullDepthSpans = ledPasses
        .filter((pass) => passDepthMm(pass) === -DEEP_DEPTH_MM)
        .map((pass) => passSpanX(pass).toFixed(SPAN_PRECISION_DIGITS));
      expect(new Set(fullDepthSpans).size).toBe(EXPECTED_FULL_DEPTH_SPAN_COUNT);
    });
  }
});
