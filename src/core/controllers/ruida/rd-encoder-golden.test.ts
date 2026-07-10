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
  'd29b700b898989c79989890995a9700f898909e3b989898bb1c970d9898989c79989890995a97059898909e3b989898bb1c9428d898989094ba1d03989c989d0bb89c989c48f898989890977c48b8982898989c79989890995a9a2898909e3b989898bb1c982898989c79989890995a9a2898909e3b989898bb1c96460';

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
