import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('saved machine link persistence', () => {
  it('keeps the My machines entry a project copy was saved as', () => {
    const project = createProject();
    const device = { ...project.device, savedMachineId: 'machine-shop-4040' };
    const loaded = deserializeProject(serializeProject({ ...project, device }));

    if (loaded.kind !== 'ok') throw new Error('expected project');
    expect(loaded.project.device.savedMachineId).toBe('machine-shop-4040');
  });

  it('opens a project with a malformed link as unlinked', () => {
    for (const value of [undefined, '', '   ', 7, null, { id: 'x' }]) {
      const raw = JSON.parse(serializeProject(createProject()));
      raw.device.savedMachineId = value;
      const loaded = deserializeProject(JSON.stringify(raw));

      if (loaded.kind !== 'ok') throw new Error('expected project');
      expect(loaded.project.device.savedMachineId).toBeUndefined();
    }
  });
});
