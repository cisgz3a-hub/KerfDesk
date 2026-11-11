import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  type ControllerKind,
  type DeviceProfile,
  type RotarySetup,
} from '../../core/devices';
import type { RotaryTaper } from '../../core/devices/rotary';
import type { FillGroup, FillSegment } from '../../core/job';
import { assertFillPlanKeepsBurn, planFillSweeps } from '../../core/job/fill-sweep-plan';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

// ADR-694 Amendment 1 (rolling audit v14 Z4-P1-1). A taper warp bends every
// Fill hatch line that is not along the turn into a curve. The Fill planner
// used to drop any run that was not two points, so a 45° Fill on a tapered
// tumbler burned 0.3 % of its area with no warning. Here the emitted program
// is replayed onto the cone: each lit move turns the part by its rotary word
// and moves along the side by X, and its length on the part is
// hypot(dx, r(x)·dθ). The same Fill on an untapered part of the Object
// diameter gives the length the hatch should burn.

const TAPER: RotaryTaper = {
  enabled: true,
  topDiameterMm: 90,
  bottomDiameterMm: 70,
  lengthMm: 100,
  topSide: 'left',
  artworkFromTopMm: 0,
};

type AxisCase = {
  readonly axis: 'Y' | 'A' | 'Z';
  readonly controllerKind: ControllerKind;
  readonly unitsPerTurn: number;
};

const AXES: ReadonlyArray<AxisCase> = [
  { axis: 'Y', controllerKind: 'grbl-v1.1', unitsPerTurn: 40 },
  { axis: 'A', controllerKind: 'grblhal', unitsPerTurn: 360 },
  { axis: 'Z', controllerKind: 'grbl-v1.1', unitsPerTurn: 40 },
];

const HATCHES = [
  { name: '0°', hatchAngleDeg: 0, fillCrossHatch: false },
  { name: '30°', hatchAngleDeg: 30, fillCrossHatch: false },
  { name: '45°', hatchAngleDeg: 45, fillCrossHatch: false },
  { name: '90°', hatchAngleDeg: 90, fillCrossHatch: false },
  { name: 'cross-hatch', hatchAngleDeg: 0, fillCrossHatch: true },
] as const;

// The artwork spans X 20..60 (its runways need room on the bed), and its left
// edge sits at the Ø90 rim.
const LEFT = 20;
function coneRadiusAt(x: number): number {
  return 45 - (10 * Math.min(100, Math.max(0, x - LEFT))) / 100;
}

function rotary(axis: AxisCase, taper: RotaryTaper | undefined): RotarySetup {
  return {
    enabled: true,
    type: 'chuck',
    mmPerRotation: axis.unitsPerTurn,
    objectDiameterMm: 90,
    ...(axis.axis === 'Y' ? {} : { axis: axis.axis }),
    ...(taper === undefined ? {} : { taper }),
  };
}

function fillProject(
  axis: AxisCase,
  hatch: (typeof HATCHES)[number],
  taper: RotaryTaper | undefined,
): Project {
  const square = [
    { x: LEFT, y: 20 },
    { x: LEFT + 40, y: 20 },
    { x: LEFT + 40, y: 60 },
    { x: LEFT, y: 60 },
    { x: LEFT, y: 20 },
  ];
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: LEFT, minY: 20, maxX: LEFT + 40, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ points: square, closed: true }] }],
  };
  const device: DeviceProfile = {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: axis.controllerKind,
    rotary: rotary(axis, taper),
  };
  const base = createProject(device);
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000', mode: 'fill' }),
    hatchAngleDeg: hatch.hatchAngleDeg,
    fillCrossHatch: hatch.fillCrossHatch,
    hatchSpacingMm: 0.5,
  };
  return { ...base, scene: addLayer(addObject(base.scene, obj), layer) };
}

type Modal = { x: number; turn: number; lit: boolean; motion: string; power: number };

/** Applies one line's words to the modal state. */
function applyLine(line: string, state: Modal, axis: AxisCase): void {
  if (/\bM5\b/.test(line)) state.lit = false;
  if (/\bM[34]\b/.test(line)) state.lit = true;
  for (const word of line.match(/[A-Z]-?\d*\.?\d+/g) ?? []) {
    const value = Number(word.slice(1));
    if (word[0] === 'G' && (value === 0 || value === 1)) state.motion = `G${value}`;
    if (word[0] === 'X') state.x = value;
    if (word[0] === axis.axis) state.turn = value;
    if (word[0] === 'S') state.power = value;
  }
}

/** Length of everything the program burns, measured on the part. */
function burnedSurfaceMm(gcode: string, axis: AxisCase, radiusAt: (x: number) => number): number {
  const state: Modal = { x: 0, turn: 0, lit: false, motion: 'G0', power: 0 };
  let total = 0;
  for (const raw of gcode.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (line === '' || /^G92\b/.test(line)) continue;
    const from = { x: state.x, turn: state.turn };
    applyLine(line, state, axis);
    if (state.motion !== 'G1' || !state.lit || !(state.power > 0)) continue;
    const dTheta = ((state.turn - from.turn) / axis.unitsPerTurn) * 2 * Math.PI;
    total += Math.hypot(state.x - from.x, radiusAt((from.x + state.x) / 2) * dTheta);
  }
  return total;
}

/** Lit moves that both run along the part and turn it: an angled hatch. */
function diagonalBurns(gcode: string, axis: AxisCase): number {
  const state: Modal = { x: 0, turn: 0, lit: false, motion: 'G0', power: 0 };
  let count = 0;
  for (const raw of gcode.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (line === '' || /^G92\b/.test(line)) continue;
    const from = { x: state.x, turn: state.turn };
    applyLine(line, state, axis);
    const lit = state.motion === 'G1' && state.lit && state.power > 0;
    if (lit && Math.abs(state.x - from.x) > 0.5 && Math.abs(state.turn - from.turn) > 0.05) {
      count += 1;
    }
  }
  return count;
}

describe('a Fill on a tapered part burns all of its hatch (ADR-694 Amendment 1)', () => {
  for (const axis of AXES) {
    for (const hatch of HATCHES) {
      it(`${hatch.name} on ${axis.axis}`, () => {
        const straight = emitGcode(fillProject(axis, hatch, undefined));
        const tapered = emitGcode(fillProject(axis, hatch, TAPER));
        expect(straight.preflight.issues).toEqual([]);
        expect(tapered.preflight.issues).toEqual([]);
        // The hatch really is at its angle: only 30° and 45° turn while moving.
        const angled = hatch.hatchAngleDeg % 90 !== 0;
        expect(diagonalBurns(straight.gcode, axis) > 20).toBe(angled);
        const wanted = burnedSurfaceMm(straight.gcode, axis, () => 45);
        const burned = burnedSurfaceMm(tapered.gcode, axis, coneRadiusAt);
        // About 3,200 mm of hatch at 0.5 mm in a 40 mm square (twice for a
        // cross-hatch). A row bent round the cone is a little longer than the
        // straight one, never shorter.
        expect(wanted).toBeGreaterThan(hatch.fillCrossHatch ? 6000 : 3000);
        expect(burned / wanted).toBeGreaterThan(0.99);
        expect(burned / wanted).toBeLessThan(1.03);
      });
    }
  }
});

describe('the Fill plan keeps every compiled millimetre', () => {
  function group(segments: ReadonlyArray<FillSegment>): FillGroup {
    return {
      kind: 'fill',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 1000,
      passes: 1,
      airAssist: false,
      overscanMm: 0,
      segments,
    } as unknown as FillGroup;
  }

  it('plans a curved run as one sweep through its points', () => {
    const curve = [
      { x: 0, y: 0 },
      { x: 5, y: 0.2 },
      { x: 10, y: 0.3 },
    ];
    const fill = group([{ polyline: curve, closed: false, reverse: false }]);
    const plans = planFillSweeps(fill);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.sweep.spans[0]).toEqual({
      start: curve[0],
      end: curve[2],
      via: [curve[1]],
    });
    expect(() => assertFillPlanKeepsBurn(fill, plans)).not.toThrow();
  });

  it('stops output when a plan burns less than was compiled', () => {
    const fill = group([
      {
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        closed: false,
        reverse: false,
      },
    ]);
    expect(() => assertFillPlanKeepsBurn(fill, [])).toThrow(
      /Fill layer L1: the planned hatch burns 0\.000 mm of the 10\.000 mm compiled/,
    );
  });
});
