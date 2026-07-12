import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from '../gcode';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('schema v1 curve migration acceptance', () => {
  it('migrates a multi-path corpus without changing points or closure', () => {
    const current = normalizedProject();
    const result = deserializeProject(asVersionOne(current));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    const object = result.project.scene.objects[0];
    if (object?.kind !== 'imported-svg') throw new Error('Expected imported SVG fixture');
    expect(object.paths.map((path) => path.curves)).toEqual([
      [
        {
          start: { x: 1, y: 1 },
          segments: [
            { kind: 'line', to: { x: 20, y: 1 } },
            { kind: 'line', to: { x: 20, y: 10 } },
          ],
          closed: false,
        },
        {
          start: { x: 30, y: 1 },
          segments: [
            { kind: 'line', to: { x: 40, y: 1 } },
            { kind: 'line', to: { x: 35, y: 10 } },
          ],
          closed: true,
        },
      ],
    ]);
  });

  it('keeps production G-code byte-identical for migrated line-only projects', () => {
    const current = normalizedProject();
    const migrated = deserializeProject(asVersionOne(current));
    expect(migrated.kind).toBe('ok');
    if (migrated.kind !== 'ok') return;

    const currentOutput = emitGcode(current);
    const migratedOutput = emitGcode(migrated.project);
    expect(currentOutput.preflight.ok).toBe(true);
    expect(migratedOutput.preflight.ok).toBe(true);
    expect(migratedOutput.gcode).toBe(currentOutput.gcode);
  });
});

function normalizedProject(): Project {
  const color = '#ff0000';
  const object: SceneObject = {
    kind: 'imported-svg',
    id: 'migration-corpus',
    source: 'migration-corpus.svg',
    bounds: { minX: 1, minY: 1, maxX: 40, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            points: [
              { x: 1, y: 1 },
              { x: 20, y: 1 },
              { x: 20, y: 10 },
            ],
            closed: false,
          },
          {
            points: [
              { x: 30, y: 1 },
              { x: 40, y: 1 },
              { x: 35, y: 10 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  const base = createProject();
  const project = {
    ...base,
    scene: addLayer(addObject(base.scene, object), createLayer({ id: 'migration-layer', color })),
  };
  const normalized = deserializeProject(serializeProject(project));
  if (normalized.kind !== 'ok') {
    throw new Error(`Could not normalize migration fixture: ${JSON.stringify(normalized)}`);
  }
  return normalized.project;
}

function asVersionOne(project: Project): string {
  const raw = JSON.parse(serializeProject(project)) as {
    schemaVersion: number;
    scene: { objects: Array<{ paths?: Array<Record<string, unknown>> }> };
  };
  raw.schemaVersion = 1;
  for (const object of raw.scene.objects) {
    for (const path of object.paths ?? []) delete path['curves'];
  }
  return `${JSON.stringify(raw)}\n`;
}
