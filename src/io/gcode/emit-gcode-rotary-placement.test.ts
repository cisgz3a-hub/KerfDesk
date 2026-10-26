import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
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
import { emitGcode } from './emit-gcode';

// Rolling audit v2 03-P2-3 (ADR-127 Amendment 1): on an active rotary a placed
// job keeps its placement anchor. Rotation is relative, so the anchor's work Y
// is where the cylinder already is; the scale grows the job around it instead
// of turning the cylinder back to work Y 0 first.

const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};
const SCALE = 360 / (Math.PI * 60);

function rectangleProject(rotary: RotarySetup | undefined): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 100, minY: 150, maxX: 140, maxY: 170 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 100, y: 150 },
              { x: 140, y: 150 },
              { x: 140, y: 170 },
              { x: 100, y: 170 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  const base = createProject(
    rotary === undefined ? DEFAULT_DEVICE_PROFILE : { ...DEFAULT_DEVICE_PROFILE, rotary },
  );
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

function burnYRange(gcode: string): { readonly min: number; readonly max: number } {
  const ys = gcode
    .split('\n')
    .filter((line) => /^G1\b/.test(line) && !/\bS0\b/.test(line))
    .flatMap((line) => {
      const match = /Y(-?\d+(?:\.\d+)?)/.exec(line);
      return match === null ? [] : [Number(match[1])];
    });
  return { min: Math.min(...ys), max: Math.max(...ys) };
}

function lastRapid(gcode: string): string | undefined {
  return gcode
    .split('\n')
    .filter((line) => /^G0\b/.test(line))
    .at(-1);
}

const CURRENT_CENTER: JobOriginPlacement = {
  startFrom: 'current-position',
  anchor: 'center',
  currentPosition: { x: 100, y: 80 },
};

describe('rotary output keeps the placement anchor (03-P2-3)', () => {
  it('burns a Current Position job around the head, as the flat bed does', () => {
    const flat = emitGcode(rectangleProject(undefined), { jobOrigin: CURRENT_CENTER });
    const rotary = emitGcode(rectangleProject(CHUCK), { jobOrigin: CURRENT_CENTER });

    expect(burnYRange(flat.gcode).min).toBeCloseTo(70, 3);
    expect(burnYRange(flat.gcode).max).toBeCloseTo(90, 3);
    expect(rotary.preflight.ok).toBe(true);
    const range = burnYRange(rotary.gcode);
    expect(range.min).toBeCloseTo(80 - 10 * SCALE, 2);
    expect(range.max).toBeCloseTo(80 + 10 * SCALE, 2);
    // The finish returns to the start, which is now inside the job.
    expect(lastRapid(rotary.gcode)).toMatch(/Y80\.000/);
  });

  it('keeps User Origin front and back anchors apart', () => {
    const front = emitGcode(rectangleProject(CHUCK), {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    const back = emitGcode(rectangleProject(CHUCK), {
      jobOrigin: { startFrom: 'user-origin', anchor: 'back-left' },
    });

    expect(burnYRange(front.gcode).min).toBeCloseTo(0, 3);
    expect(burnYRange(front.gcode).max).toBeCloseTo(20 * SCALE, 2);
    expect(burnYRange(back.gcode).min).toBeCloseTo(-20 * SCALE, 2);
    expect(burnYRange(back.gcode).max).toBeCloseTo(0, 3);
    expect(back.preflight.issues.filter((issue) => issue.code === 'out-of-bed')).toEqual([]);
  });

  it('mirrors a reversed rotary about the anchor', () => {
    const reversed = emitGcode(rectangleProject({ ...CHUCK, reverseAxis: true }), {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    });

    // The design's front edge stays on the origin; the turn runs the other way.
    expect(burnYRange(reversed.gcode).min).toBeCloseTo(-20 * SCALE, 2);
    expect(burnYRange(reversed.gcode).max).toBeCloseTo(0, 3);
  });

  it('keeps Absolute Coordinates rebased to work Y 0 (ADR-127)', () => {
    const absolute = emitGcode(rectangleProject(CHUCK));

    expect(burnYRange(absolute.gcode).min).toBeCloseTo(0, 3);
    expect(burnYRange(absolute.gcode).max).toBeCloseTo(20 * SCALE, 2);
  });

  it('checks rotary Y by its extent, not its position, with a trusted offset (D3-P3-2)', () => {
    const offset = emitGcode(rectangleProject(CHUCK), {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
      preflightMotionOffset: { x: 0, y: -50 },
    });

    expect(offset.preflight.issues.filter((issue) => issue.code === 'out-of-bed')).toEqual([]);
  });

  it('still warns when a placed rotary job is taller than one turn', () => {
    const small: RotarySetup = { ...CHUCK, objectDiameterMm: 5 };
    const result = emitGcode(rectangleProject(small), {
      jobOrigin: CURRENT_CENTER,
      preflightMotionOffset: { x: 0, y: 0 },
    });

    expect(result.preflight.issues.some((issue) => issue.code === 'out-of-bed')).toBe(true);
  });
});
