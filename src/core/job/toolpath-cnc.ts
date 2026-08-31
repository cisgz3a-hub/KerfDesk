// CNC-group toolpath steps (Phase H.2) — mirrors cnc-grbl-strategy's motion
// contract step-for-step so the simulator shows exactly what the emitter
// sends: retract to safe Z before any XY travel, rapid to the pass start,
// G1-plunge to the pass depth, feed the pass; same-XY depth chaining skips
// the retract+travel pair. The emitter-agreement property test in
// toolpath-cnc.test.ts locks the two together.

import { circularArcLengthMm, sampleCircularArcPoints } from '../geometry/circular-arc';
import {
  cncContourEmissionVertices,
  parseGrblCncCoordinate,
  type CncContourEmissionVertex,
} from '../cnc/cnc-contour-emission';
import { CNC_COORDINATE_DECIMAL_PLACES } from '../cnc/cnc-output-precision';
import { assertNever, type Vec2 } from '../scene';
import {
  cncHelicalContourPoints,
  cncPassEntryDepthMm,
  cncPassXyPoints,
  type CncGroup,
  type CncPass,
} from './job';
import { dist, polylineLength } from './toolpath-math';
import type { ToolpathStep } from './toolpath-types';

// The initial canvas head retains the legacy 3-decimal approximation. Once a
// CNC pass has run, boundary comparisons use the exact numeric coordinates
// written by the emitter so mixed pass kinds retract/travel/plunge identically.
const XY_EPS = 5e-4;

// Head Z persists ACROSS CNC groups (the emitter tracks one modal Z for the
// whole job), so buildToolpath threads one state through every group. toolId
// is the bit currently in the spindle: a retract belongs to the bit that was
// just cutting, not to the group whose pass comes next (between those two the
// emitter parks and pauses for the change).
export type CncSimState = {
  zMm: number | null;
  toolId: string | undefined;
  headXText: string | null;
  headYText: string | null;
};

export function createCncSimState(): CncSimState {
  return { zMm: null, toolId: undefined, headXText: null, headYText: null };
}

type CncBoundary = { readonly point: Vec2; readonly xText: string; readonly yText: string };

// exactOptionalPropertyTypes: an absent bit must omit the key, not set it to
// undefined. Absent means the machine's active bit.
function toolIdField(toolId: string | undefined): { readonly toolId?: string } {
  return toolId === undefined ? {} : { toolId };
}

export function appendCncGroupSteps(
  steps: ToolpathStep[],
  initialPrevEnd: Vec2 | null,
  group: CncGroup,
  state: CncSimState,
): Vec2 | null {
  let head = initialPrevEnd;
  for (let passIndex = 0; passIndex < group.passes.length; passIndex += 1) {
    const pass = group.passes[passIndex];
    if (pass === undefined) continue;
    head = appendPassSteps(steps, head, pass, passIndex, group, state);
  }
  return head;
}

function appendPassSteps(
  steps: ToolpathStep[],
  head: Vec2 | null,
  pass: CncPass,
  passIndex: number,
  group: CncGroup,
  state: CncSimState,
): Vec2 | null {
  const contourVertices = pass.kind === 'contour' ? cncContourEmissionVertices(pass) : [];
  const xy =
    pass.kind === 'contour' ? contourVertices.map((vertex) => vertex.point) : cncPassXyPoints(pass);
  const first = cncPassRepresentedEntry(pass, contourVertices);
  if (first === undefined || xy.length < 2) return head;
  const safeZ = Math.max(0, group.safeZMm);
  const entryZ = cncPassEntryDepthMm(pass);

  const alreadyAtStart = head !== null && sameXyForPass(head, first, state);
  if (!alreadyAtStart) {
    appendRetract(steps, head, safeZ, state);
    if (head !== null && !sameXyForPass(head, first, state)) {
      steps.push({
        kind: 'travel',
        from: head,
        to: first.point,
        length: dist(head, first.point),
        z: { from: safeZ, to: safeZ },
      });
    }
  }
  if (state.zMm !== entryZ) {
    const fromZ = state.zMm ?? safeZ;
    steps.push({
      kind: 'plunge',
      at: first.point,
      fromZ,
      toZ: entryZ,
      length: Math.abs(fromZ - entryZ),
      ...toolIdField(group.toolId),
    });
    state.zMm = entryZ;
  }
  const cut = cutStepForPass(pass, xy, group, passIndex);
  steps.push({ ...cut, ...toolIdField(group.toolId) });
  state.zMm = passExitZMm(pass);
  state.toolId = group.toolId;
  const exit = cncPassRepresentedExit(pass, contourVertices) ?? first;
  state.headXText = exit.xText;
  state.headYText = exit.yText;
  return exit.point;
}

// The emitter's preamble parks at safe Z from an unknown prior position; the
// simulator has no length for that move, so an unknown Z is adopted as
// "already at safe Z" without emitting a step.
function appendRetract(
  steps: ToolpathStep[],
  head: Vec2 | null,
  safeZ: number,
  state: CncSimState,
): void {
  if (state.zMm === null || head === null) {
    state.zMm = safeZ;
    return;
  }
  if (state.zMm === safeZ) return;
  steps.push({
    kind: 'plunge',
    at: head,
    fromZ: state.zMm,
    toZ: safeZ,
    length: Math.abs(state.zMm - safeZ),
    ...toolIdField(state.toolId),
  });
  state.zMm = safeZ;
}

function cutStepForPass(
  pass: CncPass,
  xy: ReadonlyArray<Vec2>,
  group: CncGroup,
  passIndex: number,
): Extract<ToolpathStep, { kind: 'cut' }> {
  switch (pass.kind) {
    case 'contour':
      return {
        kind: 'cut',
        color: group.color,
        polyline: xy,
        length: polylineLength(xy),
        z: { from: pass.zMm, to: pass.zMm },
        groupId: group.layerId,
        passIndex,
      };
    case 'path3d':
      // The rendered polyline is the XY projection; the arc length is 3D so
      // the scrubber's timing stays honest. Truncation inside this step
      // slightly overshoots the XY head on steep segments — acceptable for a
      // preview (documented in toolpath-slice.ts consumers). zs carries the
      // full Z profile so the simulator can stamp vertex-exact depths.
      return {
        kind: 'cut',
        color: group.color,
        polyline: xy,
        length: path3dLength(pass.points),
        z: {
          from: pass.points[0]?.z ?? 0,
          to: pass.points[pass.points.length - 1]?.z ?? 0,
        },
        zs: pass.points.map((point) => point.z),
        groupId: group.layerId,
        passIndex,
      };
    case 'arc':
      return {
        kind: 'cut',
        color: group.color,
        polyline: sampleCircularArcPoints(pass),
        length: circularArcLengthMm(pass),
        z: { from: pass.zMm, to: pass.zMm },
        groupId: group.layerId,
        passIndex,
      };
    case 'helical-contour': {
      const points = cncHelicalContourPoints(pass);
      const radius = Math.hypot(pass.start.x - pass.center.x, pass.start.y - pass.center.y);
      const helixLength = Math.hypot(
        Math.PI * 2 * radius * Math.max(1, Math.floor(pass.revolutions)),
        pass.zMm - pass.startZMm,
      );
      const first = pass.polyline[0] ?? pass.start;
      return {
        kind: 'cut',
        color: group.color,
        polyline: xy,
        length: helixLength + dist(pass.start, first) + polylineLength(pass.polyline),
        z: { from: pass.startZMm, to: pass.zMm },
        zs: points.map((point) => point.z),
        groupId: group.layerId,
        passIndex,
      };
    }
    default:
      return assertNever(pass, 'CncPass');
  }
}

function passExitZMm(pass: CncPass): number {
  switch (pass.kind) {
    case 'contour':
      return pass.zMm;
    case 'path3d':
      return pass.points[pass.points.length - 1]?.z ?? 0;
    case 'arc':
      return pass.zMm;
    case 'helical-contour':
      return pass.zMm;
    default:
      return assertNever(pass, 'CncPass');
  }
}

function path3dLength(points: ReadonlyArray<{ x: number; y: number; z: number }>): number {
  let len = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
}

function sameXy(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= XY_EPS && Math.abs(a.y - b.y) <= XY_EPS;
}

function sameXyForPass(a: Vec2, b: CncBoundary, state: CncSimState): boolean {
  return state.headXText === null || state.headYText === null
    ? sameXy(a, b.point)
    : state.headXText === b.xText && state.headYText === b.yText;
}

function cncPassRepresentedEntry(
  pass: CncPass,
  vertices: ReadonlyArray<CncContourEmissionVertex>,
): CncBoundary | undefined {
  if (pass.kind === 'contour') return vertices[0];
  switch (pass.kind) {
    case 'path3d':
      return ordinaryRepresentedPoint(pass.points[0]);
    case 'arc':
      return ordinaryRepresentedPoint(pass.start);
    case 'helical-contour':
      return ordinaryRepresentedPoint(pass.start);
    default:
      return assertNever(pass, 'CncPass');
  }
}

function cncPassRepresentedExit(
  pass: CncPass,
  vertices: ReadonlyArray<CncContourEmissionVertex>,
): CncBoundary | undefined {
  if (pass.kind === 'contour') return vertices[vertices.length - 1];
  switch (pass.kind) {
    case 'path3d':
      return ordinaryRepresentedPoint(pass.points[pass.points.length - 1]);
    case 'arc':
      return ordinaryRepresentedPoint(pass.end);
    case 'helical-contour':
      return ordinaryRepresentedPoint(pass.polyline[pass.polyline.length - 1] ?? pass.start);
    default:
      return assertNever(pass, 'CncPass');
  }
}

function ordinaryRepresentedPoint(point: Vec2 | undefined): CncBoundary | undefined {
  if (point === undefined) return undefined;
  const xText = point.x.toFixed(CNC_COORDINATE_DECIMAL_PLACES);
  const yText = point.y.toFixed(CNC_COORDINATE_DECIMAL_PLACES);
  return {
    point: { x: parseGrblCncCoordinate(xText), y: parseGrblCncCoordinate(yText) },
    xText,
    yText,
  };
}
