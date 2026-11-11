import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import type { RotaryTaper } from '../../core/devices/rotary';
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

const TAPER: RotaryTaper = {
  enabled: true,
  topDiameterMm: 80,
  bottomDiameterMm: 70,
  lengthMm: 100,
  topSide: 'right',
  artworkFromTopMm: 12.5,
};

describe('project rotary taper persistence (ADR-694)', () => {
  it('roundtrips a taper, on or off', () => {
    for (const taper of [TAPER, { ...TAPER, enabled: false }]) {
      const rotary: RotarySetup = { ...ROLLER, objectDiameterMm: 80, taper };
      const project = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary });
      const result = deserializeProject(serializeProject(project));
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') expect(result.project.device.rotary).toEqual(rotary);
    }
  });

  it.each([
    ['topSide', 'top'],
    ['topDiameterMm', 0],
    ['lengthMm', '100'],
    ['artworkFromTopMm', -1],
    ['enabled', 1],
  ])('rejects a taper %s of %j', (field, value) => {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.device.rotary = { ...ROLLER, taper: { ...TAPER, [field]: value } };
    const result = deserializeProject(JSON.stringify(raw));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain(`rotary.taper.${field}`);
  });

  it('opens a schema 21 rotary project unchanged, with no taper added', () => {
    const raw = JSON.parse(
      serializeProject(createProject({ ...DEFAULT_DEVICE_PROFILE, rotary: ROLLER })),
    );
    const result = deserializeProject(JSON.stringify({ ...raw, schemaVersion: 21 }));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.schemaVersion).toBe(24);
    expect(result.project.device.rotary).toEqual(ROLLER);
    expect(result.project.device.rotary).not.toHaveProperty('taper');
  });
});
