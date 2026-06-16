import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';

const singleCutJob: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 1500,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
            { x: 50, y: 60 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

const singleRasterJob: Job = {
  groups: [
    {
      kind: 'raster',
      layerId: 'image',
      color: '#808080',
      power: 50,
      speed: 1000,
      passes: 1,
      airAssist: false,
      sValues: new Uint16Array([500]),
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    },
  ],
};

describe('grblStrategy machine compatibility dialects', () => {
  it('keeps the default/Falcon-compatible dialect byte-identical for vector output', () => {
    expect(grblStrategy.emit(singleCutJob, DEFAULT_DEVICE_PROFILE)).toBe(
      [
        'G21',
        'G90',
        'M3 S0',
        '; layer L1 color #ff0000 power 50% speed 1500 mm/min passes 1',
        '; pass 1 of 1',
        'G0 X10.000 Y20.000 S0',
        'G1 X30.000 Y40.000 F1500 S500',
        'G1 X50.000 Y60.000',
        'M5',
        'G0 X0.000 Y0.000 S0',
        '',
      ].join('\n'),
    );
  });

  it('emits Neotronics-safe vector output without parking back to X0 Y0', () => {
    const out = grblStrategy.emit(singleCutJob, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toBe(
      [
        'G21',
        'G90',
        'M4 S0',
        '; layer L1 color #ff0000 power 50% speed 1500 mm/min passes 1',
        '; pass 1 of 1',
        'G0 X10.000 Y20.000 S0',
        'G1 X30.000 Y40.000 F1500 S500',
        'G1 X50.000 Y60.000 F1500 S500',
        'M5',
        '',
      ].join('\n'),
    );
    expect(out).not.toMatch(/^G0 X0\.000 Y0\.000/m);
  });

  it('uses the selected dialect laser mode for raster output', () => {
    const m3RasterProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      gcodeDialect: {
        ...DEFAULT_DEVICE_PROFILE.gcodeDialect,
        laserModeCommand: 'M3',
      },
    } as const;

    const out = grblStrategy.emit(singleRasterJob, m3RasterProfile);

    expect(out).toContain('M5\nM3 S0\nG0 X0.000 Y0.500 S0');
    expect(out).not.toContain('M5\nM4 S0\nG0 X0.000 Y0.500 S0');
  });

  it('uses non-modal feed words for Neotronics-safe raster output', () => {
    const out = grblStrategy.emit(singleRasterJob, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toContain('G1 X1.000 F1000 S500\nG1 X1.000 F1000 S0');
  });
});
