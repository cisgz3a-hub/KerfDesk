import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { Job } from '../../../core/job';
import { detectManualAirAssistWarnings } from './manual-air-assist-warnings';

const AIR_JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'cut',
      color: '#ff0000',
      power: 50,
      speed: 500,
      passes: 1,
      airAssist: true,
      segments: [],
    },
  ],
};

describe('manual air-assist Job Review warning', () => {
  it('states that an air-requesting job emits no relay command when output is None', () => {
    const warnings = detectManualAirAssistWarnings(AIR_JOB, DEFAULT_DEVICE_PROFILE);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no M7/M8');
    expect(warnings[0]).toContain('manual');
  });

  it('stays silent when a tested controller output is configured', () => {
    expect(
      detectManualAirAssistWarnings(AIR_JOB, {
        ...DEFAULT_DEVICE_PROFILE,
        airAssistCommand: 'M8',
      }),
    ).toEqual([]);
  });

  it('stays silent when the exact prepared job does not request air', () => {
    expect(
      detectManualAirAssistWarnings(
        { groups: AIR_JOB.groups.map((group) => ({ ...group, airAssist: false })) },
        DEFAULT_DEVICE_PROFILE,
      ),
    ).toEqual([]);
  });
});
