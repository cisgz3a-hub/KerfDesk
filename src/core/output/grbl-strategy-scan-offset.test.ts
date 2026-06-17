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

    expect(out).toContain('G0 X-1.000 Y0.500 S0\nG1 X0.000 F6000 S0');
    expect(out).toContain('G0 X4.750 Y1.500 S0\nG1 X3.750 S0');
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
});
