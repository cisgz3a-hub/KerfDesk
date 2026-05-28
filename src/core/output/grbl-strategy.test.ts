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
