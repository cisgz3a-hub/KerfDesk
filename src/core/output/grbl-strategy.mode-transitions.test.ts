// Split out of grbl-strategy.test.ts: that file crossed the 600 raw-physical-line
// CI backstop (check:file-size) when ADR-257 added its M4 rationale comments.
// Mode transitions are a self-contained subject — how the emitter re-arms the
// vector power mode when a cut group follows a raster group, which leaves the
// controller in mode 'off'.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';

const dev = DEFAULT_DEVICE_PROFILE;

function emit(job: Job): string {
  return grblStrategy.emit(job, dev);
}

describe('grblStrategy mixed raster/vector mode transitions', () => {
  it('re-arms the cut power mode before a cut group that follows a raster group', () => {
    const job: Job = {
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
        {
          kind: 'cut',
          layerId: 'cut',
          color: '#ff0000',
          power: 50,
          speed: 1500,
          passes: 1,
          airAssist: false,
          segments: [
            {
              polyline: [
                { x: 1, y: 1 },
                { x: 2, y: 2 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    // ADR-257: the default dialect cuts dynamically, so the re-arm after a raster
    // group's trailing M5 is M4. The raster path leaves mode 'off', so a re-arm is
    // still required — that is what this pins.
    expect(emit(job)).toContain('M5\nM4 S0\n; layer cut color #ff0000');
  });

  it('arms M4 (dynamic power) before a fill group that follows a raster group', () => {
    const job: Job = {
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
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#ff0000',
          power: 50,
          speed: 1500,
          passes: 1,
          airAssist: false,
          overscanMm: 1,
          segments: [
            {
              polyline: [
                { x: 1, y: 1 },
                { x: 2, y: 1 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    };
    // Fill now arms DYNAMIC power (M4). Raster ended in M5, so M4 S0 alone
    // flips the mode — no redundant second M5 (ADR-036).
    expect(emit(job)).toContain('M5\nM4 S0\n; fill layer fill color #ff0000');
  });

  it('annotates the fill header overscan with the ADR-033 short-run skip threshold', () => {
    // The header used to print the configured setting verbatim, which read as
    // "every run gets this runway" — ADR-033 zeroes it on short runs, and in a
    // real traced-lettering job most runs got none (audit 2026-07-18).
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#ff0000',
          power: 50,
          speed: 1500,
          passes: 1,
          airAssist: false,
          overscanMm: 5,
          segments: [
            {
              polyline: [
                { x: 1, y: 1 },
                { x: 2, y: 1 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    };
    expect(emit(job)).toContain(
      '; fill layer fill color #ff0000 power 50% speed 1500 mm/min passes 1 ' +
        'overscan 5.000 mm (skipped on runs shorter than 10.000 mm; ADR-033)',
    );
  });

  it('repeats raster row data for each raster pass', () => {
    const job: Job = {
      groups: [
        {
          kind: 'raster',
          layerId: 'image',
          color: '#808080',
          power: 50,
          speed: 1000,
          passes: 2,
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
    const out = emit(job);
    expect(out.match(/^; raster pass /gm)).toHaveLength(2);
    expect(out.match(/^G0 X0\.000 Y0\.500 S0/gm)).toHaveLength(2);
  });

  it('does not double the M5 when a raster group is the last in the job', () => {
    const job: Job = {
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
    // The raster group emits its own trailing M5; the postamble must not add a
    // second one — a raster-last job had M5\nM5 before the park move.
    expect(emit(job)).not.toContain('M5\nM5');
  });
});
