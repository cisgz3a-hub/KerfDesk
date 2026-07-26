import { expect } from 'vitest';
import { pointInPolygon } from '../geometry';
import { cncPassXyPoints, type CncGroup, type CncPass } from '../job';
import type { Vec2 } from '../scene';

type Side = 'left' | 'right';
type OuterHoleRoles = Readonly<{ hole: CncPass; outer: CncPass }>;
type NestedRoles = Readonly<{ island: CncPass; hole: CncPass; outer: CncPass }>;

const PARTITION_X_MM = 100;
const EXPECTED_SIMPLE_ROLE_COUNT = 2;
const EXPECTED_NESTED_ROLE_COUNT = 3;
const EXPECTED_DEEP_HOLE_PASS_COUNT = 3;
const EXPECTED_FULL_DEPTH_SPAN_COUNT = 2;
const HOLE_ROLE_MAX_SPAN_MM = 50;
const SPAN_PRECISION_DIGITS = 3;
const ON_RING_TOLERANCE_MM = 1e-6;
const EXPECTED_PROFILE_PASS_ERROR = 'expected a contour or path3d profile pass';
const EXPECTED_ROLE_ERROR = 'expected all role passes';
const EXPECTED_RING_EDGE_ERROR = 'expected a complete ring edge';

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

/** Test-only role classification and ring-relative lead assertions. */
export const holeLeadAssertions = {
  expectedDeepHolePassCount: EXPECTED_DEEP_HOLE_PASS_COUNT,
  expectedFullDepthSpanCount: EXPECTED_FULL_DEPTH_SPAN_COUNT,
  spanPrecisionDigits: SPAN_PRECISION_DIGITS,
  expectedRoleError: EXPECTED_ROLE_ERROR,
  outerHoleRoles,
  rolesOnSide,
  nestedRoles,
  deepHolePasses,
  passDepthMm,
  passSpanX,
  expectInteriorWasteLead,
  expectExteriorWasteLead,
};
