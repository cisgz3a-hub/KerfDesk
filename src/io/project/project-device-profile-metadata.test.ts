import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project device profile metadata persistence', () => {
  it('roundtrips optional Neotronics profile metadata without requiring older projects to have it', () => {
    const project = createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.machineFamily).toBe('neotronics-4040-max');
    expect(result.project.device.zTravelConfirmed).toBe(false);
    expect(result.project.device.laserSubProfile?.model).toBe('LASER TREE LT-4LDS-V2');
  });

  it('back-fills Neotronics safe travel on old .lf2 files', () => {
    const raw = JSON.parse(
      serializeProject(createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE)),
    ) as Record<string, unknown>;
    const device = raw['device'] as Record<string, unknown>;
    const dialect = device['gcodeDialect'] as Record<string, unknown>;
    delete dialect['controlledLaserOffTravelFeedMmPerMin'];

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.gcodeDialect.dialectId).toBe('neotronics-4040-safe');
    expect(result.project.device.gcodeDialect.controlledLaserOffTravelFeedMmPerMin).toBe(800);
  });

  it('back-fills profile metadata for older .lf2 files and preserves no-go zones', () => {
    const raw = JSON.parse(serializeProject(createProject())) as Record<string, unknown>;
    const device = raw['device'] as Record<string, unknown>;
    delete device['profileId'];
    delete device['profileSource'];
    device['noGoZones'] = [
      { id: 'clamp', name: 'Clamp', enabled: true, x: 10, y: 20, width: 30, height: 40 },
      { id: 'bad', name: 'Bad', enabled: true, x: 0, y: 0, width: -1, height: 10 },
    ];

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.profileId).toBe('generic-grbl-400x400');
    expect(result.project.device.profileSource).toBe('built-in');
    expect(result.project.device.noGoZones).toEqual([
      { id: 'clamp', name: 'Clamp', enabled: true, x: 10, y: 20, width: 30, height: 40 },
    ]);
  });
});
