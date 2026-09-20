import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';

const dev = DEFAULT_DEVICE_PROFILE;

function emitWithDevice(job: Job, device: DeviceProfile): string {
  return grblStrategy.emit(job, device);
}

describe('grblStrategy scan-offset compensation (ADR-052)', () => {
  const calibratedDevice: DeviceProfile = {
    ...dev,
    scanningOffsets: [{ speedMmPerMin: 6000, offsetMm: 0.25 }],
  };

  it('threads calibrated scan offset into raster reverse rows only', () => {
    const job: Job = {
      groups: [
        {
          kind: 'raster',
          layerId: 'image',
          color: '#808080',
          power: 50,
          speed: 6000,
          passes: 1,
          airAssist: false,
          sValues: new Uint16Array([
            500,
            500,
            0,
            0, //
            0,
            0,
            700,
            700, //
          ]),
          pixelWidth: 4,
          pixelHeight: 2,
          bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
          overscanMm: 1,
          dotWidthCorrectionMm: 0,
        },
      ],
    };

    const out = emitWithDevice(job, calibratedDevice);

    // Raster rows carry the compact motion spelling on this dialect (ADR-332):
    // the reverse row's shift is the assertion, not the spacing. The runway G1
    // holds the S0 the preceding rapid already set, so the beam stays dark
    // without restating it.
    expect(out).toContain('G0X-1Y0.5S0\nG1X0F6000');
    expect(out).toContain('G0X4.75Y1.5S0\nG1X3.75');
  });

  it('leaves forward fill sweeps unchanged and shifts reverse sweeps along travel', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 6000,
          passes: 1,
          airAssist: false,
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 10, y: 0 },
                { x: 20, y: 0 },
              ],
              closed: false,
              reverse: false,
            },
            {
              polyline: [
                { x: 20, y: 5 },
                { x: 10, y: 5 },
              ],
              closed: false,
              reverse: true,
            },
          ],
        },
      ],
    };

    const out = emitWithDevice(job, calibratedDevice);

    expect(out).toContain('G0 X10.000 Y0.000 S0\nG1 X20.000 Y0.000 F6000 S300');
    expect(out).toContain('G0 X19.750 Y5.000 S0\nG1 X9.750 Y5.000 F6000 S300');
  });

  it('shifts angled reverse fill sweeps along their own travel vector', () => {
    const angledDevice: DeviceProfile = {
      ...dev,
      scanningOffsets: [{ speedMmPerMin: 6000, offsetMm: Math.SQRT2 }],
    };
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 6000,
          passes: 1,
          airAssist: false,
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 10, y: 10 },
                { x: 0, y: 0 },
              ],
              closed: false,
              reverse: true,
            },
          ],
        },
      ],
    };

    const out = emitWithDevice(job, angledDevice);

    expect(out).toContain('G0 X9.000 Y9.000 S0\nG1 X-1.000 Y-1.000 F6000 S300');
  });

  it('looks up fill compensation at the same rounded feed emitted to GRBL', () => {
    const fractionalDevice: DeviceProfile = {
      ...dev,
      scanningOffsets: [
        { speedMmPerMin: 6000, offsetMm: 0.25 },
        { speedMmPerMin: 6001, offsetMm: 1.25 },
      ],
    };
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 6000.49,
          passes: 1,
          airAssist: false,
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 20, y: 5 },
                { x: 10, y: 5 },
              ],
              closed: false,
              reverse: true,
            },
          ],
        },
      ],
    };

    const out = emitWithDevice(job, fractionalDevice);

    expect(out).toContain('G0 X19.750 Y5.000 S0');
    expect(out).toContain('F6000');
  });
});
