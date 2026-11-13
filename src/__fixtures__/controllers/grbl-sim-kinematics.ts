// grbl-sim-kinematics — an opt-in motion clock for the GRBL simulator (code
// quality audit C2, D3-P3-7). Without it every move takes the fixed
// `motionMs` and the head is reported at the move's end the moment its line is
// parsed, so no test can see a move in progress or a stop part way along it.
//
// With `kinematic: true` each queued move takes its length over its feed (G0
// at the slower of `$110`/`$111`), moves run one after another, a `?` report
// gives the position along the current move, and a soft reset leaves the head
// where the steppers stopped (GRBL keeps sys_position through a reset;
// protocol.c mc_reset). Acceleration is not modelled: every move runs at its
// feed from start to end. A feed hold does not pause this clock (the fixed-time
// model's moves do not pause either).

import type { SimVec3 } from './grbl-sim-gcode';

type Segment = {
  readonly from: SimVec3;
  readonly to: SimVec3;
  readonly startMs: number;
  readonly endMs: number;
  /** Arc centre and direction for a G2/G3 move, for positions along it. */
  readonly arc?: { readonly centre: SimVec3; readonly clockwise: boolean };
};

export type GrblSimKinematicClock = {
  /** Queue a move; returns how long from now it ends, in ms. */
  readonly addMove: (move: KinematicMove, nowMs: number) => number;
  /** The position at `nowMs`, or null when nothing is queued. */
  readonly positionAt: (nowMs: number) => SimVec3 | null;
  /** Stop every queued move at `nowMs` and return where the head is. */
  readonly stopAt: (nowMs: number) => SimVec3 | null;
};

export type KinematicMove = {
  readonly from: SimVec3;
  readonly to: SimVec3;
  readonly feedMmPerMin: number;
  /** G2/G3: the centre offset from `from` (I, J) and the direction. */
  readonly arc?: { readonly i: number; readonly j: number; readonly clockwise: boolean };
};

export function createKinematicClock(): GrblSimKinematicClock {
  let segments: Segment[] = [];
  const positionAt = (nowMs: number): SimVec3 | null => {
    const current = segments.find((segment) => segment.endMs > nowMs) ?? segments.at(-1);
    if (current === undefined) return null;
    if (nowMs >= current.endMs) return current.to;
    if (nowMs <= current.startMs) return current.from;
    const t = (nowMs - current.startMs) / (current.endMs - current.startMs);
    return pointAlong(current, t);
  };
  return {
    addMove: (move, nowMs) => {
      const startMs = Math.max(nowMs, segments.at(-1)?.endMs ?? nowMs);
      const lengthMm = moveLengthMm(move);
      const durationMs =
        move.feedMmPerMin > 0 && lengthMm > 0 ? (lengthMm / move.feedMmPerMin) * 60_000 : 0;
      const endMs = startMs + durationMs;
      segments.push({
        from: move.from,
        to: move.to,
        startMs,
        endMs,
        ...(move.arc === undefined
          ? {}
          : {
              arc: {
                centre: { x: move.from.x + move.arc.i, y: move.from.y + move.arc.j, z: 0 },
                clockwise: move.arc.clockwise,
              },
            }),
      });
      return endMs - nowMs;
    },
    positionAt,
    stopAt: (nowMs) => {
      const position = positionAt(nowMs);
      segments = [];
      return position;
    },
  };
}

function moveLengthMm(move: KinematicMove): number {
  const dz = move.to.z - move.from.z;
  if (move.arc === undefined) {
    return Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y, dz);
  }
  const { radius, sweep } = arcGeometry(move.from, move.to, move.arc);
  return Math.hypot(radius * sweep, dz);
}

function arcGeometry(
  from: SimVec3,
  to: SimVec3,
  arc: { readonly i: number; readonly j: number; readonly clockwise: boolean },
): { readonly radius: number; readonly startAngle: number; readonly sweep: number } {
  const cx = from.x + arc.i;
  const cy = from.y + arc.j;
  const radius = Math.hypot(arc.i, arc.j);
  const startAngle = Math.atan2(from.y - cy, from.x - cx);
  const endAngle = Math.atan2(to.y - cy, to.x - cx);
  const turn = 2 * Math.PI;
  let sweep = arc.clockwise ? startAngle - endAngle : endAngle - startAngle;
  sweep = ((sweep % turn) + turn) % turn;
  // Equal start and end make a full circle (gcode.c's arc of 2π).
  if (sweep < 1e-9) sweep = turn;
  return { radius, startAngle, sweep };
}

function pointAlong(segment: Segment, t: number): SimVec3 {
  const z = segment.from.z + (segment.to.z - segment.from.z) * t;
  if (segment.arc === undefined) {
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * t,
      y: segment.from.y + (segment.to.y - segment.from.y) * t,
      z,
    };
  }
  const { centre, clockwise } = segment.arc;
  const { radius, startAngle, sweep } = arcGeometry(segment.from, segment.to, {
    i: centre.x - segment.from.x,
    j: centre.y - segment.from.y,
    clockwise,
  });
  const angle = startAngle + (clockwise ? -1 : 1) * sweep * t;
  return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle), z };
}

/** G2/G3 centre offsets (I, J) on a line, or null when it names neither. */
export function arcCentreOffset(line: string): { readonly i: number; readonly j: number } | null {
  const i = /I(-?\d*\.?\d+)/i.exec(line);
  const j = /J(-?\d*\.?\d+)/i.exec(line);
  if (i === null && j === null) return null;
  return { i: Number(i?.[1] ?? 0), j: Number(j?.[1] ?? 0) };
}
