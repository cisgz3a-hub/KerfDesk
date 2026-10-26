// Where the head goes when GRBL runs a simple test program: an independent
// reading after gnea/grbl gcode.c (plane axes, I/J/K offsets, the R-form
// centre) and motion_control.c mc_arc (sweep, linear axis), sharing no code
// with the Inspector. It handles G0 to G3, G17 to G19 and G90/G91 in
// millimetres, which the tests that use it stay within, and samples each arc
// far more finely than mc_arc's chords, so every point the controller visits
// lies on or inside what it returns.

export type ExecutedPoint = { x: number; y: number; z: number };
type Axis = 'x' | 'y' | 'z';
type Word = { readonly letter: string; readonly value: number };
type Plane = { readonly axis0: Axis; readonly axis1: Axis; readonly linear: Axis };

// gcode.c: G17 axis_0 X, axis_1 Y; G18 axis_0 Z, axis_1 X; G19 axis_0 Y, axis_1 Z.
const PLANES: Readonly<Record<number, Plane>> = {
  17: { axis0: 'x', axis1: 'y', linear: 'z' },
  18: { axis0: 'z', axis1: 'x', linear: 'y' },
  19: { axis0: 'y', axis1: 'z', linear: 'x' },
};
const AXIS_WORD: Readonly<Record<Axis, string>> = { x: 'X', y: 'Y', z: 'Z' };
const OFFSET_WORD: Readonly<Record<Axis, string>> = { x: 'I', y: 'J', z: 'K' };
const ARC_ANGULAR_TRAVEL_EPSILON = 5e-7; // grbl/config.h
const SAMPLE_STEP_RAD = Math.PI / 1440;

/** Every point the head passes through, from `start`, in work millimetres. */
export function grblExecutedPoints(gcode: string, start: ExecutedPoint): ExecutedPoint[] {
  const state = { motion: 0, plane: 17, absolute: true };
  let position = { ...start };
  const points = [{ ...position }];
  for (const line of gcode.split('\n')) {
    const words = [...line.toUpperCase().matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)].map(
      (match) => ({ letter: match[1] ?? '', value: Number(match[2]) }),
    );
    for (const word of words) if (word.letter === 'G') applyG(state, word.value);
    if (!words.some((word) => 'XYZ'.includes(word.letter))) continue;
    const target = { ...position };
    for (const axis of ['x', 'y', 'z'] as const) {
      const value = wordValue(words, AXIS_WORD[axis]);
      if (value !== undefined) target[axis] = state.absolute ? value : position[axis] + value;
    }
    const plane = PLANES[state.plane];
    if ((state.motion === 2 || state.motion === 3) && plane !== undefined) {
      points.push(...arcPoints(position, target, words, plane, state.motion === 2));
    } else {
      points.push({ ...target });
    }
    position = target;
  }
  return points;
}

function applyG(state: { motion: number; plane: number; absolute: boolean }, code: number): void {
  if (code >= 0 && code <= 3) state.motion = code;
  else if (code >= 17 && code <= 19) state.plane = code;
  else if (code === 90) state.absolute = true;
  else if (code === 91) state.absolute = false;
}

function wordValue(words: ReadonlyArray<Word>, letter: string): number | undefined {
  return words.find((word) => word.letter === letter)?.value;
}

function arcPoints(
  from: ExecutedPoint,
  target: ExecutedPoint,
  words: ReadonlyArray<Word>,
  plane: Plane,
  clockwise: boolean,
): ExecutedPoint[] {
  const { axis0, axis1, linear } = plane;
  const [offset0, offset1] = arcOffsets(from, target, words, plane, clockwise);
  const center0 = from[axis0] + offset0;
  const center1 = from[axis1] + offset1;
  // mc_arc: r is the centre-to-start vector, rt the centre-to-target vector.
  const r0 = -offset0;
  const r1 = -offset1;
  const rt0 = target[axis0] - center0;
  const rt1 = target[axis1] - center1;
  let travel = Math.atan2(r0 * rt1 - r1 * rt0, r0 * rt0 + r1 * rt1);
  if (clockwise && travel >= -ARC_ANGULAR_TRAVEL_EPSILON) travel -= 2 * Math.PI;
  if (!clockwise && travel <= ARC_ANGULAR_TRAVEL_EPSILON) travel += 2 * Math.PI;
  const radius = Math.hypot(r0, r1);
  const startAngle = Math.atan2(r1, r0);
  const steps = Math.max(1, Math.ceil(Math.abs(travel) / SAMPLE_STEP_RAD));
  const points: ExecutedPoint[] = [];
  for (let step = 1; step < steps; step += 1) {
    const angle = startAngle + (travel * step) / steps;
    const point = { ...from };
    point[axis0] = center0 + radius * Math.cos(angle);
    point[axis1] = center1 + radius * Math.sin(angle);
    point[linear] = from[linear] + ((target[linear] - from[linear]) * step) / steps;
    points.push(point);
  }
  points.push({ ...target }); // mc_arc ends with mc_line(target)
  return points;
}

// gcode.c: offsets are ijk[axis_0] and ijk[axis_1]; R mode solves them with
// h_x2_div_d, negated for G3 and again for a negative R.
function arcOffsets(
  from: ExecutedPoint,
  target: ExecutedPoint,
  words: ReadonlyArray<Word>,
  plane: Plane,
  clockwise: boolean,
): [number, number] {
  const r = wordValue(words, 'R');
  if (r === undefined) {
    return [
      wordValue(words, OFFSET_WORD[plane.axis0]) ?? 0,
      wordValue(words, OFFSET_WORD[plane.axis1]) ?? 0,
    ];
  }
  const x = target[plane.axis0] - from[plane.axis0];
  const y = target[plane.axis1] - from[plane.axis1];
  const square = 4 * r * r - x * x - y * y;
  if (square < 0) throw new Error('GRBL refuses this arc (arc radius error)');
  let h = -Math.sqrt(square) / Math.hypot(x, y);
  if (!clockwise) h = -h;
  if (r < 0) h = -h;
  return [0.5 * (x - y * h), 0.5 * (y + x * h)];
}
