// Moshi raster rows (ADR-705 Amendment 2, code quality audit C2 D1-P1-1 and
// D1-P1-2): the overscan runway is laser-off up to the first dark pixel, Dot
// width correction shortens each burn, and a reversed row carries the
// bidirectional scan offset — read back from the decoded program bytes.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../devices';
import type { RasterGroup } from '../../job';
import { decodeMoshiProgram, type MoshiDecodedStep } from './moshi-decoder';
import { encodeMoshiJob } from './moshi-job-encoder';
import { mmToMils } from './moshi-units';

const MOSHI: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'moshi' };

// Two rows of 4 one-millimetre pixels at X 10..14 mm; pixels 1-2 are dark, so
// the art spans X 11..13 mm on both rows.
function raster(overrides: Partial<RasterGroup> = {}): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'R',
    color: '#000',
    power: 100,
    speed: 6000,
    passes: 1,
    airAssist: false,
    sValues: Uint16Array.from([0, 1000, 1000, 0, 0, 1000, 1000, 0]),
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 10, minY: 10, maxX: 14, maxY: 12 },
    overscanMm: 2,
    dotWidthCorrectionMm: 0,
    ...overrides,
  };
}

type Burn = { readonly from: number; readonly to: number; readonly y: number };

function burns(group: RasterGroup, device: DeviceProfile = MOSHI): Burn[] {
  const encoded = encodeMoshiJob({ groups: [group] }, device);
  if (!encoded.ok) throw new Error(encoded.error.kind);
  const scan = encoded.programs[0];
  if (scan?.kind !== 'raster') throw new Error('expected a raster program');
  const decoded = decodeMoshiProgram(scan.bytes);
  if (!decoded.ok) throw new Error(decoded.error);
  const out: Burn[] = [];
  let at: MoshiDecodedStep | undefined = decoded.program.steps[0];
  for (const step of decoded.program.steps.slice(1)) {
    if (step.cut && at !== undefined) {
      expect(step.y).toBe(at.y);
      out.push({ from: at.x, to: step.x, y: step.y });
    }
    at = step;
  }
  return out;
}

const ART_START = mmToMils(11);
const ART_END = mmToMils(13);

describe('Moshi raster rows', () => {
  it('runs the overscan laser-off and burns only the dark pixels, both ways', () => {
    const rows = burns(raster());
    expect(rows).toEqual([
      { from: ART_START, to: ART_END, y: mmToMils(10.5) },
      { from: ART_END, to: ART_START, y: mmToMils(11.5) },
    ]);
  });

  it('still travels the runway: the head enters 2 mm before the art', () => {
    const encoded = encodeMoshiJob({ groups: [raster()] }, MOSHI);
    if (!encoded.ok) throw new Error(encoded.error.kind);
    const decoded = decodeMoshiProgram(encoded.programs[0]?.bytes ?? new Uint8Array());
    if (!decoded.ok) throw new Error(decoded.error);
    expect(decoded.program.steps[0]).toEqual({ x: mmToMils(9), y: mmToMils(10.5), cut: false });
    expect(Math.max(...decoded.program.steps.map((step) => step.x))).toBe(mmToMils(15));
  });

  it('shortens each burn by the Dot width correction', () => {
    const [forward, back] = burns(raster({ dotWidthCorrectionMm: 0.2 }));
    for (const row of [forward, back]) {
      if (row === undefined) throw new Error('missing row');
      const lo = Math.min(row.from, row.to);
      const hi = Math.max(row.from, row.to);
      expect(lo).toBeGreaterThanOrEqual(ART_START);
      expect(hi).toBeLessThanOrEqual(ART_END);
      // Each end comes in by the correction, as on G-code (raster-power-runs.ts
      // survivingBurnEdges): 2 mm of art less 2 x 0.2 mm, within a mil.
      expect(Math.abs(hi - lo - mmToMils(1.6))).toBeLessThanOrEqual(1);
    }
  });

  // Every row moves half the offset along its own travel, as the G-code raster
  // does (ADR-052 Amendment 2, rasterRowShiftX).
  it('moves each row half the layer scan offset, else the machine table', () => {
    const fromLayer = burns(raster({ bidirectionalScanOffsetMm: 0.3 }));
    expect(fromLayer[0]).toEqual({
      from: mmToMils(11.15),
      to: mmToMils(13.15),
      y: mmToMils(10.5),
    });
    expect(fromLayer[1]).toEqual({
      from: mmToMils(12.85),
      to: mmToMils(10.85),
      y: mmToMils(11.5),
    });
    const tableDevice: DeviceProfile = {
      ...MOSHI,
      scanningOffsets: [{ speedMmPerMin: 6000, offsetMm: 0.3 }],
    };
    expect(burns(raster(), tableDevice)).toEqual(fromLayer);
  });
});
