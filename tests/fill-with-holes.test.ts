/**
 * T3-38: fill-with-holes geometric correctness.
 *
 * This is an output-level regression net for compound fills: compile real
 * compound path scenes to G-code, parse the emitted laser-on motion, and
 * verify fill segments stay inside material while avoiding holes. It covers
 * line fill and cross-hatch so the second fill angle cannot regress quietly.
 *
 * Run: npx tsx tests/fill-with-holes.test.ts
 */
import { compileGcode } from '../src/app/PipelineService';
import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import { createLayer, type FillMode } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createPath, type SubPath } from '../src/core/scene/SceneObject';
import type { Point } from '../src/core/types';
import { entitlementService, type EntitlementState } from '../src/entitlements';
import { analyzeBurnBounds, type BurnSegment } from './helpers/analyzeBurnBounds';
import { parseGcode } from './helpers/parseGcode';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function square(x: number, y: number, side: number): Point[] {
  return [
    { x, y },
    { x: x + side, y },
    { x: x + side, y: y + side },
    { x, y: y + side },
  ];
}

function circle(cx: number, cy: number, radius: number, steps = 72): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const theta = (Math.PI * 2 * i) / steps;
    points.push({
      x: cx + Math.cos(theta) * radius,
      y: cy + Math.sin(theta) * radius,
    });
  }
  return points;
}

function subPath(points: readonly Point[]): SubPath {
  const [first, ...rest] = points;
  if (!first) throw new Error('subPath requires points');
  return {
    closed: true,
    segments: [
      { type: 'move', to: { ...first } },
      ...rest.map(point => ({ type: 'line' as const, to: { ...point } })),
      { type: 'close' },
    ],
  };
}

function pointOnSegment(point: Point, a: Point, b: Point, epsilon = 0.03): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= epsilon * epsilon) {
    return Math.hypot(point.x - a.x, point.y - a.y) <= epsilon;
  }
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
  if (t < -epsilon || t > 1 + epsilon) return false;
  const proj = { x: a.x + Math.max(0, Math.min(1, t)) * dx, y: a.y + Math.max(0, Math.min(1, t)) * dy };
  return Math.hypot(point.x - proj.x, point.y - proj.y) <= epsilon;
}

function pointOnPolygon(point: Point, polygon: readonly Point[]): boolean {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (pointOnSegment(point, polygon[j]!, polygon[i]!)) return true;
  }
  return false;
}

function pointInsidePolygonStrict(point: Point, polygon: readonly Point[]): boolean {
  if (pointOnPolygon(point, polygon)) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-12) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function inMaterial(point: Point, contours: readonly Point[][]): boolean {
  if (contours.some(contour => pointOnPolygon(point, contour))) return true;

  let depth = 0;
  for (const contour of contours) {
    if (pointInsidePolygonStrict(point, contour)) depth++;
  }
  return depth % 2 === 1;
}

function insideOrOnAny(point: Point, contours: readonly Point[][] | undefined): boolean {
  return contours?.some(contour => pointOnPolygon(point, contour) || pointInsidePolygonStrict(point, contour)) ?? false;
}

function interpolate(segment: BurnSegment, t: number): Point {
  return {
    x: segment.fromXY.x + (segment.toXY.x - segment.fromXY.x) * t,
    y: segment.fromXY.y + (segment.toXY.y - segment.fromXY.y) * t,
  };
}

interface Fixture {
  name: string;
  contours: Point[][];
  holeContours?: Point[][];
  islandContours?: Point[][];
  islandProbe?: Point;
}

const HOLE_WITH_ISLAND_ISLAND = square(68, 123, 14);

const FIXTURES: Fixture[] = [
  {
    name: 'donut-square',
    contours: [
      square(10, 10, 50),
      square(25, 25, 20),
    ],
    holeContours: [square(25, 25, 20)],
  },
  {
    name: 'ring-circle',
    contours: [
      circle(90, 40, 25),
      circle(90, 40, 10),
    ],
    holeContours: [circle(90, 40, 10)],
  },
  {
    name: 'letter-b-like',
    contours: [
      square(130, 10, 60),
      square(145, 22, 15),
      square(145, 53, 15),
    ],
    holeContours: [square(145, 22, 15), square(145, 53, 15)],
  },
  {
    name: 'hole-with-island',
    contours: [
      square(40, 95, 70),
      square(55, 110, 40),
      HOLE_WITH_ISLAND_ISLAND,
    ],
    holeContours: [square(55, 110, 40)],
    islandContours: [HOLE_WITH_ISLAND_ISLAND],
    islandProbe: { x: 75, y: 130 },
  },
];

function makeScene(fixture: Fixture, fillMode: FillMode): Scene {
  const scene = createScene(220, 180, `T3-38 ${fixture.name} ${fillMode}`);
  scene.compileOptions = { optimizeOrder: false };
  const layer = createLayer(0, 'engrave', 'Engrave');
  layer.settings.power = { min: 0, max: 55 };
  layer.settings.speed = 2500;
  layer.settings.fill.interval = 3;
  layer.settings.fill.angle = 0;
  layer.settings.fill.mode = fillMode;
  layer.settings.fill.biDirectional = false;
  layer.settings.fill.overscanning = 0;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [
    createPath(layer.id, fixture.contours.map(contour => subPath(contour)), fixture.name),
  ];
  return scene;
}

async function compileBurnSegments(fixture: Fixture, fillMode: FillMode): Promise<BurnSegment[]> {
  const profile = createBlankProfile(`T3-38 ${fixture.name}`);
  profile.bedWidth = 220;
  profile.bedHeight = 180;
  profile.originCorner = 'rear-left';
  profile.maxSpindle = 1000;

  const compiled = await compileGcode(
    makeScene(fixture, fillMode),
    'absolute',
    null,
    null,
    'grbl',
    null,
    null,
    profile,
  );
  assert(compiled !== null, `${fixture.name}/${fillMode}: compiles`);
  if (!compiled) return [];

  return analyzeBurnBounds(parseGcode(compiled.gcode)).burnSegments;
}

function validateSegments(fixture: Fixture, fillMode: FillMode, segments: readonly BurnSegment[]): void {
  assert(segments.length > 0, `${fixture.name}/${fillMode}: emits burn segments`);
  assert(segments.length < 5000, `${fixture.name}/${fillMode}: segment count stays bounded (${segments.length})`);

  let islandHit = false;
  const violations: string[] = [];
  for (const segment of segments) {
    for (let sample = 0; sample <= 20; sample++) {
      const t = sample / 20;
      const point = interpolate(segment, t);
      if (!inMaterial(point, fixture.contours)) {
        violations.push(`outside material at (${point.x.toFixed(3)}, ${point.y.toFixed(3)})`);
        if (violations.length >= 8) break;
      }
      if (fixture.holeContours) {
        for (const hole of fixture.holeContours) {
          const inHoleInterior = pointInsidePolygonStrict(point, hole);
          const inIsland = insideOrOnAny(point, fixture.islandContours);
          if (inHoleInterior && !inIsland) {
            violations.push(`inside excluded hole at (${point.x.toFixed(3)}, ${point.y.toFixed(3)})`);
            if (violations.length >= 8) break;
          }
        }
      }
      if (fixture.islandProbe && Math.hypot(point.x - fixture.islandProbe.x, point.y - fixture.islandProbe.y) < 8) {
        islandHit = true;
      }
    }
    if (violations.length >= 8) break;
  }

  assert(
    violations.length === 0,
    `${fixture.name}/${fillMode}: burn samples stay inside material and outside hole interiors`
      + (violations.length > 0 ? ` (${violations.join('; ')})` : ''),
  );

  if (fixture.islandProbe) {
    assert(islandHit, `${fixture.name}/${fillMode}: island inside hole is still filled`);
  }
}

async function main(): Promise<void> {
  console.log('\n=== T3-38 fill with holes ===\n');

  const stateHolder = entitlementService as unknown as { state: EntitlementState };
  const originalState = stateHolder.state;
  stateHolder.state = {
    tier: 'paid',
    hasPro: true,
    status: 'verified',
    features: ['cross_hatch'],
  };

  try {
    for (const fixture of FIXTURES) {
      for (const fillMode of ['line', 'cross-hatch'] as const) {
        const segments = await compileBurnSegments(fixture, fillMode);
        validateSegments(fixture, fillMode, segments);
      }
    }
  } finally {
    stateHolder.state = originalState;
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
