import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { PROJECT_TEXT_TOO_LARGE_REASON } from './project-text-limit';
import { serializeProject, serializeProjectChunks } from './serialize-project';

// Rolling audit v5 J10-P3-3: an indented .lf2 took about 349 bytes per
// imported vector point, so about 1.5M points passed V8's 536,870,888-character
// string limit and Save failed with "Invalid string length"; the raw recovery
// copy used the same serializer and failed too. The limit itself is simulated
// here (JSON.stringify throws V8's RangeError) rather than built in memory.

const POINTS = 20_000;

describe('project save text size (J10-P3-3)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes a manual save compact, at about a third of the indented size per point', () => {
    const project = denseProject(POINTS);
    const prepared = prepareProjectForPersistence(project);
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);

    // Full-precision coordinates, stored as polylines and line curves.
    expect(serializeProject(project).length / POINTS).toBeGreaterThan(300);
    expect(prepared.json.length / POINTS).toBeLessThan(130);
    expect(deserializeProject(prepared.json)).toEqual(
      deserializeProject(serializeProject(project)),
    );
  });

  it('refuses a save past the text limit with a plain reason, and the recovery chunks still write', () => {
    const project = denseProject(2_000);
    const compact = serializeProject(project, { compact: true });
    throwTextLimitFor((value) => isRecord(value) && 'schemaVersion' in value);

    expect(prepareProjectForPersistence(project)).toEqual({
      kind: 'invalid',
      reason: PROJECT_TEXT_TOO_LARGE_REASON,
    });
    const chunks = serializeProjectChunks(project);
    vi.restoreAllMocks();
    expect(chunks.join('')).toBe(compact);
  });

  it('writes one object whose own text passes the limit through the chunked writer', () => {
    const project = denseProject(2_000);
    const compact = serializeProject(project, { compact: true });
    throwTextLimitFor((value) => isRecord(value) && value['kind'] === 'imported-svg');

    const chunks = serializeProjectChunks(project);
    vi.restoreAllMocks();
    expect(chunks.join('')).toBe(compact);
  });
});

function throwTextLimitFor(matches: (value: unknown) => boolean): void {
  const stringify = JSON.stringify.bind(JSON);
  vi.spyOn(JSON, 'stringify').mockImplementation(((
    value: unknown,
    replacer?: (number | string)[] | null,
    space?: string | number,
  ) => {
    if (matches(value)) throw new RangeError('Invalid string length');
    return stringify(value, replacer, space);
  }) as typeof JSON.stringify);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// One imported object of open 200-point polylines with full-precision
// coordinates, like the audit's dense SVG.
function denseProject(points: number): Project {
  const polylines = Array.from({ length: points / 200 }, (_, line) => ({
    closed: false,
    points: Array.from({ length: 200 }, (_, index) => ({
      x: ((line * 200 + index) * 7.31) / 3 + 1 / 7,
      y: (line * 1.37) / 3 + index / 9,
    })),
  }));
  const object: SceneObject = {
    kind: 'imported-svg',
    id: 'dense',
    source: 'map.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines }],
  };
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects: [object] } };
}
