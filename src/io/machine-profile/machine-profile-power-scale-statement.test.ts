// ADR-095 Amendment 1: the operator's power-scale statement is stored with the
// machine profile. It survives a profile file and a project, and a malformed
// one is dropped rather than trusted or allowed to fail the load.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  createOperatorPowerScaleStatement,
  standingPowerScaleStatement,
} from '../../core/devices/power-scale-statement';
import { createProject } from '../../core/scene';
import { deserializeProject } from '../project/deserialize-project';
import { serializeProject } from '../project/serialize-project';
import {
  deserializeMachineProfileDocument,
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  serializeMachineProfileDocument,
} from './machine-profile-io';

const MARLIN: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileSource: 'custom',
  controllerKind: 'marlin',
  gcodeDialect: { dialectId: 'marlin-inline' },
  streamingMode: 'ping-pong',
  maxPowerS: 255,
};
const STATEMENT = createOperatorPowerScaleStatement(MARLIN, '2026-11-11T10:00:00.000Z');
if (STATEMENT === null) throw new Error('fixture: Marlin takes a statement');
const STATED: DeviceProfile = { ...MARLIN, operatorPowerScaleStatement: STATEMENT };

function profileText(profile: DeviceProfile, statement?: unknown): string {
  const text = serializeMachineProfileDocument({
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile,
    source: { kind: 'custom', label: 'My Marlin laser' },
    reviewNotes: [],
  });
  if (statement === undefined) return text;
  const document = JSON.parse(text) as { profile: Record<string, unknown> };
  document.profile['operatorPowerScaleStatement'] = statement;
  return JSON.stringify(document);
}

describe('the operator power-scale statement in saved files', () => {
  it('survives a machine profile file', () => {
    const loaded = deserializeMachineProfileDocument(profileText(STATED));
    if (loaded.kind !== 'ok') throw new Error('expected profile');
    expect(loaded.document.profile.operatorPowerScaleStatement).toEqual(STATEMENT);
    expect(standingPowerScaleStatement(loaded.document.profile)).toEqual(STATEMENT);
  });

  it('survives a project', () => {
    const loaded = deserializeProject(serializeProject(createProject(STATED)));
    if (loaded.kind !== 'ok') throw new Error('expected project');
    expect(loaded.project.device.operatorPowerScaleStatement).toEqual(STATEMENT);
    const plain = deserializeProject(serializeProject(createProject(MARLIN)));
    if (plain.kind !== 'ok') throw new Error('expected project');
    expect(plain.project.device.operatorPowerScaleStatement).toBeUndefined();
  });

  it.each([true, 'checked', { ...STATEMENT, maxPowerS: 0 }, { ...STATEMENT, statedAtIso: 7 }])(
    'drops a malformed statement (%j) and still loads the profile',
    (bad) => {
      const loaded = deserializeMachineProfileDocument(profileText(MARLIN, bad));
      if (loaded.kind !== 'ok') throw new Error('expected profile');
      expect(loaded.document.profile.operatorPowerScaleStatement).toBeUndefined();
      const project = JSON.parse(serializeProject(createProject(MARLIN))) as {
        device: Record<string, unknown>;
      };
      project.device['operatorPowerScaleStatement'] = bad;
      const reloaded = deserializeProject(JSON.stringify(project));
      if (reloaded.kind !== 'ok') throw new Error('expected project');
      expect(reloaded.project.device.operatorPowerScaleStatement).toBeUndefined();
    },
  );

  it('a statement for another Full-power S loads but stands for nothing', () => {
    const edited = profileText(MARLIN, { ...STATEMENT, maxPowerS: 100 });
    const loaded = deserializeMachineProfileDocument(edited);
    if (loaded.kind !== 'ok') throw new Error('expected profile');
    expect(standingPowerScaleStatement(loaded.document.profile)).toBeNull();
  });
});
