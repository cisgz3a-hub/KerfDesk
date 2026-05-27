import { describe, expect, it } from 'vitest';
import { PROJECT_SCHEMA_VERSION } from '../../core/scene';
import { migrateToCurrent, type Migrator } from './migrations';

describe('migrateToCurrent', () => {
  it('returns ok with no steps when sawVersion === current', () => {
    const r = migrateToCurrent({ schemaVersion: PROJECT_SCHEMA_VERSION }, PROJECT_SCHEMA_VERSION);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.steps).toEqual([]);
  });

  it('reports no-path when sawVersion < current and no migrator covers the gap', () => {
    // Phase A ships PROJECT_SCHEMA_VERSION=1 with an empty registry, so a
    // v0 file should report no-path; deserialize-project surfaces this as
    // schema-too-old (the spec-compliant "Could not open" flow).
    const r = migrateToCurrent({}, 0);
    expect(r.kind).toBe('no-path');
  });

  it('walks the registry from sawVersion upward', () => {
    const fakeRegistry: Readonly<Record<number, Migrator>> = {
      0: (raw) => ({ ...raw, addedAtV0: true }),
    };
    // Synthetic: pretend current is 1 (which it is in Phase A) and a
    // 0→1 migrator is registered.
    const r = migrateToCurrent({ schemaVersion: 0 }, 0, fakeRegistry);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.steps).toEqual([0]);
      expect(r.raw['addedAtV0']).toBe(true);
      expect(r.raw['schemaVersion']).toBe(PROJECT_SCHEMA_VERSION);
    }
  });
});
