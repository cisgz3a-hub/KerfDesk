import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, rotaryYScale, type RotarySetup } from '../../devices';
import { machineSpaceJob, type CutGroup, type Job } from '../../job';
import type { Vec2 } from '../../scene';
import { decodeRdStream } from '../../../__fixtures__/controllers/ruida-decoder';
import { encodeRdJob } from './rd-encoder';

// Code quality audit C2 D2-P1-2 (ADR-127 Amendment 5): a Ruida .rd file on a
// Y-port rotary wrote one speed per layer, so strokes round the part moved the
// surface at speed ÷ k: 15.9 % of the set dose round an Ø80 glass in a 40 mm
// per turn chuck, 458 % round an Ø25 pen in a 360 mm per turn chuck. The file
// is decoded by the meerk40t-faithful test decoder and each cut's surface
// speed worked out from its layer speed and the rotary's scale alone.

const LAYER_SPEED = 1500;

const SETUPS: ReadonlyArray<readonly [string, RotarySetup]> = [
  [
    '40 mm/turn chuck, Ø80 glass',
    { enabled: true, type: 'chuck', mmPerRotation: 40, objectDiameterMm: 80 },
  ],
  [
    '360 mm/turn chuck, Ø25 pen',
    { enabled: true, type: 'chuck', mmPerRotation: 360, objectDiameterMm: 25 },
  ],
  [
    '40 mm/turn chuck reversed',
    { enabled: true, type: 'chuck', mmPerRotation: 40, objectDiameterMm: 80, reverseAxis: true },
  ],
];

function circle(cx: number, cy: number, r: number): Vec2[] {
  return Array.from({ length: 49 }, (_, i) => {
    const a = (i / 48) * 2 * Math.PI;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function surfaceJob(): Job {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#ff0000',
    power: 40,
    speed: LAYER_SPEED,
    passes: 1,
    airAssist: false,
    segments: [
      {
        polyline: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 20 },
          { x: 10, y: 20 },
          { x: 10, y: 10 },
        ],
        closed: true,
      },
      { polyline: circle(50, 15, 5), closed: true },
    ],
  };
  return { groups: [group] };
}

function device(rotary: RotarySetup | undefined) {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'ruida' as const,
    maxFeed: 20000,
    ...(rotary === undefined ? {} : { rotary }),
  };
}

function encode(rotary: RotarySetup | undefined) {
  const machine = device(rotary);
  const job = machineSpaceJob(surfaceJob(), machine, undefined);
  const encoded = encodeRdJob(job, machine);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
  return encoded;
}

/** Surface mm/min of every decoded cut longer than 0.25 machine mm. */
function surfaceSpeeds(bytes: Uint8Array, k: number): number[] {
  const speeds: number[] = [];
  let layerSpeed = Number.NaN;
  let at: { x: number; y: number } | null = null;
  for (const event of decodeRdStream(bytes)) {
    if (event.kind === 'layer-speed') layerSpeed = event.mmPerMin;
    if (event.kind !== 'move' && event.kind !== 'cut') continue;
    const to = { x: event.xMm, y: event.yMm };
    if (event.kind === 'cut' && at !== null) {
      const machineMm = Math.hypot(to.x - at.x, to.y - at.y);
      if (machineMm >= 0.25) {
        const surfaceMm = Math.hypot(to.x - at.x, (to.y - at.y) / k);
        speeds.push((layerSpeed * surfaceMm) / machineMm);
      }
    }
    at = to;
  }
  return speeds;
}

type UmStep = { readonly xUm: number; readonly yUm: number; readonly cut?: boolean };

const toUm = (point: Vec2): UmStep => ({ xUm: point.x * 1000, yUm: point.y * 1000 });

/** Length of a polyline, or of only its cut steps when `cutsOnly`. */
function lengthUm(steps: ReadonlyArray<UmStep>, cutsOnly = false): number {
  let length = 0;
  for (let i = 1; i < steps.length; i += 1) {
    const [a, b] = [steps[i - 1], steps[i]];
    if (a === undefined || b === undefined || (cutsOnly && b.cut !== true)) continue;
    length += Math.hypot(b.xUm - a.xUm, b.yUm - a.yUm);
  }
  return length;
}

/** Burned length of a whole file: the head carries across parts, as the file runs them. */
function burnedUm(parts: ReadonlyArray<{ readonly steps: ReadonlyArray<UmStep> }>): number {
  return lengthUm(
    parts.flatMap((part) => part.steps),
    true,
  );
}

describe('a Ruida rotary file moves the surface at the layer speed (ADR-127 Amd 5)', () => {
  it.each(SETUPS)('%s', (_name, rotary) => {
    const encoded = encode(rotary);
    const speeds = surfaceSpeeds(encoded.bytes, rotaryYScale(rotary));
    expect(speeds.length).toBeGreaterThanOrEqual(40);
    for (const speed of speeds) {
      // Speed classes 5 % apart: every stroke within 2.5 % of the set speed.
      expect(speed / LAYER_SPEED).toBeGreaterThan(0.974);
      expect(speed / LAYER_SPEED).toBeLessThan(1.026);
    }
    expect(encoded.motion.length).toBeGreaterThan(1);
    expect(encoded.motion.length).toBeLessThanOrEqual(100);
    expect(encoded.rotaryDose?.minDose).toBeGreaterThan(0.97);
    expect(encoded.rotaryDose?.maxDose).toBeLessThan(1.03);
  });

  it('leaves a job without a scaled rotary as one part per layer, with no dose note', () => {
    // Flat-bed bytes are pinned by rd-encoder-golden.test.ts; a surface-calibrated
    // roller (k = 1) is rebased in Y like any rotary but keeps its one speed.
    for (const rotary of [
      undefined,
      { enabled: true, type: 'roller', mmPerRotation: 360, objectDiameterMm: 80 } as const,
    ]) {
      const encoded = encode(rotary);
      expect(encoded.motion).toHaveLength(1);
      expect(encoded.rotaryDose).toBeUndefined();
      expect(decodeRdStream(encoded.bytes).filter((e) => e.kind === 'layer-speed')).toEqual([
        { kind: 'layer-speed', mmPerMin: LAYER_SPEED },
      ]);
    }
  });

  it('burns the first edge of a layer that starts where the last one ended', () => {
    // Audit of the last 200 PRs (#1762): the plan writes no travel when a
    // layer starts at the head, so the part opens with a cut, which the speed
    // classes read as a bare position and dropped.
    const square = (surfaceJob().groups[0] as CutGroup).segments[0];
    if (square === undefined) throw new Error('fixture');
    const layer = (layerId: string): CutGroup => ({
      ...(surfaceJob().groups[0] as CutGroup),
      layerId,
      segments: [square],
    });
    const machine = device(SETUPS[0]?.[1]);
    const job = machineSpaceJob({ groups: [layer('score'), layer('cut')] }, machine, undefined);
    const encoded = encodeRdJob(job, machine);
    if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
    const [machineSquare] = (job.groups[0] as CutGroup).segments;
    const perimeterUm = lengthUm((machineSquare?.polyline ?? []).map(toUm));
    expect(burnedUm(encoded.motion)).toBeCloseTo(2 * perimeterUm, -1);
  });

  it('refuses a rotary job that needs more parts than a Ruida file holds', () => {
    const many: Job = {
      groups: Array.from({ length: 30 }, (_, i) => ({
        ...(surfaceJob().groups[0] as CutGroup),
        layerId: `L${i}`,
      })),
    };
    const machine = device(SETUPS[0]?.[1]);
    const result = encodeRdJob(machineSpaceJob(many, machine, undefined), machine);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('rotary-too-many-speeds');
  });
});
