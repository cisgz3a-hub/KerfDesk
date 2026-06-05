/* eslint-disable max-lines */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { type Job, EMPTY_JOB } from '../job';
import { grblStrategy } from './grbl-strategy';

const dev = DEFAULT_DEVICE_PROFILE;

function emit(job: Job): string {
  return grblStrategy.emit(job, dev);
}

describe('grblStrategy preamble/postamble', () => {
  it('emits G21, G90, M3 S0 preamble and M5 + park postamble around an empty job', () => {
    const out = emit(EMPTY_JOB);
    expect(out).toBe(['G21', 'G90', 'M3 S0', 'M5', 'G0 X0.000 Y0.000 S0', ''].join('\n'));
  });
});

describe('grblStrategy single-segment job', () => {
  const job: Job = {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#ff0000',
        power: 50,
        speed: 1500,
        passes: 1,
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

  it('emits a deterministic G-code body (snapshot-compared by equality)', () => {
    expect(emit(job)).toBe(
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

  it('scales S correctly when device.maxPowerS varies (PROJECT non-negotiable #7)', () => {
    const dev255 = { ...dev, maxPowerS: 255 };
    const out = grblStrategy.emit(job, dev255);
    // 50% × 255 = 127.5 → rounds to 128
    expect(out).toContain('S128');
  });
});

describe('grblStrategy is deterministic (non-negotiable #5)', () => {
  it('produces byte-identical output across repeated calls on the same input', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'A',
          color: '#000000',
          power: 33.333,
          speed: 2000,
          passes: 2,
          segments: [
            {
              polyline: [
                { x: 1.1234, y: 2.5678 },
                { x: 9.99999, y: 0.0001 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const a = emit(job);
    const b = emit(job);
    expect(a).toBe(b);
  });
});

describe('grblStrategy multi-pass repeats the segment block per pass', () => {
  it('emits each pass under its own comment, with the same coordinates', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'L1',
          color: '#ff0000',
          power: 100,
          speed: 1000,
          passes: 3,
          segments: [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 5, y: 0 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const out = emit(job);
    expect(out.match(/; pass 1 of 3/g)).toHaveLength(1);
    expect(out.match(/; pass 2 of 3/g)).toHaveLength(1);
    expect(out.match(/; pass 3 of 3/g)).toHaveLength(1);
    // Same coordinates appear three times (once per pass).
    expect(out.match(/G1 X5\.000 Y0\.000 F1000 S1000/g)).toHaveLength(3);
  });
});

describe('grblStrategy fill hatch overscan', () => {
  it('emits the overscan lead-in/out as laser-off G0 rapids (not cutting-feed moves)', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          overscanMm: 2,
          segments: [
            {
              polyline: [
                { x: 10, y: 5 },
                { x: 20, y: 5 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };

    const out = emit(job);

    // The overscan runway is laser-off travel, so it rides a G0 rapid, not a
    // G1 at the cutting feed. Traversing the 2×overscan runway at the slow
    // cut feed on every one of thousands of fragmented hatch runs was the
    // dominant term in the 2h-vs-LightBurn-5min fill burn (audit 2026-06-03).
    // Because the lead-in is no longer a G1, it no longer sets the modal feed,
    // so the burn G1 must now carry F explicitly.
    expect(out).toContain(
      [
        'G0 X8.000 Y5.000 S0',
        'G0 X10.000 Y5.000 S0',
        'G1 X20.000 Y5.000 F1500 S300',
        'G0 X22.000 Y5.000 S0',
      ].join('\n'),
    );
    // No laser-off move is emitted at cutting feed: every runway hop is a G0,
    // so no G1 line ends in S0.
    expect(out).not.toMatch(/^G1[^\n]* S0$/m);
    expect(out).not.toMatch(/^M[34] S[1-9]/m);
  });

  it('skips the overscan runway on short runs but keeps it on long runs', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          overscanMm: 5,
          segments: [
            {
              polyline: [
                { x: 10, y: 0 },
                { x: 30, y: 0 },
              ],
              closed: false,
            }, // 20mm -> overscan
            {
              polyline: [
                { x: 10, y: 5 },
                { x: 13, y: 5 },
              ],
              closed: false,
            }, // 3mm  -> skip
          ],
        },
      ],
    };

    const out = emit(job);

    // Long run (20mm >= 2x5): full rapid runway around the burn.
    expect(out).toContain(
      [
        'G0 X5.000 Y0.000 S0',
        'G0 X10.000 Y0.000 S0',
        'G1 X30.000 Y0.000 F1500 S300',
        'G0 X35.000 Y0.000 S0',
      ].join('\n'),
    );
    // Short run (3mm < 2x5): no runway — straight seek to burnStart, then burn,
    // then the postamble. Coverage (burn endpoints) is unchanged; only the
    // laser-off runway is dropped.
    expect(out).toContain(
      ['G0 X10.000 Y5.000 S0', 'G1 X13.000 Y5.000 F1500 S300', 'M5'].join('\n'),
    );
  });

  it('emits one continuous sweep for a multi-hole scanline, blanking gaps with S0', () => {
    // One scanline (y=0) with three ink spans / two interior holes. ADR-034:
    // the whole row must ride a single laser-on G1 chain, crossing the holes at
    // S0 (no lift, no stop) — not three separate G0-seek + burn runs.
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          overscanMm: 5,
          segments: [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 5, y: 0 },
              ],
              closed: false,
            },
            {
              polyline: [
                { x: 8, y: 0 },
                { x: 12, y: 0 },
              ],
              closed: false,
            },
            {
              polyline: [
                { x: 15, y: 0 },
                { x: 20, y: 0 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };

    const out = emit(job);

    // Exhaustive per-segment S sequence for the whole sweep: rapid into the
    // runway (S0 x2), then ONE G1 chain — ink S300, gap S0, ink S300, gap S0,
    // ink S300 — then the rapid lead-out (S0). No G0 between the ink spans.
    expect(out).toContain(
      [
        'G0 X-5.000 Y0.000 S0',
        'G0 X0.000 Y0.000 S0',
        'G1 X5.000 Y0.000 F1500 S300',
        'G1 X8.000 Y0.000 S0',
        'G1 X12.000 Y0.000 S300',
        'G1 X15.000 Y0.000 S0',
        'G1 X20.000 Y0.000 S300',
        'G0 X25.000 Y0.000 S0',
      ].join('\n'),
    );
    // Safety: every interior gap re-blanks to S0 and every ink span re-asserts
    // S300 (S is modal — a missed reset would fire the beam across a hole).
    const burnBody = out.slice(out.indexOf('F1500 S300'));
    const sSequence = (burnBody.slice(0, burnBody.indexOf('G0 X25')).match(/S\d+/g) ?? []).join(
      ',',
    );
    expect(sSequence).toBe('S300,S0,S300,S0,S300');
  });

  it('rapids (G0) across a large inter-region gap instead of a slow G1 S0 (ADR-035)', () => {
    // Two regions 15mm apart on one scanline (> 5mm threshold). The burned-logo
    // audit (2026-06-03) found such gaps crossed at cutting feed (slow G1 S0
    // over empty space) — the "move to a second part" that left a stray line.
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 5, y: 0 },
              ],
              closed: false,
            },
            {
              polyline: [
                { x: 20, y: 0 },
                { x: 25, y: 0 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const out = emit(job);
    // The 15mm gap is crossed by a G0 rapid (laser hard-off), NOT a G1 ... S0.
    expect(out).toMatch(/^G0 X20\.000 Y0\.000 S0$/m);
    expect(out).not.toMatch(/^G1 X20\.000 Y0\.000 S0$/m);
  });
});

describe('grblStrategy mixed raster/vector mode transitions', () => {
  it('re-arms M3 before a cut group that follows a raster group', () => {
    const job: Job = {
      groups: [
        {
          kind: 'raster',
          layerId: 'image',
          color: '#808080',
          power: 50,
          speed: 1000,
          passes: 1,
          sValues: new Uint16Array([500]),
          pixelWidth: 1,
          pixelHeight: 1,
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          overscanMm: 0,
        },
        {
          kind: 'cut',
          layerId: 'cut',
          color: '#ff0000',
          power: 50,
          speed: 1500,
          passes: 1,
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
    expect(emit(job)).toContain('M5\nM3 S0\n; layer cut color #ff0000');
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
          sValues: new Uint16Array([500]),
          pixelWidth: 1,
          pixelHeight: 1,
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          overscanMm: 0,
        },
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#ff0000',
          power: 50,
          speed: 1500,
          passes: 1,
          overscanMm: 1,
          segments: [
            {
              polyline: [
                { x: 1, y: 1 },
                { x: 2, y: 1 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    // Fill now arms DYNAMIC power (M4). Raster ended in M5, so M4 S0 alone
    // flips the mode — no redundant second M5 (ADR-036).
    expect(emit(job)).toContain('M5\nM4 S0\n; fill layer fill color #ff0000');
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
          sValues: new Uint16Array([500]),
          pixelWidth: 1,
          pixelHeight: 1,
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          overscanMm: 0,
        },
      ],
    };
    const out = emit(job);
    expect(out.match(/^; raster pass /gm)).toHaveLength(2);
    expect(out.match(/^G0 X0\.000 Y0\.500 S0/gm)).toHaveLength(2);
  });
});

describe('grblStrategy fill zero-length / coincident span guard (audit 2026-06-03)', () => {
  // A motion line whose X/Y repeats the previous motion line is a zero-length
  // move; carrying S>0 it is a stationary beam-on — a PROJECT.md #3 violation.
  function hasZeroLengthMove(gcode: string): boolean {
    let prev = '';
    for (const line of gcode.split('\n')) {
      if (!/^G[01] /.test(line)) continue;
      const coord = (line.match(/X[-\d.]+ Y[-\d.]+/) ?? [''])[0];
      if (coord !== '' && coord === prev) return true;
      prev = coord;
    }
    return false;
  }

  it('merges two touching spans into one continuous burn (no zero-length gap G1)', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 0, y: 5 },
                { x: 5, y: 5 },
              ],
              closed: false,
            },
            {
              polyline: [
                { x: 5, y: 5 },
                { x: 10, y: 5 },
              ],
              closed: false,
            }, // touches the first at x=5
          ],
        },
      ],
    };
    const out = emit(job);
    expect(hasZeroLengthMove(out)).toBe(false);
    // Touching spans burn as one continuous run; no S0 gap is emitted at x=5.
    expect(out).not.toMatch(/G1 X5\.000 Y5\.000 S0/);
    expect(out).toContain('G1 X5.000 Y5.000 F1500 S300\nG1 X10.000 Y5.000 S300');
  });

  it('drops a degenerate interior span instead of emitting a stationary beam-on G1', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          overscanMm: 0,
          segments: [
            {
              polyline: [
                { x: 0, y: 3 },
                { x: 5, y: 3 },
              ],
              closed: false,
            },
            {
              polyline: [
                { x: 8, y: 3 },
                { x: 8, y: 3 },
              ],
              closed: false,
            }, // degenerate (zero-length)
            {
              polyline: [
                { x: 10, y: 3 },
                { x: 15, y: 3 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const out = emit(job);
    expect(hasZeroLengthMove(out)).toBe(false);
    // No stationary positive-S move at the degenerate span's coordinate.
    expect(out).not.toMatch(/G1 X8\.000 Y3\.000 S300/);
  });
});
