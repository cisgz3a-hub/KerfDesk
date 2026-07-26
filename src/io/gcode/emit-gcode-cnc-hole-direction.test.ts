import { describe, expect, it } from 'vitest';
import type { ToolpathStep } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncCutDirection,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Project,
  type Vec2,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';
import { parseGcodeProgram } from './parse-gcode-program';

const PROFILE_COLOR = '#2563eb';
const PROFILE_LAYER_ID = 'profile';
const PROFILE_OBJECT_ID = 'holed-profile';
const PROFILE_SOURCE = 'holed-profile.svg';
const OUTER_MIN_MM = 50;
const OUTER_MAX_MM = 150;
const HOLE_MIN_MM = 85;
const HOLE_MAX_MM = 115;
const PROFILE_DEPTH_MM = 2;
const EXPECTED_PROFILE_LOOP_COUNT = 2;
const CUT_DIRECTIONS: readonly [CncCutDirection, CncCutDirection] = ['climb', 'conventional'];
const EXPECTED_CLOSED_LOOP_ERROR = 'expected emitted cut motion to form a closed loop';
const EXPECTED_CUT_ENDPOINTS_ERROR = 'expected emitted cut step to contain endpoints';
const EXPECTED_WINDING_POINTS_ERROR = 'expected closed-loop points while measuring winding';
const EXPECTED_PROFILE_LOOPS_ERROR = 'expected one hole loop followed by one outer loop';

function square(minMm: number, maxMm: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minMm, y: minMm },
      { x: maxMm, y: minMm },
      { x: maxMm, y: maxMm },
      { x: minMm, y: maxMm },
    ],
  };
}

function holedProfileObject(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: PROFILE_OBJECT_ID,
    source: PROFILE_SOURCE,
    bounds: {
      minX: OUTER_MIN_MM,
      minY: OUTER_MIN_MM,
      maxX: OUTER_MAX_MM,
      maxY: OUTER_MAX_MM,
    },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: PROFILE_COLOR,
        polylines: [square(OUTER_MIN_MM, OUTER_MAX_MM), square(HOLE_MIN_MM, HOLE_MAX_MM)],
      },
    ],
  };
}

function holedProfileProject(direction: CncCutDirection): Project {
  const layer: Layer = {
    ...createLayer({ id: PROFILE_LAYER_ID, color: PROFILE_COLOR }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside',
      cutDirection: direction,
      depthMm: PROFILE_DEPTH_MM,
      depthPerPassMm: PROFILE_DEPTH_MM,
      tabsEnabled: false,
      profileLead: { shape: 'none' },
    },
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [holedProfileObject()], layers: [layer] },
  };
}

function closedPolyline(points: ReadonlyArray<Vec2>): Polyline {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined || first.x !== last.x || first.y !== last.y) {
    throw new Error(EXPECTED_CLOSED_LOOP_ERROR);
  }
  return { closed: true, points };
}

function contiguousCutLoops(steps: ReadonlyArray<ToolpathStep>): ReadonlyArray<Polyline> {
  const loops: Polyline[] = [];
  let points: Vec2[] = [];
  const finishLoop = (): void => {
    if (points.length === 0) return;
    loops.push(closedPolyline(points));
    points = [];
  };
  for (const step of steps) {
    if (step.kind !== 'cut') {
      finishLoop();
      continue;
    }
    const first = step.polyline[0];
    const last = step.polyline.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error(EXPECTED_CUT_ENDPOINTS_ERROR);
    }
    if (points.length === 0) points.push(first);
    points.push(last);
  }
  finishLoop();
  return loops;
}

function signedDoubleArea(points: ReadonlyArray<Vec2>): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) {
      throw new Error(EXPECTED_WINDING_POINTS_ERROR);
    }
    area += current.x * next.y - next.x * current.y;
  }
  return area;
}

describe('emitGcode CNC hole direction', () => {
  for (const direction of CUT_DIRECTIONS) {
    it(`preserves mirrored hole and outer winding for ${direction}`, () => {
      const emitted = emitGcode(holedProfileProject(direction));
      expect(emitted.preflight).toEqual({ ok: true, issues: [] });

      const parsed = parseGcodeProgram(emitted.gcode);
      if (parsed.kind !== 'ok') throw new Error(parsed.reason);
      const loops = contiguousCutLoops(parsed.toolpath.steps);
      expect(loops).toHaveLength(EXPECTED_PROFILE_LOOP_COUNT);
      const [hole, outer] = loops;
      if (hole === undefined || outer === undefined) {
        throw new Error(EXPECTED_PROFILE_LOOPS_ERROR);
      }

      const holeArea = signedDoubleArea(hole.points);
      const outerArea = signedDoubleArea(outer.points);
      expect(Math.abs(holeArea)).toBeLessThan(Math.abs(outerArea));
      expect(outerArea > 0).toBe(direction === 'conventional');
      expect(holeArea > 0).toBe(!(outerArea > 0));
    });
  }
});
