import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';
import {
  deserializeMachineProfileDocument,
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  serializeCanonicalDeviceProfile,
} from '../machine-profile/machine-profile-io';

describe('background streaming preference persistence', () => {
  it.each([true, false])('preserves explicit %s in projects and machine profiles', (enabled) => {
    const project = createProject();
    const device = { ...project.device, workerHostedStreaming: enabled };
    const loaded = deserializeProject(serializeProject({ ...project, device }));
    if (loaded.kind !== 'ok') throw new Error('expected project');
    expect(loaded.project.device.workerHostedStreaming).toBe(enabled);
    const profile = deserializeMachineProfileDocument(
      JSON.stringify({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        source: { kind: 'custom', label: 'Background preference' },
        reviewNotes: [],
        profile: device,
      }),
    );
    if (profile.kind !== 'ok') throw new Error('expected profile');
    expect(profile.document.profile.workerHostedStreaming).toBe(enabled);
    expect(
      JSON.parse(serializeCanonicalDeviceProfile(profile.document.profile)).workerHostedStreaming,
    ).toBe(enabled);
  });

  it('preserves the absent default and drops malformed preferences', () => {
    const original = createProject();
    for (const value of [undefined, 'false', 1, null]) {
      const raw = JSON.parse(serializeProject(original));
      raw.device.workerHostedStreaming = value;
      const loaded = deserializeProject(JSON.stringify(raw));
      if (loaded.kind !== 'ok') throw new Error('expected project');
      expect(loaded.project.device.workerHostedStreaming).toBeUndefined();
    }
  });
});
