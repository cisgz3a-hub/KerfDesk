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

  it('threads calibrated scan offset into raster rows, half each way (ADR-052 Amendment 2)', () => {
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
    // each row's half-offset shift is the assertion, not the spacing. The runway G1
    // holds the S0 the preceding rapid already set, so the beam stays dark
    // without restating it.
    expect(out).toContain('G0X-0.875Y0.5S0\nG1X0.125F6000');
    expect(out).toContain('G0X4.875Y1.5S0\nG1X3.875');
  });

  it('moves forward and reverse fill sweeps half the offset along their own travel', () => {
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

    expect(out).toContain('G0 X10.125 Y0.000 S0\nG1X20.125Y0F6000S300');
    expect(out).toContain('G0 X19.875 Y5.000 S0\nG1X9.875Y5F6000S300');
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

    expect(out).toContain('G0 X9.500 Y9.500 S0\nG1X-0.5Y-0.5F6000S300');
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

    expect(out).toContain('G0 X19.875 Y5.000 S0');
    expect(out).toContain('F6000');
  });
});
