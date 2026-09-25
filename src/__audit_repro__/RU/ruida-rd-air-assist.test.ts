// Audit track RU, finding RU-5 — FAILS on current code.
//
// Defect: a cut layer's Air assist choice (CutGroup.airAssist, set by the
// always-visible "Air assist" checkbox) never reaches the .rd file.
// rd-commands.ts has no air command and rd-encoder.ts never reads
// group.airAssist, so airAssist:true and airAssist:false export byte-identical
// files, and nothing tells the operator the choice was dropped.
//
// Upstream evidence: Ruida files carry per-layer air assist.
//  - meerk40t rdjob.py L111-112: AIR_ASSIST_OFF = b"\xCA\x01\x12",
//    AIR_ASSIST_ON = b"\xCA\x01\x13"; RDJob.write_settings L1523-1536 writes
//    air_assist_on()/air_assist_off() in each layer body.
//    https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L1517-L1548
//  - EduTech wiki "Ruida": "0xCA 0x01 0x12 | Air Assist Off", "0xCA 0x01 0x13 |
//    Air Assist On"; its RDWorks sample body has `ca0113 (Air Assist On)`.
//
// Correct behaviour: the layer's air choice is encoded (CA 01 13 on / CA 01 12
// off), so the two files differ.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { encodeRdJob } from '../../core/controllers/ruida';

const RUIDA = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' as const };

function job(airAssist: boolean): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#000000',
        power: 60,
        speed: 900,
        passes: 1,
        airAssist,
        segments: [
          {
            polyline: [
              { x: 10, y: 10 },
              { x: 40, y: 10 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}

describe('RU-5: layer air assist reaches the .rd file', () => {
  it('encodes airAssist:true differently from airAssist:false', () => {
    const on = encodeRdJob(job(true), RUIDA);
    const off = encodeRdJob(job(false), RUIDA);
    if (!on.ok || !off.ok) throw new Error('encode failed');
    expect([...on.bytes]).not.toEqual([...off.bytes]);
  });
});
