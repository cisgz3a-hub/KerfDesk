import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createProject, PROJECT_SCHEMA_VERSION } from './project';

describe('createProject', () => {
  it('starts at schemaVersion 3', () => {
    expect(createProject().schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(PROJECT_SCHEMA_VERSION).toBe(3);
  });

  it('uses the default device profile when none is passed', () => {
    const p = createProject();
    expect(p.device).toBe(DEFAULT_DEVICE_PROFILE);
  });

  it("derives the workspace from the device's bed (mm units)", () => {
    const p = createProject();
    expect(p.workspace.units).toBe('mm');
    expect(p.workspace.width).toBe(p.device.bedWidth);
    expect(p.workspace.height).toBe(p.device.bedHeight);
  });

  it('starts with an empty scene (0 objects, 0 layers)', () => {
    const p = createProject();
    expect(p.scene.objects).toHaveLength(0);
    expect(p.scene.layers).toHaveLength(0);
    expect(p.scene.groups).toEqual([]);
  });

  it('starts with empty project notes for operator job context', () => {
    expect(createProject().notes).toBe('');
  });

  it('honors a caller-provided device profile', () => {
    const custom = {
      ...DEFAULT_DEVICE_PROFILE,
      name: 'xTool S1',
      bedWidth: 470,
      bedHeight: 470,
    };
    const p = createProject(custom);
    expect(p.device.name).toBe('xTool S1');
    expect(p.workspace.width).toBe(470);
    expect(p.workspace.height).toBe(470);
  });
});
