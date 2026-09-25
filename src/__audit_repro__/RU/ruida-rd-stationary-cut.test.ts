// Audit track RU, finding RU-4 — FAILS on current code.
//
// Defect: the Job contract says a closed segment's polyline already ends at its
// first point (core/job/job.ts: "For a closed segment, the last point equals the
// first by construction."). rd-encoder.ts pushSegment nevertheless appends
// `cutAbsolute(first)` for closed segments, so every closed contour, on every
// pass, ends with a zero-length powered cut (A8 to the point the head is
// already on). KerfDesk's own G-code emitter refuses exactly this
// (core/output/grbl-strategy.ts: "Never emit a stationary positive-power G1").
//
// Upstream evidence: meerk40t RDJob.mark, rdjob.py L1577-1580:
//     def mark(self, x, y, dx, dy):
//         if dx == 0 and dy == 0:
//             # We are not moving.
//             return
// https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L1577-L1580
//
// Correct behaviour: no 0xA8 cut targets the position the head already holds.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { decodeCoord35, encodeRdJob, unswizzleBytes } from '../../core/controllers/ruida';

const RUIDA = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' as const };

// A closed square as compile-job produces it: last point == first point.
const CLOSED_SQUARE: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#000000',
      power: 30,
      speed: 1500,
      passes: 2,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
            { x: 10, y: 10 },
          ],
          closed: true,
        },
      ],
    },
  ],
};

function commands(bytes: Uint8Array): number[][] {
  const out: number[][] = [];
  for (const byte of unswizzleBytes(bytes)) {
    if (byte >= 0x80 || out.length === 0) out.push([byte]);
    else out[out.length - 1]?.push(byte);
  }
  return out;
}

describe('RU-4: no stationary powered cuts', () => {
  it('never emits a 0xA8 cut to the position the head already holds', () => {
    const encoded = encodeRdJob(CLOSED_SQUARE, RUIDA);
    if (!encoded.ok) throw new Error(encoded.error.kind);
    let head: string | null = null;
    const stationaryCuts: string[] = [];
    for (const cmd of commands(encoded.bytes)) {
      if (cmd[0] !== 0x88 && cmd[0] !== 0xa8) continue;
      const target = `${decodeCoord35(cmd.slice(1, 6))},${decodeCoord35(cmd.slice(6, 11))}`;
      if (cmd[0] === 0xa8 && target === head) stationaryCuts.push(target);
      head = target;
    }
    expect(stationaryCuts).toEqual([]);
  });
});
