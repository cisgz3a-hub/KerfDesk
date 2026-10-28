// ADR-675: a device profile's kinematics survive a profile file and a project;
// absent stays absent (Cartesian), and an unknown value is not trusted.

import { describe, expect, it } from 'vitest';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { createProject } from '../../core/scene';
import { deserializeProject } from '../project/deserialize-project';
import { serializeProject } from '../project/serialize-project';
import {
  deserializeMachineProfileDocument,
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  serializeMachineProfileDocument,
} from './machine-profile-io';

function profileText(kinematics: unknown): string {
  const text = serializeMachineProfileDocument({
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile: { ...FALCON_A1_PRO_GRBLHAL_PROFILE, profileSource: 'custom' },
    source: { kind: 'custom', label: 'My A1 Pro' },
    reviewNotes: [],
  });
  const document = JSON.parse(text) as { profile: Record<string, unknown> };
  document.profile['kinematics'] = kinematics;
  return JSON.stringify(document);
}

describe('kinematics persistence (ADR-675)', () => {
  it('keeps CoreXY through a machine profile file and refuses an unknown layout', () => {
    const loaded = deserializeMachineProfileDocument(profileText('corexy'));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') expect(loaded.document.profile.kinematics).toBe('corexy');
    expect(deserializeMachineProfileDocument(profileText('delta'))).toMatchObject({
      kind: 'invalid',
      reason: 'profile.kinematics is invalid',
    });
  });

  it('keeps CoreXY through a project and leaves a Cartesian one without the field', () => {
    const coreXy = createProject(FALCON_A1_PRO_GRBLHAL_PROFILE);
    const loaded = deserializeProject(serializeProject(coreXy));
    if (loaded.kind !== 'ok') throw new Error('expected project');
    expect(loaded.project.device.kinematics).toBe('corexy');
    const plain = deserializeProject(serializeProject(createProject()));
    if (plain.kind !== 'ok') throw new Error('expected project');
    expect(plain.project.device.kinematics).toBeUndefined();
  });
});
