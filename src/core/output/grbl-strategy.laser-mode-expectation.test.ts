// ADR-637 Amendment 7 (UX audit U8-P2-1): Machine Setup now keeps a laser's
// expected laser mode on when its controller reports $32=0, instead of copying
// the off. The expectation only feeds the setup's $32 comparison and Job
// Review's row; it must never reach the G-code, so a machine that is set up
// correctly emits byte-identical output.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CutGroup, FillGroup, Job } from '../job';
import { grblStrategy } from './grbl-strategy';

const fill: FillGroup = {
  kind: 'fill',
  layerId: 'fill',
  color: '#000000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  overscanMm: 0,
  segments: [
    {
      polyline: [
        { x: 10, y: 5 },
        { x: 20, y: 5 },
      ],
      closed: false,
      reverse: false,
    },
  ],
};

const cut: CutGroup = {
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
        { x: 30, y: 1 },
        { x: 30, y: 20 },
      ],
      closed: false,
    },
  ],
};

describe('GRBL output and the expected laser mode', () => {
  it('emits the same bytes whether the profile expects laser mode on or off', () => {
    const job: Job = { groups: [fill, cut] };
    const on = grblStrategy.emit(job, { ...DEFAULT_DEVICE_PROFILE, laserModeEnabled: true });
    const off = grblStrategy.emit(job, { ...DEFAULT_DEVICE_PROFILE, laserModeEnabled: false });
    expect(on).toBe(off);
    expect(on).toContain('S0');
  });
});
