import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { findLaserOnTravelIssues, findLongBlankFeedMoves } from '../invariants';
import type { FillGroup, Job } from '../job';
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

const enlargedJFillGroup: FillGroup = {
  kind: 'fill',
  layerId: 'script-name',
  color: '#000000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  fillRunwayPolicy: 'feed-matched-entry',
  overscanMm: 5,
  segments: [
    {
      polyline: [
        { x: 6.551, y: 43 },
        { x: 7.015, y: 43 },
      ],
      closed: false,
      reverse: false,
    },
    {
      polyline: [
        { x: 16.62, y: 43 },
        { x: 18.108, y: 43 },
      ],
      closed: false,
      reverse: false,
    },
    {
      polyline: [
        { x: 18.693, y: 43 },
        { x: 18.972, y: 43 },
      ],
      closed: false,
      reverse: false,
    },
  ],
};

const enlargedJFillJob: Job = {
  groups: [enlargedJFillGroup],
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

  it('emits ordinary laser-off rapid travel for Neotronics vector output without parking', () => {
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
        'G0 X10.000 Y20.000 S0',
        'G1 X30.000 Y40.000 F1500 S500',
        'G1 X50.000 Y60.000 F1500 S500',
        'M5',
        '',
      ].join('\n'),
    );
    expect(out).not.toMatch(/^G0 X0\.000 Y0\.000/m);
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
      ['; pass 2 of 2', 'M3 S0', 'G0 X0.000 Y0.000 S0', 'G1 X5.000 Y0.000 F1200 S600'].join('\n'),
    );
  });

  it('uses the catalog raster laser mode for raster output', () => {
    const out = grblStrategy.emit(singleRasterJob, DEFAULT_DEVICE_PROFILE);

    expect(out).toContain('M5\nM4 S0\nG0 X0.000 Y0.500 S0');
  });

  it('uses laser-off rapid travel and non-modal burn feed words for Neotronics raster output', () => {
    const out = grblStrategy.emit(singleRasterJob, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toContain('G0 X0.000 Y0.500 S0');
    expect(out).toContain('G1 X1.000 F1000 S500\nG1 X1.000 F1000 S0');
  });

  it('uses ordinary laser-off rapid travel for Neotronics fill output', () => {
    const out = grblStrategy.emit(twoSweepFillJob, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toContain('G0 X7.000 Y5.000 S0');
    expect(out).toContain('G0 X23.000 Y5.000 S0');
    expect(out).toContain('G0 X37.000 Y5.000 S0');
    expect(out).toContain('G0 X53.000 Y5.000 S0');
  });

  it('gives the enlarged J fragment a feed-matched 5 mm entry after a shorter rapid', () => {
    const out = grblStrategy.emit(enlargedJFillJob, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toContain(
      [
        'G1 X7.015 Y43.000 F1500 S300',
        'G0 X11.620 Y43.000 S0',
        'G1 X16.620 Y43.000 F1500 S0',
        'G1 X18.108 Y43.000 F1500 S300',
      ].join('\n'),
    );
    expect(out).not.toContain('G0 X16.620 Y43.000 S0');
    expect(findLaserOnTravelIssues(out)).toEqual([]);
    expect(findLongBlankFeedMoves(out, { thresholdMm: 5 })).toEqual([]);
  });

  it('gives both enlarged C gaps monotonic 5 mm feed entries without overlap', () => {
    const cJob: Job = {
      groups: [
        {
          ...enlargedJFillGroup,
          segments: [
            {
              polyline: [
                { x: 0, y: 46 },
                { x: 1.275, y: 46 },
              ],
              closed: false,
              reverse: false,
            },
            {
              polyline: [
                { x: 7.958, y: 46 },
                { x: 10.434, y: 46 },
              ],
              closed: false,
              reverse: false,
            },
            {
              polyline: [
                { x: 17.482, y: 46 },
                { x: 19.197, y: 46 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    };
    const out = grblStrategy.emit(cJob, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);

    expect(out).toContain('G0 X2.958 Y46.000 S0\nG1 X7.958 Y46.000 F1500 S0');
    expect(out).toContain('G0 X12.482 Y46.000 S0\nG1 X17.482 Y46.000 F1500 S0');
    expect(out).not.toContain('G0 X7.958 Y46.000 S0');
    expect(out).not.toContain('G0 X17.482 Y46.000 S0');
  });

  it('uses ordinary laser-off rapid travel for sensitive Island Fill runways', () => {
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
      seek: 'G0 X5.000 Y5.000 S0',
      leadIn: 'G0 X10.000 Y5.000 S0',
      burn: 'G1 X13.000 Y5.000 F1500 S900',
      leadOut: 'G0 X18.000 Y5.000 S0',
    });
  });
});
