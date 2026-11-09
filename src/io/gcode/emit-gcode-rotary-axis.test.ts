import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  type ControllerKind,
  type DeviceProfile,
  type RotarySetup,
} from '../../core/devices';
import type { JobOriginPlacement } from '../../core/job';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitRdFile } from '../rd/emit-rd';
import { emitGcode } from './emit-gcode';

// ADR-693: a rotary on a dedicated A or Z axis. The turn goes out under that
// letter, zeroed first with G92, and the head's Y is never commanded. A Y-port
// rotary (GRBL Y swap) keeps its bytes.

const DIAMETER = 60;
const CIRCUMFERENCE = Math.PI * DIAMETER;
// A degree-counting A axis: 360 commanded units turn the chuck once.
const A_CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  axis: 'A',
  mmPerRotation: 360,
  objectDiameterMm: DIAMETER,
};
const { axis: _a, ...A_CHUCK_ON_Y } = A_CHUCK;
const Y_CHUCK: RotarySetup = { ...A_CHUCK_ON_Y, mmPerRotation: 40 };
const DEG_PER_MM = 360 / CIRCUMFERENCE;

function project(rotary: RotarySetup, controllerKind: ControllerKind, heightMm = 20): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 100, minY: 150, maxX: 140, maxY: 150 + heightMm },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 100, y: 150 },
              { x: 140, y: 150 },
              { x: 140, y: 150 + heightMm },
              { x: 100, y: 150 + heightMm },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind, rotary };
  const base = createProject(device);
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

function codeLines(gcode: string): string[] {
  return gcode
    .split('\n')
    .map((line) => line.replace(/;.*$/, '').trim())
    .filter((line) => line !== '');
}

function wordValues(gcode: string, letter: string): number[] {
  const pattern = new RegExp(`${letter}(-?\\d+(?:\\.\\d+)?)`);
  return codeLines(gcode).flatMap((line) => {
    if (line.startsWith('G92')) return [];
    const match = pattern.exec(line);
    return match === null ? [] : [Number(match[1])];
  });
}

function span(values: ReadonlyArray<number>): { min: number; max: number } {
  return { min: Math.min(...values), max: Math.max(...values) };
}

const CURRENT_CENTER: JobOriginPlacement = {
  startFrom: 'current-position',
  anchor: 'center',
  currentPosition: { x: 100, y: 80 },
};

describe('rotary on a dedicated A axis, simulated grblHAL', () => {
  it('turns the part on A in degrees, zeroed first, and never moves the head in Y', () => {
    const out = emitGcode(project(A_CHUCK, 'grblhal'));
    expect(out.preflight.ok).toBe(true);
    const lines = codeLines(out.gcode);
    expect(lines[0]).toBe('G92 A0');
    expect(wordValues(out.gcode, 'Y')).toEqual([]);
    const a = span(wordValues(out.gcode, 'A'));
    expect(a.min).toBeCloseTo(0, 3);
    expect(a.max).toBeCloseTo(20 * DEG_PER_MM, 2);
    // The Absolute park returns to work zero, X0 A0; the burn stays on X 100-140.
    const burnX = codeLines(out.gcode)
      .filter((line) => line.startsWith('G1'))
      .join('\n');
    expect(span(wordValues(burnX, 'X'))).toEqual({ min: 100, max: 140 });
  });

  it('turns exactly once for artwork one circumference tall', () => {
    const out = emitGcode(project(A_CHUCK, 'grblhal', CIRCUMFERENCE));
    const a = span(wordValues(out.gcode, 'A'));
    expect(a.max - a.min).toBeCloseTo(360, 2);
  });

  it("puts a Current Position job's anchor at the part's current turn, A 0", () => {
    const out = emitGcode(project(A_CHUCK, 'grblhal'), { jobOrigin: CURRENT_CENTER });
    const a = span(wordValues(out.gcode, 'A'));
    expect(a.min).toBeCloseTo(-10 * DEG_PER_MM, 2);
    expect(a.max).toBeCloseTo(10 * DEG_PER_MM, 2);
    // The finish turns the part back to where it started; Y stays untouched.
    expect(
      codeLines(out.gcode)
        .filter((line) => line.startsWith('G0'))
        .at(-1),
    ).toMatch(/A0\.000/);
    expect(wordValues(out.gcode, 'Y')).toEqual([]);
  });

  it('is the Y-port program with the turn renamed, line for line', () => {
    const onA = emitGcode(project(A_CHUCK, 'grblhal'), { jobOrigin: CURRENT_CENTER });
    const onY = emitGcode(project(A_CHUCK_ON_Y, 'grblhal'), {
      jobOrigin: { ...CURRENT_CENTER, currentPosition: { x: 100, y: 0 } },
    });
    const renamed = codeLines(onA.gcode)
      .slice(1)
      .map((line) => line.replace(/A(?=-?[\d.])/g, 'Y'));
    expect(renamed).toEqual(codeLines(onY.gcode));
  });

  it('runs on FluidNC too, and on Z where a GRBL build routes Z to the rotary', () => {
    expect(codeLines(emitGcode(project(A_CHUCK, 'fluidnc')).gcode)[0]).toBe('G92 A0');
    const z = emitGcode(project({ ...A_CHUCK, axis: 'Z', mmPerRotation: 40 }, 'grbl-v1.1'));
    expect(z.preflight.ok).toBe(true);
    expect(codeLines(z.gcode)[0]).toBe('G92 Z0');
    expect(wordValues(z.gcode, 'Y')).toEqual([]);
    expect(wordValues(z.gcode, 'Z').length).toBeGreaterThan(0);
  });
});

describe('controllers without the axis get no program', () => {
  it.each([
    ['grbl-v1.1', 'A'],
    ['marlin', 'Z'],
    ['smoothieware', 'A'],
  ] as const)('%s refuses a rotary on %s', (controllerKind, axis) => {
    const out = emitGcode(project({ ...A_CHUCK, axis }, controllerKind));
    expect(out.gcode).toBe('');
    expect(out.preflight.ok).toBe(false);
    expect(out.preflight.issues.map((issue) => issue.code)).toEqual(['rotary-axis-unexecutable']);
  });

  it('refuses a Ruida .rd file for a dedicated axis', () => {
    const out = emitRdFile(project(A_CHUCK, 'ruida'));
    expect(out.ok).toBe(false);
  });
});

describe('a Y-port rotary (GRBL Y swap) keeps its bytes', () => {
  it('emits the same program with axis Y written out or absent', () => {
    const absent = emitGcode(project(Y_CHUCK, 'grbl-v1.1'), { jobOrigin: CURRENT_CENTER });
    const explicit = emitGcode(project({ ...Y_CHUCK, axis: 'Y' }, 'grbl-v1.1'), {
      jobOrigin: CURRENT_CENTER,
    });
    expect(explicit.gcode).toBe(absent.gcode);
    expect(absent.gcode).not.toMatch(/G92/);
    const y = span(wordValues(absent.gcode, 'Y'));
    const scale = 40 / CIRCUMFERENCE;
    expect(y.min).toBeCloseTo(80 - 10 * scale, 2);
    expect(y.max).toBeCloseTo(80 + 10 * scale, 2);
    expect(wordValues(absent.gcode, 'A')).toEqual([]);
  });
});
