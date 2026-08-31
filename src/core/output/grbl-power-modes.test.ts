import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CutGroup, Job } from '../job';
import { grblPowerModeWordsForJob } from './grbl-power-modes';

function cutGroup(layerId: string, powerMode: NonNullable<CutGroup['powerMode']>): CutGroup {
  return {
    kind: 'cut',
    layerId,
    color: '#ff0000',
    power: 30,
    powerMode,
    speed: 1_500,
    passes: 1,
    airAssist: false,
    segments: [],
  };
}

describe('grblPowerModeWordsForJob', () => {
  it('records mixed effective modes within one operation family in emitted order', () => {
    const job: Job = {
      groups: [cutGroup('constant', 'constant'), cutGroup('dynamic', 'dynamic')],
    };

    expect(grblPowerModeWordsForJob(job, DEFAULT_DEVICE_PROFILE)).toEqual({
      cut: ['M3', 'M4'],
      fill: [],
      raster: [],
    });
  });
});
