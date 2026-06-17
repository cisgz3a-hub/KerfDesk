import { describe, expect, it } from 'vitest';

import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';

describe('grblStrategy raster scan calibration', () => {
  it('passes raster group scan offsets into emitted image G-code', () => {
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
          initialXOffsetMm: 0.1,
          bidirectionalScanOffsetMm: 0.25,
        },
      ],
    };

    const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);

    expect(out).toContain('G0 X10.350 Y0.500 S0');
    expect(out).toContain('G0 X11.850 Y1.500 S0');
  });
});
