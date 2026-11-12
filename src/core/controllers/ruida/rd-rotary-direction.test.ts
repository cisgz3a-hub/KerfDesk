import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../devices';
import { machineSpaceJob, type CutGroup, type Job } from '../../job';
import type { Vec2 } from '../../scene';
import { encodeRdJob } from './rd-encoder';
import { planRdMotion, type RdMotionPart } from './rd-motion-plan';

// Code quality audit C2 verify E3-P2-2 (ADR-127 Amendment 8): the nearest-
// first order of Amendment 7 halved the laser-off travel but turned the rotary
// back more often (60 → 66 a circle, 192 → 374 for 8 rings), and for small
// shapes such as text started more burns against the way the rotary last
// turned (108 → 134 of a cluster's pieces), so the backlash fell inside the
// burn. The pieces now sweep, turn with the laser off, and every burn starts
// the way the rotary goes on. Counted from the encoder's own moves.

const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: 80,
};
const ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 360,
  objectDiameterMm: 80,
  rollerDiameterMm: 25,
};

function ellipse(cx: number, cy: number, rx: number, ry: number, sides: number, turn = 0): Vec2[] {
  return Array.from({ length: sides + 1 }, (_, i) => {
    const a = turn + (i / sides) * 2 * Math.PI;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}

const SHAPES: ReadonlyArray<readonly [string, ReadonlyArray<Vec2[]>]> = [
  ['a Ø30 circle', [ellipse(40, 40, 15, 15, 180)]],
  ['8 rings Ø5', Array.from({ length: 8 }, (_, i) => ellipse(10 + i * 7, 40, 2.5, 2.5, 48))],
  [
    'a text-like cluster of 12 small turned ovals',
    Array.from({ length: 12 }, (_, i) =>
      ellipse(10 + (i % 6) * 5, 30 + Math.floor(i / 6) * 7, 1.8, 2.6, 24, i * 0.7),
    ),
  ],
];

function job(polylines: ReadonlyArray<Vec2[]>): Job {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#ff0000',
    power: 40,
    speed: 600,
    passes: 1,
    airAssist: false,
    segments: polylines.map((polyline) => ({ polyline, closed: true })),
  };
  return { groups: [group] };
}

type Motion = {
  /** Every sign change of Y over every move. */
  readonly reversals: number;
  /** Sign changes on a lit move. */
  readonly litReversals: number;
  /** Lit runs whose first move turns the rotary against its last way. */
  readonly against: number;
  readonly runs: number;
  /** Every lit move as an undirected µm edge. */
  readonly edges: ReadonlyArray<string>;
};

function motionOf(parts: ReadonlyArray<RdMotionPart>): Motion {
  let reversals = 0;
  let litReversals = 0;
  let against = 0;
  let runs = 0;
  let dir = 0;
  let lit = false;
  let at: { xUm: number; yUm: number } | null = null;
  const edges: string[] = [];
  for (const part of parts) {
    for (const step of part.steps) {
      if (at !== null) {
        const startsRun = step.cut && !lit;
        if (startsRun) runs += 1;
        if (step.cut)
          edges.push([`${at.xUm},${at.yUm}`, `${step.xUm},${step.yUm}`].sort().join('|'));
        const way = Math.sign(step.yUm - at.yUm);
        if (way !== 0) {
          if (dir !== 0 && way !== dir) {
            reversals += 1;
            if (step.cut) litReversals += 1;
            if (startsRun) against += 1;
          }
          dir = way;
        }
        lit = step.cut;
      }
      at = step;
    }
  }
  return { reversals, litReversals, against, runs, edges: edges.sort() };
}

describe('a Ruida rotary layer keeps the rotary turning one way (ADR-127 Amd 8)', () => {
  for (const [rotaryName, rotary] of [
    ['40 mm/turn chuck, Ø80 glass', CHUCK],
    ['k = 4.58 roller', ROLLER],
  ] as const) {
    it.each(SHAPES)(`%s on a ${rotaryName}`, (_name, shape) => {
      const device = {
        ...DEFAULT_DEVICE_PROFILE,
        controllerKind: 'ruida' as const,
        maxFeed: 6000,
        rotary,
      };
      const machineJob = machineSpaceJob(job(shape), device, undefined);
      const planned = planRdMotion(machineJob.groups as CutGroup[]);
      const flat = motionOf(planned);
      const encoded = encodeRdJob(machineJob, device);
      if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
      const rotaryMotion = motionOf(encoded.motion);

      expect(encoded.motion.length).toBeGreaterThan(1);
      // Every stroke burns once, from either end.
      expect(rotaryMotion.edges).toEqual(flat.edges);
      // No burn starts against the way the rotary last turned.
      expect(rotaryMotion.against).toBe(0);
      // A lit move turns the rotary no more often than on the flat bed.
      expect(rotaryMotion.litReversals).toBeLessThanOrEqual(flat.reversals);
      // The auditor's bound: no more turns than the flat bed's for each part.
      expect(rotaryMotion.reversals).toBeLessThanOrEqual(flat.reversals * encoded.motion.length);
      // An approach never runs outside the shape's own extent.
      const plannedBounds = planned[0]?.bounds;
      for (const part of encoded.motion) {
        expect(part.bounds.minY).toBeGreaterThanOrEqual(plannedBounds?.minY ?? 0);
        expect(part.bounds.maxY).toBeLessThanOrEqual(plannedBounds?.maxY ?? 0);
      }
    });
  }

  it('turns the rotary back fewer times than nearest-first did on text-like shapes', () => {
    // E3 measured 272 turns and 109 burns started against the rotary for this
    // kind of cluster under nearest first; the sweep turns about half as often.
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'ruida' as const,
      maxFeed: 6000,
      rotary: CHUCK,
    };
    const shape = SHAPES[2]?.[1] ?? [];
    const encoded = encodeRdJob(machineSpaceJob(job(shape), device, undefined), device);
    if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
    expect(motionOf(encoded.motion).reversals).toBeLessThan(160);
  });
});
