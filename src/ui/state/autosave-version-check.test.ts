// The version check every autosave commit and clear runs on the snapshots it
// is about to replace (ADR-305 Amendment 1): a snapshot this build wrote is
// recognised from the head of its text instead of by parsing all of it.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProject } from '../../core/scene';
import { PROJECT_SCHEMA_VERSION } from '../../core/scene/project';
import { serializeProject } from '../../io/project/serialize-project';
import {
  AUTOSAVE_SCHEMA_VERSION,
  requireSupportedAutosaveVersion,
  UnsupportedAutosaveVersionError,
} from './autosave-record';

function snapshot(projectJson: string): unknown {
  return { schemaVersion: AUTOSAVE_SCHEMA_VERSION, savedAt: 1, projectJson };
}

function withVersion(version: number, lead: boolean): string {
  const { schemaVersion: _current, ...rest } = createProject();
  return JSON.stringify(
    lead ? { schemaVersion: version, ...rest } : { ...rest, schemaVersion: version },
  );
}

afterEach(() => vi.restoreAllMocks());

describe('requireSupportedAutosaveVersion', () => {
  it('accepts a snapshot this build wrote without parsing its text', () => {
    const compact = serializeProject({ ...createProject(), notes: 'compact' }, { compact: true });
    const pretty = serializeProject({ ...createProject(), notes: 'pretty' });
    expect(compact.startsWith(`{"schemaVersion":${PROJECT_SCHEMA_VERSION},`)).toBe(true);
    const parse = vi.spyOn(JSON, 'parse');

    requireSupportedAutosaveVersion(snapshot(compact));
    requireSupportedAutosaveVersion(snapshot(pretty));

    expect(parse).not.toHaveBeenCalled();
  });

  it('still refuses a snapshot from a newer or an older build that leads with its version', () => {
    for (const version of [PROJECT_SCHEMA_VERSION + 1, 0]) {
      expect(() => requireSupportedAutosaveVersion(snapshot(withVersion(version, true)))).toThrow(
        UnsupportedAutosaveVersionError,
      );
    }
  });

  it('parses text that does not lead with its version, and judges it as before', () => {
    const parse = vi.spyOn(JSON, 'parse');
    requireSupportedAutosaveVersion(snapshot(withVersion(PROJECT_SCHEMA_VERSION, false)));
    expect(parse).toHaveBeenCalledTimes(1);

    expect(() =>
      requireSupportedAutosaveVersion(snapshot(withVersion(PROJECT_SCHEMA_VERSION + 1, false))),
    ).toThrow(UnsupportedAutosaveVersionError);
  });

  it('is not misled by a version that belongs to something inside the project', () => {
    const nested = JSON.stringify({
      scene: { schemaVersion: PROJECT_SCHEMA_VERSION },
      schemaVersion: PROJECT_SCHEMA_VERSION + 1,
    });
    expect(() => requireSupportedAutosaveVersion(snapshot(nested))).toThrow(
      UnsupportedAutosaveVersionError,
    );
  });

  it('leaves unreadable text and other values alone, as before', () => {
    expect(() => requireSupportedAutosaveVersion(snapshot('{"schemaVersion":'))).not.toThrow();
    expect(() => requireSupportedAutosaveVersion(undefined)).not.toThrow();
    expect(() => requireSupportedAutosaveVersion({ savedAt: 1 })).not.toThrow();
  });
});
