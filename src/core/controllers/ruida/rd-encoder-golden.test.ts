import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../devices';
import type { Job } from '../../job';
import { encodeRdJob } from './rd-encoder';

// Byte-level regression guard for the .rd encoder (CTL-04 part 3, interim).
//
// WHAT THIS PROVES: encodeRdJob is byte-stable for a fixed Job. A change to the
// emitted bytes — e.g. CTL-04 part 2(b) plumbing a real min power, a refactor,
// or a dependency bump — fails here loudly instead of shipping silently to a
// CO2 laser.
//
// WHAT THIS DOES NOT PROVE: that these bytes are what a real Ruida controller or
// LightBurn produces. There is still NO hardware/LightBurn reference .rd to diff
// against (ADR-097; the rd-encoder.ts STATUS HONESTY note). The double-encode
// test in ruida.test.ts asserts determinism WITHIN a run but cannot catch a byte
// change ACROSS a code change — both encodes move together — which is the exact
// silent-regression gap this golden closes.
//
// To change the golden intentionally: update GOLDEN_RD_HEX below and note the
// reason in the PR body ("Snapshot change acknowledged: <reason>").
//
// Last changed by the 2026-09-25 controller audit fixes (RU-1 to RU-5): the
// file now follows meerk40t's RDJob writer order (header with part table and
// array records, per-layer speed/power/air body, layer end, file sum). These
// exact bytes were decoded by meerk40t's own RDJob.process (rdjob.py at
// 7e82652f): 25 mm/s at 50 % power for both passes, no unknown command, and a
// file sum equal to meerk40t's file_sum() + 0xD7.

const RUIDA_DEVICE = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' as const };

// Canonical minimal job: one red layer, a single open two-point line, 50% power,
// 1500 mm/min, 2 passes. Mirrors the JOB fixture in ruida.test.ts.
const CANONICAL_JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 1500,
      passes: 2,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

const GOLDEN_RD_HEX =
  'd299f009fa7a8b89d289708f8989898989898989898970b189700b898909e3b989890995a9700f898989c79989898bb1c970d9898909e3b989890995a97059898989c79989898bb1c9708d8909890989898989898989898989700d89428d898989094ba1d03989c989d0bb89c989d04989c989d0cb89c989c48f898989890977c449898970db89898989c79989890995a9705b89898909e3b989898bb1c9706989898989c79989890995a970eb89898909e3b989898bb1c9c4ab8970dd89898989898970dd098989898989705d898989898989705d0989898989897a0b8989898989898989898970838989898989e48970e989700389701b898989c79989890995a9701f898909e3b989898bb1c9702b8989898989898989898970ad897081890989098989816bef89898d1391c48b89c40999c4099b428b8989094ba1d09b8989898989d01b8989898989d009c989d08bc989d029c989d0abc989c40b0982898989c79989890995a9a2898909e3b989898bb1c982898989c79989890995a9a2898909e3b989898bb1c97089c40989c409b96e0d898909078b60';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('rd-encoder golden bytes (internal consistency, NOT hardware-verified)', () => {
  it('emits byte-stable .rd output for the canonical job', () => {
    const result = encodeRdJob(CANONICAL_JOB, RUIDA_DEVICE);
    if (!result.ok) throw new Error('encode failed: ' + result.error.kind);
    expect(toHex(result.bytes)).toBe(GOLDEN_RD_HEX);
  });
});
