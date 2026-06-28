import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';

describe('grblStrategy offset fill', () => {
  it('emits offset fill contours without scanline overscan runways', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          fillStyle: 'offset',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          airAssist: false,
          overscanMm: 5,
          segments: [
            {
              polyline: [
                { x: 10, y: 10 },
                { x: 20, y: 10 },
                { x: 20, y: 20 },
                { x: 10, y: 20 },
                { x: 10, y: 10 },
              ],
              closed: true,
              reverse: false,
            },
          ],
        },
      ],
    };
    const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);

    expect(out).toContain('; offset fill layer fill color #000000');
    expect(out).toContain('G0 X10.000 Y10.000 S0\nG1 X20.000 Y10.000 F1500 S300');
    expect(out).not.toContain('G0 X5.000 Y10.000 S0');
    expect(out).not.toContain('G0 X25.000 Y10.000 S0');
  });

  it('emits island fill through straight scanline moves without arc commands', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          fillStyle: 'island',
          layerId: 'island-a',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          airAssist: false,
          overscanMm: 1,
          segments: [
            {
              polyline: [
                { x: 10, y: 10 },
                { x: 20, y: 10 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
        {
          kind: 'fill',
          fillStyle: 'island',
          layerId: 'island-b',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          airAssist: false,
          overscanMm: 1,
          segments: [
            {
              polyline: [
                { x: 40, y: 10 },
                { x: 45, y: 10 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    };
    const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);

    expect(out).toContain('; fill layer island-a color #000000');
    expect(out).toContain(
      'G0 X9.000 Y10.000 S0\nG0 X10.000 Y10.000 S0\nG1 X20.000 Y10.000 F1500 S300\nG0 X21.000 Y10.000 S0',
    );
    expect(out).toContain('; fill layer island-b color #000000');
    expect(out).toContain(
      'G0 X39.000 Y10.000 S0\nG0 X40.000 Y10.000 S0\nG1 X45.000 Y10.000 F1500 S300\nG0 X46.000 Y10.000 S0',
    );
    expect(out).not.toMatch(/\bG[23]\b/);
  });

  it('keeps a partial laser-off runway around short Island Fill sweeps', () => {
    const job: Job = {
      groups: [
        {
          kind: 'fill',
          fillStyle: 'island',
          layerId: 'island-short',
          color: '#000000',
          power: 30,
          speed: 1500,
          passes: 1,
          airAssist: false,
          overscanMm: 5,
          segments: [
            {
              polyline: [
                { x: 10, y: 10 },
                { x: 13, y: 10 },
              ],
              closed: false,
              reverse: false,
            },
          ],
        },
      ],
    };
    const out = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);

    expect(out).toContain(
      'G0 X8.500 Y10.000 S0\nG0 X10.000 Y10.000 S0\nG1 X13.000 Y10.000 F1500 S300\nG0 X14.500 Y10.000 S0',
    );
  });
});
