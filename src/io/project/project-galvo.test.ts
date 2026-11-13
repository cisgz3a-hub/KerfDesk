// Schema 24 (ADR-704): a JCZ galvo project keeps its controller kind, galvo
// setup and per-operation galvo fields through save and load; a schema 23
// file opens unchanged with none of them; and a galvo field the board's words
// cannot carry refuses the file rather than burning another value.

import { describe, expect, it } from 'vitest';
import { GENERIC_JCZ_GALVO_PROFILES } from '../../core/devices/galvo-profiles';
import { addLayer, createLayer, createProject } from '../../core/scene';
import type { DeviceProfile } from '../../core/devices';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const GALVO = GENERIC_JCZ_GALVO_PROFILES[1] as DeviceProfile;

function galvoProject() {
  const project = createProject(GALVO);
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    galvoFrequencyKhz: 60,
    galvoPulseWidthNs: 20,
  };
  return { ...project, scene: addLayer(project.scene, layer) };
}

describe('project galvo persistence (ADR-704, schema 24)', () => {
  it('round-trips the jcz-lmc kind, the galvo setup and the operation fields', () => {
    const result = deserializeProject(serializeProject(galvoProject()));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.schemaVersion).toBe(24);
    expect(result.project.device.controllerKind).toBe('jcz-lmc');
    expect(result.project.device.galvo).toEqual(GALVO.galvo);
    expect(result.project.device.bedWidth).toBe(150);
    expect(result.project.scene.layers[0]).toMatchObject({
      galvoFrequencyKhz: 60,
      galvoPulseWidthNs: 20,
    });
  });

  it('opens a schema 23 project unchanged, with no galvo fields added', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    const result = deserializeProject(JSON.stringify({ ...raw, schemaVersion: 23 }));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.schemaVersion).toBe(24);
    expect(result.project.device).not.toHaveProperty('galvo');
  });

  it.each([
    ['galvoFrequencyKhz', 0],
    ['galvoFrequencyKhz', '30'],
    ['galvoPulseWidthNs', 2.5],
  ])('refuses an operation %s of %j', (field, value) => {
    const raw = JSON.parse(serializeProject(galvoProject()));
    raw.scene.layers[0][field] = value;
    const result = deserializeProject(JSON.stringify(raw));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain(field);
  });

  it('drops a malformed galvo setup so the galvo link refuses to mark until it is set up again', () => {
    const raw = JSON.parse(serializeProject(galvoProject()));
    raw.device.galvo = { ...raw.device.galvo, source: 'plasma' };
    const result = deserializeProject(JSON.stringify(raw));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.project.device.galvo).toBeUndefined();
  });
});
