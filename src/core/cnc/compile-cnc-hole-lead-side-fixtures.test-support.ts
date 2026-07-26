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
import type { CncGroup } from '../job';
import { compileCncJob } from './compile-cnc-job';

type Rect = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
type SourceWinding = 'forward' | 'reversed';
type Side = 'left' | 'right';

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
const DEFAULT_DEPTH_MM = 2;
const DEEP_DEPTH_MM = 4;
const FINISH_ALLOWANCE_MM = 1;
const SECOND_TOOL_ID = 'em-6350';
const SECOND_TOOL_DIAMETER_MM = 6.35;
const EXPECTED_HOLE_DEPTHS_MM: readonly [number, number] = [-DEEP_DEPTH_MM, -DEFAULT_DEPTH_MM];
const CUT_DIRECTIONS: readonly [CncCutDirection, CncCutDirection] = ['climb', 'conventional'];
const PART_SIDES: readonly [Side, Side] = ['left', 'right'];
const NO_PROFILE_LEAD: NonNullable<CncLayerSettings['profileLead']> = { shape: 'none' };
const EMPTY_FIXTURE_ERROR = 'fixture must contain points';
const EXPECTED_CNC_GROUP_ERROR = 'expected a cnc group';

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

/** Test-only scenes and settings for the hole-direction compile contract. */
export const holeLeadFixtures = {
  cutDirections: CUT_DIRECTIONS,
  partSides: PART_SIDES,
  defaultDepthMm: DEFAULT_DEPTH_MM,
  deepDepthMm: DEEP_DEPTH_MM,
  finishAllowanceMm: FINISH_ALLOWANCE_MM,
  secondToolId: SECOND_TOOL_ID,
  secondToolDiameterMm: SECOND_TOOL_DIAMETER_MM,
  expectedHoleDepthsMm: EXPECTED_HOLE_DEPTHS_MM,
  holedPart,
  disjointHoledParts,
  nestedIslandPart,
  compileWithAndWithoutLead,
};
