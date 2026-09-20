import { describe, expect, it } from 'vitest';

import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';

describe('grblStrategy raster scan calibration', () => {
  it('passes profile scan offsets into emitted image G-code', () => {
    const job: Job = {
      groups: [
        {
          kind: 'raster',
          layerId: 'image',
          color: '#808080',
          power: 30,
          speed: 1000,
          passes: 1,
          airAssist: false,
          sValues: new Uint16Array([100, 100, 100, 100]),
          pixelWidth: 2,
          pixelHeight: 2,
          bounds: { minX: 10, minY: 0, maxX: 12, maxY: 2 },
          overscanMm: 0,
          dotWidthCorrectionMm: 0,
        },
      ],
    };
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1000, offsetMm: 0.25 }],
    };

    const out = grblStrategy.emit(job, device);

    // Raster rows carry the compact motion spelling on this dialect (ADR-332);
    // the coordinates are what this test is about.
    expect(out).toContain('G0X10Y0.5S0');
    expect(out).toContain('G0X11.75Y1.5S0');
  });

  it('selects scan compensation using the emitted fractional feed', () => {
    const job: Job = {
      groups: [
        {
          kind: 'raster',
          layerId: 'slow-image',
          color: '#808080',
          power: 30,
          speed: 0.75,
          passes: 1,
          airAssist: false,
          sValues: new Uint16Array([100, 100, 100, 100]),
          pixelWidth: 2,
          pixelHeight: 2,
          bounds: { minX: 10, minY: 0, maxX: 12, maxY: 2 },
          overscanMm: 0,
          dotWidthCorrectionMm: 0,
        },
      ],
    };
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      scanningOffsets: [
        { speedMmPerMin: 0.75, offsetMm: 0.75 },
        { speedMmPerMin: 1, offsetMm: 0.1 },
      ],
    };

    const output = grblStrategy.emit(job, device);

    expect(output).toContain('feed 0.75 mm/min');
    expect(output).toContain('G0X11.25Y1.5S0');
    expect(output).not.toContain('G0X11.9Y1.5S0');
  });
});
