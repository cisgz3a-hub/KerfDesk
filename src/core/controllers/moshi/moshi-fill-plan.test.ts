// Moshi Fill sweeps (ADR-705 Amendment 4, code quality audit C2 D2-P1-3):
// taken from planFillSweeps like the G-code Fill, so a reversed sweep carries
// the bidirectional scan offset from the layer or the machine's speed table,
// read back from the decoded program bytes.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../devices';
import type { FillGroup } from '../../job';
import { decodeMoshiProgram, type MoshiDecodedStep } from './moshi-decoder';
import { encodeMoshiJob } from './moshi-job-encoder';
import { mmToMils } from './moshi-units';

const MOSHI: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'moshi' };

// Two 20 mm hatch lines, 1 mm apart, the second burned right to left.
function fill(overrides: Partial<FillGroup> = {}): FillGroup {
  return {
    kind: 'fill',
    layerId: 'F',
    color: '#00f',
    power: 40,
    speed: 3000,
    passes: 1,
    airAssist: false,
    overscanMm: 0,
    segments: [
      { polyline: [{ x: 50, y: 10 }, { x: 70, y: 10 }], closed: false, reverse: false },
      { polyline: [{ x: 70, y: 11 }, { x: 50, y: 11 }], closed: false, reverse: true },
    ],
    ...overrides,
  };
}

function burns(group: FillGroup, device: DeviceProfile = MOSHI): Array<[number, number]> {
  const encoded = encodeMoshiJob({ groups: [group] }, device);
  if (!encoded.ok) throw new Error(encoded.error.kind);
  const decoded = decodeMoshiProgram(encoded.programs[0]?.bytes ?? new Uint8Array());
  if (!decoded.ok) throw new Error(decoded.error);
  const out: Array<[number, number]> = [];
  let at: MoshiDecodedStep | undefined = decoded.program.steps[0];
  for (const step of decoded.program.steps.slice(1)) {
    if (step.cut && at !== undefined) out.push([at.x, step.x]);
    at = step;
  }
  return out;
}

describe('Moshi Fill sweeps', () => {
  it('burns each hatch line where it is drawn without a scan offset', () => {
    expect(burns(fill())).toEqual([
      [mmToMils(50), mmToMils(70)],
      [mmToMils(70), mmToMils(50)],
    ]);
  });

  // planFillSweeps moves every sweep half the offset back along its travel
  // (ADR-052 Amd 2, #1623, as LightBurn does), so the two directions meet.
  it('moves each sweep half the layer scan offset, as the G-code Fill does', () => {
    expect(burns(fill({ bidirectionalScanOffsetMm: 0.4 }))).toEqual([
      [mmToMils(50.2), mmToMils(70.2)],
      [mmToMils(69.8), mmToMils(49.8)],
    ]);
  });

  it('takes the offset from the machine speed table when the layer sets none', () => {
    const device: DeviceProfile = {
      ...MOSHI,
      scanningOffsets: [{ speedMmPerMin: 3000, offsetMm: 0.4 }],
    };
    expect(burns(fill(), device)).toEqual(burns(fill({ bidirectionalScanOffsetMm: 0.4 })));
  });
});
