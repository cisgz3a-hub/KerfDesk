import { describe, expect, it } from 'vitest';
import { decodeCanonicalBase64, encodeCanonicalBase64 } from '../../core/relief/depth-map-base64';
import { reliefHeightfieldDigest } from '../../core/relief/heightfield-digest';
import { heightfieldToHeightmap } from '../../core/relief/heightfield-to-heightmap';
import { createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import type { ReliefHeightfield } from '../../core/scene/relief';
import { deserializeProject } from './deserialize-project';
import {
  migrateV3ReliefSources,
  type ReliefMigrationRuntime,
} from './migrate-v4-relief-heightfields';
import { isMigrationFailure } from './migration-failure';

describe('v3 to v4 relief source migration', () => {
  it('widens every U8 code losslessly to U16LE with v * 257', () => {
    const migrated = migrateV3ReliefSources(projectWith(depthRelief(8, [0, 1, 127, 255])));
    const source = migratedSource(migrated);
    const decoded = decodeCanonicalBase64(source.samplesBase64);

    expect(decoded.kind).toBe('ok');
    if (decoded.kind !== 'ok') return;
    expect([...decoded.bytes]).toEqual([0, 0, 1, 1, 127, 127, 255, 255]);
    expect(source).toMatchObject({
      encoding: 'u16le-base64-v1',
      provenance: { sourceBitDepth: 8, sourcePolarity: 'light-is-high' },
    });
  });

  it('changes U16 network byte order to little endian without changing numeric codes', () => {
    const migrated = migrateV3ReliefSources(
      projectWith(depthRelief(16, [0x00, 0x00, 0x12, 0x34, 0xff, 0xff])),
    );
    const source = migratedSource(migrated);
    const decoded = decodeCanonicalBase64(source.samplesBase64);

    expect(decoded.kind).toBe('ok');
    if (decoded.kind === 'ok') expect([...decoded.bytes]).toEqual([0, 0, 0x34, 0x12, 0xff, 0xff]);
  });

  it('retains light-is-deep meaning while canonical height codes still resolve correctly', () => {
    const migrated = migrateV3ReliefSources(
      projectWith(depthRelief(8, [0, 255], { width: 2, polarity: 'light-is-deep' })),
    );
    const source = migratedSource(migrated);
    const resolved = heightfieldToHeightmap(source, {
      targetWidthMm: 100,
      reliefDepthMm: 5,
      mmPerCell: 50,
    });

    expect(source.mapping.polarity).toBe('light-is-deep');
    expect(source.provenance.sourcePolarity).toBe('light-is-deep');
    expect(resolved.kind).toBe('ok');
    if (resolved.kind === 'ok') expect([...resolved.heightmap.depth]).toEqual([0, -5]);
  });

  it('moves mesh fields into the legacy-mesh branch without changing their values', () => {
    const positions = [0, 0, 0, 10, 0, 0, 0, 10, 5];
    const migrated = migrateV3ReliefSources(
      projectWith({
        ...reliefCommon('mesh.stl'),
        meshPositions: positions,
        emptyCells: 'top',
      }),
    );
    const object = migratedObject(migrated);

    expect(object['meshPositions']).toBeUndefined();
    expect(object['emptyCells']).toBeUndefined();
    expect(object['reliefSource']).toEqual({
      kind: 'legacy-mesh',
      meshPositions: positions,
      emptyCells: 'top',
    });
  });

  it('is pure and deterministic for the same v3 input', () => {
    const input = projectWith(depthRelief(8, [0, 64, 128, 255]));
    const snapshot = structuredClone(input);

    const first = migrateV3ReliefSources(input);
    const second = migrateV3ReliefSources(input);

    expect(input).toEqual(snapshot);
    expect(first).toEqual(second);
    expect(first).not.toBe(input);
  });

  it('does not throw or legitimize malformed, oversized, or ambiguous legacy sources', () => {
    const malformed = [
      depthRelief(8, [0], { width: 2 }),
      depthRelief(8, [0], { width: Number.MAX_SAFE_INTEGER, height: 2 }),
      {
        ...depthRelief(8, [0]),
        meshPositions: [0, 0, 0, 1, 0, 0, 0, 1, 1],
        emptyCells: 'floor',
      },
    ];

    for (const object of malformed) {
      const raw = projectWith(object);
      expect(() => migrateV3ReliefSources(raw)).not.toThrow();
      expect(deserializeProject(JSON.stringify(raw))).toMatchObject({ kind: 'invalid' });
    }
  });

  it('does not overwrite an existing source authority when a legacy arm is also present', () => {
    const existingSource = {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 1, 0, 0, 0, 1, 1],
      emptyCells: 'top',
    };
    const collisions = [
      { ...depthRelief(8, [0, 255]), reliefSource: existingSource },
      {
        ...reliefCommon('mesh.stl'),
        meshPositions: [0, 0, 0, 2, 0, 0, 0, 2, 1],
        emptyCells: 'floor',
        reliefSource: existingSource,
      },
    ];

    for (const object of collisions) {
      const raw = projectWith(object);
      const migrated = migrateV3ReliefSources(raw);
      expect(migratedObject(migrated)['reliefSource']).toEqual(existingSource);
      expect(deserializeProject(JSON.stringify(raw))).toMatchObject({ kind: 'invalid' });
    }
  });

  it('returns field-specific failures for every allocation-bearing migration stage', () => {
    const cases: ReadonlyArray<{
      readonly override: Partial<ReliefMigrationRuntime>;
      readonly field: string;
    }> = [
      {
        override: {
          decodeBase64: () => ({
            kind: 'error',
            code: 'allocation',
            reason: 'controlled decode allocation failure',
          }),
        },
        field: 'scene.objects[0].depthMap.samplesBase64',
      },
      {
        override: {
          allocateBytes: () => {
            throw new RangeError('controlled output allocation failure');
          },
        },
        field: 'scene.objects[0].depthMap.samplesBase64',
      },
      {
        override: {
          encodeBase64: () => {
            throw new RangeError('controlled base64 re-encoding failure');
          },
        },
        field: 'scene.objects[0].reliefSource.samplesBase64',
      },
      {
        override: {
          digest: () => {
            throw new RangeError('controlled digest allocation failure');
          },
        },
        field: 'scene.objects[0].reliefSource.digest',
      },
    ];

    for (const { override, field } of cases) {
      const migrated = migrateV3ReliefSources(
        projectWith(depthRelief(8, [0, 255])),
        migrationRuntime(override),
      );
      expect(isMigrationFailure(migrated)).toBe(true);
      if (isMigrationFailure(migrated)) {
        expect(migrated.reason).toBe(
          `allocation failed for \`${field}\` during schema-v4 migration`,
        );
      }
    }
  });
});

function migrationRuntime(override: Partial<ReliefMigrationRuntime>): ReliefMigrationRuntime {
  return {
    decodeBase64: decodeCanonicalBase64,
    allocateBytes: (byteLength) => new Uint8Array(byteLength),
    encodeBase64: encodeCanonicalBase64,
    digest: reliefHeightfieldDigest,
    ...override,
  };
}

function projectWith(object: Record<string, unknown>): Record<string, unknown> {
  const project = createProject();
  return {
    ...project,
    schemaVersion: 3,
    scene: { ...project.scene, objects: [object] },
  };
}

function reliefCommon(source: string): Record<string, unknown> {
  return {
    kind: 'relief',
    id: 'R1',
    source,
    targetWidthMm: 100,
    reliefDepthMm: 5,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
  };
}

function depthRelief(
  bitDepth: 8 | 16,
  bytes: ReadonlyArray<number>,
  overrides: { readonly width?: number; readonly height?: number; readonly polarity?: string } = {},
): Record<string, unknown> {
  const width = overrides.width ?? bytes.length / (bitDepth / 8);
  const height = overrides.height ?? 1;
  return {
    ...reliefCommon('depth.png'),
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 * (height / width) },
    depthMap: {
      schemaVersion: 1,
      width,
      height,
      bitDepth,
      samplesBase64: Buffer.from(bytes).toString('base64'),
      polarity: overrides.polarity ?? 'light-is-high',
    },
  };
}

function migratedObject(raw: ReturnType<typeof migrateV3ReliefSources>): Record<string, unknown> {
  if (isMigrationFailure(raw)) throw new Error(raw.reason);
  const scene = raw['scene'];
  if (typeof scene !== 'object' || scene === null) throw new Error('migrated scene missing');
  const objects = (scene as Record<string, unknown>)['objects'];
  if (!Array.isArray(objects) || typeof objects[0] !== 'object' || objects[0] === null) {
    throw new Error('migrated relief missing');
  }
  return objects[0] as Record<string, unknown>;
}

function migratedSource(raw: ReturnType<typeof migrateV3ReliefSources>): ReliefHeightfield {
  const source = migratedObject(raw)['reliefSource'];
  if (typeof source !== 'object' || source === null) throw new Error('migrated source missing');
  return source as ReliefHeightfield;
}
