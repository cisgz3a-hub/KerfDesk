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

const twoSweepFillJob: Job = {
  groups: [
    {
      kind: 'fill',
      layerId: 'fill',
      color: '#000000',
      power: 90,
      speed: 800,
      passes: 1,
      airAssist: false,
      fillRunwayPolicy: 'full',
      overscanMm: 3,
      segments: [
        {
          polyline: [
            { x: 10, y: 5 },
            { x: 20, y: 5 },
          ],
          closed: false,
          reverse: false,
        },
        // Gap is wider than the fill rapid threshold, so current output seeks
        // between these sweeps with G0. The 4040-safe dialect must not.
        {
          polyline: [
            { x: 40, y: 5 },
            { x: 50, y: 5 },
          ],
          closed: false,
          reverse: false,
        },
      ],
    },
  ],
};

const tinySensitiveIslandFillJob: Job = {
  groups: [
    {
      kind: 'fill',
      layerId: 'island',
      color: '#000000',
      power: 90,
      speed: 1500,
      passes: 1,
      airAssist: false,
      fillStyle: 'island',
      islandMotionPolicy: 'sensitive',
      fillRunwayPolicy: 'full',
      overscanMm: 5,
      segments: [
        {
          polyline: [
            { x: 10, y: 5 },
            { x: 13, y: 5 },
          ],
          closed: false,
          reverse: false,
        },
      ],
    },
  ],
};

type MotionArtifact = {
  readonly raw: string;
  readonly f?: number;
  readonly s?: number;
};

function parseMotionArtifact(gcode: string): ReadonlyArray<MotionArtifact> {
  return gcode
    .split('\n')
    .filter((line) => /^G[01]\b/.test(line))
    .map((raw) => {
      const f = raw.match(/\bF(\d+(?:\.\d+)?)/);
      const s = raw.match(/\bS(\d+(?:\.\d+)?)/);
      return {
        raw,
        ...(f === null ? {} : { f: Number(f[1]) }),
        ...(s === null ? {} : { s: Number(s[1]) }),
      };
    });
}

describe('grblStrategy machine compatibility dialects', () => {
  it('keeps the default/Falcon-compatible dialect byte-identical for vector output', () => {
    expect(grblStrategy.emit(singleCutJob, DEFAULT_DEVICE_PROFILE)).toBe(
      [
        'G21',
        'G90',
        'G54',
        'G94',
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

  it('keeps generic legacy Fill runway bytes on G0 while 4040 uses the quality policy', () => {
    const source = twoSweepFillJob.groups[0];
    if (source?.kind !== 'fill') throw new Error('Expected fill fixture');
    const out = grblStrategy.emit(
      { groups: [{ ...source, fillRunwayPolicy: 'legacy-skip' }] },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(out).toBe(
      [
        'G21',
        'G90',
        'G54',
        'G94',
        'M3 S0',
        'M5',
        'M4 S0',
        '; fill layer fill color #000000 power 90% speed 800 mm/min passes 1 overscan 3.000 mm (skipped on runs shorter than 6.000 mm; ADR-033)',
        '; pass 1 of 1',
        'G0 X7.000 Y5.000 S0',
        'G0 X10.000 Y5.000 S0',
        'G1 X20.000 Y5.000 F800 S900',
        'G0 X23.000 Y5.000 S0',
        'G0 X37.000 Y5.000 S0',
        'G0 X40.000 Y5.000 S0',
        'G1 X50.000 Y5.000 F800 S900',
        'G0 X53.000 Y5.000 S0',
        'M5',
        'G0 X0.000 Y0.000 S0',
        '',
      ].join('\n'),
    );
  });

  it('emits configured controlled laser-off travel for Neotronics vector output without parking', () => {
    const out = grblStrategy.emit(singleCutJob, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toBe(
      [
        'G21',
        'G90',
        'G54',
        'G94',
        'M3 S0',
        '; layer L1 color #ff0000 power 50% speed 1500 mm/min passes 1',
        '; pass 1 of 1',
        'G1 X10.000 Y20.000 F800 S0 ; kerfdesk:laser-off-motion',
        'G1 X30.000 Y40.000 F1500 S500',
        'G1 X50.000 Y60.000 F1500 S500',
        'M5',
        '',
      ].join('\n'),
    );
    expect(out).not.toMatch(/^G0 X0\.000 Y0\.000/m);
  });

  it('clamps a positive sub-1 controlled feed to executable F1 motion', () => {
    const device = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      controlledLaserOffTravelFeedMmPerMin: 0.4,
    };
    const vector = grblStrategy.emit(singleCutJob, device);
    const raster = grblStrategy.emit(singleRasterJob, device);

    expect(vector).toContain('G1 X10.000 Y20.000 F1 S0');
    expect(raster).toContain('G1 X0.000 Y0.500 F1 S0');
  });

  it('omits Neotronics vector cuts that collapse at controller precision', () => {
    const collapsed: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'collapsed',
          color: '#ff0000',
          power: 50,
          speed: 1000,
          passes: 1,
          airAssist: false,
          segments: [
            {
              polyline: [
                { x: 1, y: 1.0000000000000002 },
                { x: 1, y: 1 },
              ],
              closed: false,
            },
            {
              polyline: [
                { x: 1, y: 1 },
                { x: 1.0000000000000002, y: 1 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const out = grblStrategy.emit(collapsed, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).not.toContain('X1.000 Y1.000');
    expect(out).not.toMatch(/^G1 .* S[1-9]/m);
  });

  it('uses constant-power vector mode for Neotronics two-pass cuts and reasserts pass 2 power', () => {
    const out = grblStrategy.emit(
      {
        groups: [
          {
            kind: 'cut',
            layerId: 'cut4040',
            color: '#ff0000',
            power: 60,
            speed: 1200,
            passes: 2,
            airAssist: false,
            segments: [
              {
                polyline: [
                  { x: 0, y: 0 },
                  { x: 5, y: 0 },
                  { x: 5, y: 5 },
                ],
                closed: false,
              },
            ],
          },
        ],
      },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    );

    expect(out).toContain('G21\nG90\nG54\nG94\nM3 S0\n; layer cut4040');
    expect(out).not.toMatch(/^M4\b/m);
    expect(out).toContain(
      [
        '; pass 2 of 2',
        'M3 S0',
        'G1 X0.000 Y0.000 F800 S0 ; kerfdesk:laser-off-motion',
        'G1 X5.000 Y0.000 F1200 S600',
      ].join('\n'),
    );
  });

  it('uses the catalog raster laser mode for raster output', () => {
    const out = grblStrategy.emit(singleRasterJob, DEFAULT_DEVICE_PROFILE);

    expect(out).toContain('M5\nM4 S0\nG0 X0.000 Y0.500 S0');
  });

  it('uses controlled laser-off travel and reasserts burn feed for Neotronics raster output', () => {
    const out = grblStrategy.emit(singleRasterJob, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toContain('G1 X0.000 Y0.500 F800 S0 ; kerfdesk:laser-off-motion');
    expect(out).toContain('G1 X1.000 F1000 S500\nG1 X1.000 F1000 S0');
  });

  it('omits a 1x1 Neotronics raster burn that collapses at controller precision', () => {
    const source = singleRasterJob.groups[0];
    if (source?.kind !== 'raster') throw new Error('Expected raster fixture');
    const out = grblStrategy.emit(
      {
        groups: [
          {
            ...source,
            layerId: 'tiny',
            bounds: { minX: 1, minY: 1, maxX: 1.041667, maxY: 1.1 },
            dotWidthCorrectionMm: 0.0207,
          },
        ],
      },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    );

    expect(out.split('\n').filter((line) => /^G[01]\b/.test(line))).toEqual([
      'G1 X1.000 Y1.050 F800 S0 ; kerfdesk:laser-off-motion',
      'G1 X1.021 F1000 S0',
      'G1 X1.042 F1000 S0',
    ]);
    expect(out).not.toMatch(/^G1 X1\.021 F1000 S500$/m);
  });

  it('uses controlled seeks and feed-matched full runway for Neotronics fill output', () => {
    const out = grblStrategy.emit(twoSweepFillJob, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toContain('G1 X7.000 Y5.000 F800 S0 ; kerfdesk:laser-off-motion');
    expect(out).toContain('G1 X10.000 Y5.000 F800 S0 ; kerfdesk:laser-off-motion');
    expect(out).toContain('G1 X37.000 Y5.000 F800 S0 ; kerfdesk:laser-off-motion');
    expect(out).toContain('G1 X53.000 Y5.000 F800 S0 ; kerfdesk:laser-off-motion');
    expect(out).not.toContain('X23.000 Y5.000');
    expect(out).not.toContain('G0 ');
  });

  it('uses controlled seek and feed-matched G1 for sensitive Island Fill runways', () => {
    const out = grblStrategy.emit(
      tinySensitiveIslandFillJob,
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    );
    const motions = parseMotionArtifact(out);
    const burnIndex = motions.findIndex((motion) => motion.s === 900);
    const seek = motions[burnIndex - 2];
    const leadIn = motions[burnIndex - 1];
    const burn = motions[burnIndex];
    const leadOut = motions[burnIndex + 1];

    expect({
      seek: seek?.raw,
      leadIn: leadIn?.raw,
      burn: burn?.raw,
      leadOut: leadOut?.raw,
    }).toEqual({
      seek: 'G1 X5.000 Y5.000 F800 S0 ; kerfdesk:laser-off-motion',
      leadIn: 'G1 X10.000 Y5.000 F1500 S0 ; kerfdesk:laser-off-motion',
      burn: 'G1 X13.000 Y5.000 F1500 S900',
      leadOut: 'G1 X18.000 Y5.000 F1500 S0 ; kerfdesk:laser-off-motion',
    });
  });
});
