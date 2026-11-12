import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../devices';
import { estimateJobDuration } from '../../job/estimate-duration';
import { machineSpaceJob, type CutGroup, type Job } from '../../job';
import type { Vec2 } from '../../scene';
import { encodeRdJob } from './rd-encoder';
import type { RdMotionPart } from './rd-motion-plan';
import { ruidaRotaryTimingProgram } from './rd-rotary-timing';

// Code quality audit C2 verify E1-P2-2 (ADR-127 Amendment 7): the .rd speed
// classes burned a Ø30 circle on a 40 mm/turn chuck round an Ø80 glass in 30
// parts, path order lost, with 1,526 mm of laser-off travel, and the ETA
// (timed from the G-code) said 11.0 s for a 43.6 s job. Pieces now burn
// nearest first, each from its nearer end, and the ETA times the .rd route.

const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: 80,
};

function circle(cx: number, cy: number, r: number): Vec2[] {
  return Array.from({ length: 97 }, (_, i) => {
    const a = (i / 96) * 2 * Math.PI;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function circleJob(): Job {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#ff0000',
    power: 40,
    speed: 1500,
    passes: 1,
    airAssist: false,
    segments: [{ polyline: circle(40, 40, 15), closed: true }],
  };
  return { groups: [group] };
}

const DEVICE = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' as const, maxFeed: 20000 };

function routeOf(rotary: RotarySetup | undefined) {
  const device = rotary === undefined ? DEVICE : { ...DEVICE, rotary };
  const job = machineSpaceJob(circleJob(), device, undefined);
  const encoded = encodeRdJob(job, device);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
  return { job, device, motion: encoded.motion };
}

/** Every cut as an undirected µm edge, and the laser-off travel in mm. */
function walk(parts: ReadonlyArray<RdMotionPart>) {
  const edges: string[] = [];
  let travelMm = 0;
  let at: { xUm: number; yUm: number } | null = null;
  for (const part of parts) {
    for (const step of part.steps) {
      if (at !== null) {
        const ends = [`${at.xUm},${at.yUm}`, `${step.xUm},${step.yUm}`].sort();
        if (step.cut) edges.push(ends.join('|'));
        else travelMm += Math.hypot(step.xUm - at.xUm, step.yUm - at.yUm) / 1000;
      }
      at = step;
    }
  }
  return { edges: edges.sort(), travelMm };
}

function cutLengthMm(parts: ReadonlyArray<RdMotionPart>): number {
  let length = 0;
  let at: { xUm: number; yUm: number } | null = null;
  for (const part of parts) {
    for (const step of part.steps) {
      if (at !== null && step.cut)
        length += Math.hypot(step.xUm - at.xUm, step.yUm - at.yUm) / 1000;
      at = step;
    }
  }
  return length;
}

describe('a Ruida rotary circle burns in a short route (ADR-127 Amd 7)', () => {
  it('burns every stroke of the circle once, in a few parts', () => {
    const rotary = routeOf(CHUCK);
    const { edges } = walk(rotary.motion);
    expect(edges).toHaveLength(96);
    expect(new Set(edges).size).toBe(96);
    const group = rotary.job.groups[0] as CutGroup;
    const points = group.segments[0]?.polyline ?? [];
    const machineLength = points
      .slice(1)
      .reduce(
        (sum, p, i) => sum + Math.hypot(p.x - (points[i]?.x ?? 0), p.y - (points[i]?.y ?? 0)),
        0,
      );
    expect(cutLengthMm(rotary.motion)).toBeCloseTo(machineLength, 1);
    expect(rotary.motion.length).toBeLessThanOrEqual(30);
  });

  it('keeps the laser-off travel short: under 600 mm, not 1,526 mm', () => {
    const { travelMm } = walk(routeOf(CHUCK).motion);
    expect(travelMm).toBeLessThan(600);
  });

  it('times the .rd route, travel included, not the G-code', () => {
    const { job, device } = routeOf(CHUCK);
    const route = ruidaRotaryTimingProgram(job, device);
    expect(route).toBeDefined();
    const gcodeEta = estimateJobDuration(job, device);
    const routeEta = estimateJobDuration(job, device, { gcode: route ?? '' });
    expect(routeEta.breakdown.travelSeconds).toBeGreaterThan(gcodeEta.breakdown.travelSeconds);
    expect(routeEta.totalSeconds).toBeGreaterThan(gcodeEta.totalSeconds);
    // The same strokes, but each piece stops at its ends, so never less cut time.
    expect(routeEta.breakdown.cutSeconds).toBeGreaterThan(gcodeEta.breakdown.cutSeconds * 0.95);
  });

  it('leaves the ETA of a flat or non-Ruida job to the G-code', () => {
    const flat = routeOf(undefined);
    expect(ruidaRotaryTimingProgram(flat.job, flat.device)).toBeUndefined();
    const grbl = { ...DEVICE, controllerKind: 'grbl-v1.1' as const, rotary: CHUCK };
    expect(
      ruidaRotaryTimingProgram(machineSpaceJob(circleJob(), grbl, undefined), grbl),
    ).toBeUndefined();
  });
});
