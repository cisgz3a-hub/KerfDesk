// ADR-483: the laser finish position and saved head positions are optional
// DeviceProfile fields. They round-trip through a project file without a schema
// bump, stay absent when unset, and malformed values are rejected on load.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, PROJECT_SCHEMA_VERSION } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const SAVED = [
  { name: 'Corner jig', frame: 'bed' as const, xMm: 12.5, yMm: 40 },
  { name: 'Lens check', frame: 'origin' as const, xMm: -5, yMm: 0 },
];

function withDevice(patch: Record<string, unknown>): string {
  const raw = JSON.parse(serializeProject(createProject())) as {
    device: Record<string, unknown>;
  };
  Object.assign(raw.device, patch);
  return JSON.stringify(raw);
}

function reason(text: string): string | null {
  const result = deserializeProject(text);
  return result.kind === 'invalid' ? result.reason : null;
}

describe('project head positions (ADR-483)', () => {
  it('round-trips a bed finish position and saved positions', () => {
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      laserFinishPosition: { kind: 'bed', xMm: 10, yMm: 0 },
      savedPositions: SAVED,
    });
    const text = serializeProject(project);
    expect(JSON.parse(text).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

    const result = deserializeProject(text);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.laserFinishPosition).toEqual({ kind: 'bed', xMm: 10, yMm: 0 });
    expect(result.project.device.savedPositions).toEqual(SAVED);
  });

  it('round-trips stay', () => {
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      laserFinishPosition: { kind: 'stay' },
    });
    const result = deserializeProject(serializeProject(project));
    expect(result.kind === 'ok' ? result.project.device.laserFinishPosition : null).toEqual({
      kind: 'stay',
    });
  });

  it('keeps both fields absent for a profile that never set them', () => {
    const result = deserializeProject(serializeProject(createProject()));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect('laserFinishPosition' in result.project.device).toBe(false);
    expect('savedPositions' in result.project.device).toBe(false);
  });

  it.each([
    [{ kind: 'park' }],
    [{ kind: 'bed', xMm: '10', yMm: 0 }],
    [{ kind: 'bed', xMm: 10 }],
    [null],
    ['stay'],
  ])('rejects the malformed finish position %j', (finish) => {
    expect(reason(withDevice({ laserFinishPosition: finish }))).toBe(
      'missing or invalid `device.laserFinishPosition`',
    );
  });

  it('rejects a non-finite finish coordinate', () => {
    const text = withDevice({ laserFinishPosition: { kind: 'bed', xMm: 0, yMm: 0 } }).replace(
      '"yMm":0',
      '"yMm":1e999',
    );
    expect(reason(text)).toBe('missing or invalid `device.laserFinishPosition`');
  });

  it.each([
    [{ name: '  ', frame: 'bed', xMm: 0, yMm: 0 }],
    [{ name: 'Jig', frame: 'machine', xMm: 0, yMm: 0 }],
    [{ name: 'Jig', frame: 'origin', xMm: 0 }],
    [{ frame: 'bed', xMm: 0, yMm: 0 }],
  ])('rejects the malformed saved position %j and names its index', (bad) => {
    expect(reason(withDevice({ savedPositions: [SAVED[0], bad] }))).toBe(
      'missing or invalid `device.savedPositions[1]`',
    );
  });

  it('rejects saved positions that are not a list', () => {
    expect(reason(withDevice({ savedPositions: SAVED[0] }))).toBe(
      'missing or invalid `device.savedPositions`',
    );
  });
});
