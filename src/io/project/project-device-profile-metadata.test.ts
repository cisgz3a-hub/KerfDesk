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
});
