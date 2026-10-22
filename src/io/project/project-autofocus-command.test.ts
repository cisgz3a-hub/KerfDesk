// Audit 13-P1-1: a project file's Auto-focus command is vetted on load like its
// positioning-light commands, and a machine profile's is cleared with a review
// note (ADR-400 Amendment 1).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import {
  deserializeMachineProfileDocument,
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  serializeMachineProfileDocument,
} from '../machine-profile/machine-profile-io';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function projectWithAutofocus(command: string): string {
  const json = JSON.parse(serializeProject(createProject())) as { device: Record<string, unknown> };
  json.device['autofocusCommand'] = command;
  return JSON.stringify(json);
}

function loadedAutofocus(command: string): string | undefined {
  const result = deserializeProject(projectWithAutofocus(command));
  return result.kind === 'ok' ? result.project.device.autofocusCommand : undefined;
}

describe('project Auto-focus command on load', () => {
  it.each(['G1 X300 Y10 F100 S1000 M3', 'G0 X400 Y400', '$32=0', 'M3 S1000'])(
    'clears %j instead of trusting it',
    (payload) => {
      expect(loadedAutofocus(payload)).toBe('');
    },
  );

  it('keeps a focus command exactly as saved, so Save does not rewrite it', () => {
    expect(loadedAutofocus('$HZ1')).toBe('$HZ1');
    expect(loadedAutofocus('G38.2 Z-10 F100')).toBe('G38.2 Z-10 F100');
    expect(loadedAutofocus('')).toBe('');
  });
});

describe('machine profile Auto-focus command', () => {
  it('clears a refused command with a review note and keeps the profile', () => {
    const text = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: { ...DEFAULT_DEVICE_PROFILE, autofocusCommand: 'G1 X300 Y10 F100 S1000 M3' },
      source: { kind: 'custom', label: 'Shared' },
      reviewNotes: [],
    });

    const result = deserializeMachineProfileDocument(text, 'restore');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.autofocusCommand).toBe('');
    expect(result.document.reviewNotes.join(' ')).toMatch(/Auto-focus command removed/);
  });
});
