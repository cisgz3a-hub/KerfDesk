import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project Fire control persistence', () => {
  it('roundtrips an explicitly enabled, capped Fire profile', () => {
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      capabilities: [...(DEFAULT_DEVICE_PROFILE.capabilities ?? []), 'low-power-fire'],
      fireControl: { enabled: true, maxPowerPercent: 1.5 },
    });

    const result = deserializeProject(serializeProject(project));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.fireControl).toEqual({ enabled: true, maxPowerPercent: 1.5 });
  });

  it('rejects Fire power above the hard safety cap', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.device.fireControl = { enabled: true, maxPowerPercent: 50 };

    const result = deserializeProject(JSON.stringify(raw));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('fireControl.maxPowerPercent');
  });
});
