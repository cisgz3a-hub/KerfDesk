// CNC-group toolpath steps (Phase H.2) — mirrors cnc-grbl-strategy's motion
// contract step-for-step so the simulator shows exactly what the emitter
// sends: retract to safe Z before any XY travel, rapid to the pass start,
// G1-plunge to the pass depth, feed the pass; same-XY depth chaining skips
// the retract+travel pair. The emitter-agreement property test in
// toolpath-cnc.test.ts locks the two together.

import { circularArcLengthMm, sampleCircularArcPoints } from '../geometry/circular-arc';
import { assertNever, type Vec2 } from '../scene';
import { cncPassEntryDepthMm, cncPassXyPoints, type CncGroup, type CncPass } from './job';
import { dist, polylineLength } from './toolpath-math';
import type { ToolpathStep } from './toolpath-types';

// The emitter compares coordinates at 3-decimal emit precision; the
// simulator matches its chaining decisions at the same tolerance.
const XY_EPS = 5e-4;

// Head Z persists ACROSS CNC groups (the emitter tracks one modal Z for the
// whole job), so buildToolpath threads one state through every group.
export type CncSimState = { zMm: number | null };

export function createCncSimState(): CncSimState {
  return { zMm: null };
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
  const xy = cncPassXyPoints(pass);
  const first = xy[0];
  if (first === undefined || xy.length < 2) return head;
  const safeZ = Math.max(0, group.safeZMm);
  const entryZ = cncPassEntryDepthMm(pass);

  const alreadyAtStart = head !== null && sameXy(head, first);
  if (!alreadyAtStart) {
    appendRetract(steps, head, safeZ, state);
    if (head !== null && !sameXy(head, first)) {
      steps.push({
        kind: 'travel',
        from: head,
        to: first,
        length: dist(head, first),
        z: { from: safeZ, to: safeZ },
      });
    }
  }
  if (state.zMm !== entryZ) {
    const fromZ = state.zMm ?? safeZ;
    steps.push({ kind: 'plunge', at: first, fromZ, toZ: entryZ, length: Math.abs(fromZ - entryZ) });
    state.zMm = entryZ;
  }
  steps.push(cutStepForPass(pass, xy, group, passIndex));
  state.zMm = passExitZMm(pass);
  return xy[xy.length - 1] ?? first;
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
  });
  state.zMm = safeZ;
}

function cutStepForPass(
  pass: CncPass,
  xy: ReadonlyArray<Vec2>,
  group: CncGroup,
  passIndex: number,
): ToolpathStep {
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
      // preview (documented in toolpath-slice.ts consumers).
      return {
        kind: 'cut',
        color: group.color,
        polyline: xy,
        length: path3dLength(pass.points),
        z: {
          from: pass.points[0]?.z ?? 0,
          to: pass.points[pass.points.length - 1]?.z ?? 0,
        },
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
