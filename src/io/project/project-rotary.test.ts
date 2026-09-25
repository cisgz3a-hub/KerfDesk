import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 40,
  objectDiameterMm: 60,
  rollerDiameterMm: 25,
};

describe('project rotary persistence (ADR-373)', () => {
  it('roundtrips a roller diameter', () => {
    const project = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary: ROLLER });
    const result = deserializeProject(serializeProject(project));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.rotary).toEqual(ROLLER);
  });

  it('keeps a roller without a roller diameter free of the field', () => {
    const legacy: RotarySetup = {
      enabled: true,
      type: 'roller',
      mmPerRotation: 40,
      objectDiameterMm: 60,
    };
    const project = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary: legacy });
    const result = deserializeProject(serializeProject(project));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.rotary).toEqual(legacy);
    expect(result.project.device.rotary).not.toHaveProperty('rollerDiameterMm');
  });

  it.each([0, -5, '25'])('rejects a roller diameter of %j', (rollerDiameterMm) => {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.device.rotary = { ...ROLLER, rollerDiameterMm };
    const result = deserializeProject(JSON.stringify(raw));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('rotary.rollerDiameterMm');
  });
});
