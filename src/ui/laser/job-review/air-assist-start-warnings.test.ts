import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { Job } from '../../../core/job';
import { createLayer } from '../../../core/scene';
import { detectAirAssistStartWarnings } from './air-assist-start-warnings';

const M8_DEVICE = { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' as const };

function cutGroup(layerId: string, airAssist: boolean): Job['groups'][number] {
  return {
    kind: 'cut',
    layerId,
    color: '#ff0000',
    power: 50,
    speed: 500,
    passes: 1,
    airAssist,
    segments: [],
  };
}

const LAYERS = [
  { ...createLayer({ id: 'engrave', color: '#000000' }), name: 'Engrave' },
  { ...createLayer({ id: 'cut', color: '#ff0000' }), name: 'Cut' },
];

describe('air-off opening operation Job Review warning (ADR-323)', () => {
  it('stays silent when the device has no job-controlled air output', () => {
    const job: Job = { groups: [cutGroup('engrave', false), cutGroup('cut', true)] };

    expect(detectAirAssistStartWarnings(job, DEFAULT_DEVICE_PROFILE, LAYERS)).toEqual([]);
  });

  it('stays silent when the first operation already runs with air', () => {
    const job: Job = { groups: [cutGroup('cut', true), cutGroup('engrave', false)] };

    expect(detectAirAssistStartWarnings(job, M8_DEVICE, LAYERS)).toEqual([]);
  });

  it('names the air-off opening operation and where the air command first appears', () => {
    const job: Job = { groups: [cutGroup('engrave', false), cutGroup('cut', true)] };

    const warnings = detectAirAssistStartWarnings(job, M8_DEVICE, LAYERS);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('first operation (Engrave)');
    expect(warnings[0]).toContain('M8 is only sent before Cut');
  });

  it('says the job never sends the air command when every operation has air off', () => {
    const job: Job = { groups: [cutGroup('engrave', false), cutGroup('cut', false)] };

    const warnings = detectAirAssistStartWarnings(job, M8_DEVICE, LAYERS);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('never sends M8');
  });

  it('falls back to the operation id when no layer names are known', () => {
    const job: Job = { groups: [cutGroup('engrave', false), cutGroup('cut', true)] };

    expect(detectAirAssistStartWarnings(job, M8_DEVICE)[0]).toContain('first operation (engrave)');
  });

  it('stays silent for a job with no laser operations', () => {
    expect(detectAirAssistStartWarnings({ groups: [] }, M8_DEVICE, LAYERS)).toEqual([]);
  });
});
