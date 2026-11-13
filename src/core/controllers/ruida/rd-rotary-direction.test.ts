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
  /** Of those, the ones that start inside the shape's Y extent, not on its edge. */
  readonly againstInside: number;
  /** Laser-off travel in mm. */
  readonly travelMm: number;
  readonly runs: number;
  /** Every lit move as an undirected µm edge. */
  readonly edges: ReadonlyArray<string>;
};

type Tally = {
  reversals: number;
  litReversals: number;
  against: number;
  againstInside: number;
  travelMm: number;
  runs: number;
  dir: number;
  lit: boolean;
};
type Edges = { readonly minY: number; readonly maxY: number };
type Point = { readonly xUm: number; readonly yUm: number };

function motionOf(
  parts: ReadonlyArray<RdMotionPart>,
  edges: Edges = { minY: NaN, maxY: NaN },
): Motion {
  const tally: Tally = {
    reversals: 0,
    litReversals: 0,
    against: 0,
    againstInside: 0,
    travelMm: 0,
    runs: 0,
    dir: 0,
    lit: false,
  };
  let at: Point | null = null;
  const cutEdges: string[] = [];
  for (const part of parts) {
    for (const step of part.steps) {
      if (at !== null) {
        if (step.cut)
          cutEdges.push([`${at.xUm},${at.yUm}`, `${step.xUm},${step.yUm}`].sort().join('|'));
        countMove(tally, at, step, edges);
      }
      at = step;
    }
  }
  const { dir: _dir, lit: _lit, ...counts } = tally;
  return { ...counts, edges: cutEdges.sort() };
}

/** Adds one move from `at` to `step` to the tally. */
function countMove(
  tally: Tally,
  at: Point,
  step: RdMotionPart['steps'][number],
  edges: Edges,
): void {
  const startsRun = step.cut && !tally.lit;
  if (startsRun) tally.runs += 1;
  const way = Math.sign(step.yUm - at.yUm);
  if (way !== 0) {
    if (tally.dir !== 0 && way !== tally.dir) {
      tally.reversals += 1;
      if (step.cut) tally.litReversals += 1;
      if (startsRun) {
        tally.against += 1;
        if (at.yUm !== edges.minY && at.yUm !== edges.maxY) tally.againstInside += 1;
      }
    }
    tally.dir = way;
  }
  if (!step.cut) tally.travelMm += Math.hypot(step.xUm - at.xUm, step.yUm - at.yUm) / 1000;
  tally.lit = step.cut;
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

  // C2 verify E4-P3-2 (ADR-127 Amd 9): a stroke that starts on the shape's Y
  // edge cannot be reached past its start without leaving the shape's
  // extent, which the approach never does. A rectangle's sides, or a border
  // round text, may still start against the rotary there, and only there.
  const RECTANGLE: Vec2[] = [
    { x: 5, y: 25 },
    { x: 55, y: 25 },
    { x: 55, y: 45 },
    { x: 5, y: 45 },
    { x: 5, y: 25 },
  ];
  const BORDERED: ReadonlyArray<Vec2[]> = [
    RECTANGLE,
    ...Array.from({ length: 6 }, (_, i) =>
      ellipse(18 + (i % 3) * 12, 32 + Math.floor(i / 3) * 8, 2.5, 2.5, 48),
    ),
  ];
  for (const [rotaryName, rotary] of [
    ['chuck', CHUCK],
    ['roller', ROLLER],
  ] as const) {
    it.each([
      ['a rectangle', [RECTANGLE]],
      ['rings inside a border', BORDERED],
    ] as const)(
      `%s on a ${rotaryName} starts against the rotary only at its Y edge`,
      (_n, shape) => {
        const device = {
          ...DEFAULT_DEVICE_PROFILE,
          controllerKind: 'ruida' as const,
          maxFeed: 6000,
          rotary,
        };
        const machineJob = machineSpaceJob(job(shape), device, undefined);
        const planned = planRdMotion(machineJob.groups as CutGroup[]);
        const encoded = encodeRdJob(machineJob, device);
        if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
        const motion = motionOf(encoded.motion, planned[0]?.bounds);
        expect(motion.edges).toEqual(motionOf(planned).edges);
        expect(motion.againstInside).toBe(0);
        expect(motion.against).toBeLessThanOrEqual(2);
      },
    );
  }

  // C2 verify E4-P3-3 (ADR-127 Amd 9): on a k > 1 roller a two-row cluster's
  // sweep crossed the whole, k-times-taller Y range on every pass: 4,639 mm of
  // laser-off travel against 3,863 mm in path order. A layer now keeps its
  // pieces' own order when the sweep would travel more than 5 % further.
  it('keeps a two-row cluster on a roller near its path-order travel', () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'ruida' as const,
      maxFeed: 6000,
      rotary: ROLLER,
    };
    const grid = Array.from({ length: 8 }, (_, i) =>
      ellipse(10 + (i % 4) * 8, 30 + Math.floor(i / 4) * 8, 2.5, 2.5, 48),
    );
    const machineJob = machineSpaceJob(job(grid), device, undefined);
    const planned = planRdMotion(machineJob.groups as CutGroup[]);
    const encoded = encodeRdJob(machineJob, device);
    if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
    const motion = motionOf(encoded.motion, planned[0]?.bounds);
    expect(motion.edges).toEqual(motionOf(planned).edges);
    expect(motion.travelMm).toBeLessThan(4300);
    expect(motion.against).toBe(0);
  });
});
