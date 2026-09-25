// Audit track RU, finding RU-1 — FAILS on current code.
//
// Defect: the .rd body never activates a layer's speed and power. encodeRdJob
// writes only the header part table (C9 04 part speed, C6 31/C6 32 part min/max
// power) for ALL layers before any geometry, then each layer body is just
// `CA 02 <part>` followed by moves. No `C9 02` (speed) or `C6 01`/`C6 02`
// (power 1 min/max) is ever emitted.
//
// Correct behaviour (reference encoders): after selecting a layer, the body
// sets that layer's active speed and power before its moves.
//  - meerk40t RDJob.write_settings, called by RuidaDriver.plot_start for each
//    new layer (the path meerk40t ran on an RDC6442S, ruida/README.md L6-8):
//    rdjob.py L1531-1545: layer_number_part(part) ... speed_laser_1(speed) ...
//    min_power_1(power); max_power_1(power); min_power_2(power); max_power_2(power)
//    https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L1517-L1548
//  - The RDWorks sample file on the EduTech wiki "Ruida" page: `ca0200 (0, Layer
//    Number)` ... `c9020000060d20 (Speed Laser 1 100mm/s)` ... `c6011319 (Power 1
//    min)` `c6021828 (Power 1 max)` ... then `88.. Move Absolute`.
//  - meerk40t's decoder/emulator job model (rdjob.py L853-865, L904-911): only
//    C6 01/C6 02 set the plotted `self.power`; C6 31/C6 32 (part table) do not.
//    Running KerfDesk's two-layer file through meerk40t's real RDJob (scratchpad
//    decode_with_m40t.py) plots BOTH layers at 5.0 mm/s (the last part-table
//    speed) with power None, instead of 50 mm/s @20% and 5 mm/s @80%.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { decodeCoord35, decodePower14, encodeRdJob, unswizzleBytes } from '../../core/controllers/ruida';

const RUIDA = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' as const };

const TWO_LAYER: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 20,
      speed: 3000, // 50 mm/s
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
          ],
          closed: false,
        },
      ],
    },
    {
      kind: 'cut',
      layerId: 'L2',
      color: '#0000ff',
      power: 80,
      speed: 300, // 5 mm/s
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 50, y: 10 },
            { x: 60, y: 30 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

// meerk40t parse_commands: a command starts at every byte >= 0x80.
function commands(bytes: Uint8Array): number[][] {
  const raw = [...unswizzleBytes(bytes)];
  const out: number[][] = [];
  for (const byte of raw) {
    if (byte >= 0x80 || out.length === 0) out.push([byte]);
    else out[out.length - 1]?.push(byte);
  }
  return out;
}

type Active = { speedMmPerS: number | null; powerMin: number | null; powerMax: number | null };

// The settings in force at the first move of each layer body, reading only the
// commands a controller executes in the body (after CA 02 <part>).
function activeSettingsPerLayer(cmds: number[][]): Map<number, Active> {
  const result = new Map<number, Active>();
  let layer: number | null = null;
  let active: Active = { speedMmPerS: null, powerMin: null, powerMax: null };
  for (const cmd of cmds) {
    const [op, sub] = cmd;
    if (op === 0xca && sub === 0x02) {
      layer = cmd[2] ?? null;
      active = { speedMmPerS: null, powerMin: null, powerMax: null };
      continue;
    }
    if (layer === null) continue;
    if (op === 0xc9 && sub === 0x02) active.speedMmPerS = decodeCoord35(cmd.slice(2, 7)) / 1000;
    if (op === 0xc6 && sub === 0x01) active.powerMin = decodePower14(cmd.slice(2, 4));
    if (op === 0xc6 && sub === 0x02) active.powerMax = decodePower14(cmd.slice(2, 4));
    if ((op === 0x88 || op === 0xa8) && !result.has(layer)) result.set(layer, { ...active });
  }
  return result;
}

describe('RU-1: each .rd layer body activates its own speed and power', () => {
  it('sets C9 02 speed and C6 01/C6 02 power after CA 02 for every layer', () => {
    const encoded = encodeRdJob(TWO_LAYER, RUIDA);
    if (!encoded.ok) throw new Error(encoded.error.kind);
    const perLayer = activeSettingsPerLayer(commands(encoded.bytes));
    const l0 = perLayer.get(0);
    const l1 = perLayer.get(1);
    expect(l0?.speedMmPerS).toBeCloseTo(50, 3);
    expect(l0?.powerMin).toBeCloseTo(20, 1);
    expect(l0?.powerMax).toBeCloseTo(20, 1);
    expect(l1?.speedMmPerS).toBeCloseTo(5, 3);
    expect(l1?.powerMin).toBeCloseTo(80, 1);
    expect(l1?.powerMax).toBeCloseTo(80, 1);
  });
});
