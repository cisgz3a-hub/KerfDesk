import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { createProductionManifest } from '../../core/scene/production-manifest';
import { serializeProject } from './serialize-project';
import { deserializeProject } from './deserialize-project';
import { visitWorkflowArchives } from './project-workflow-archives';

describe('bounded workflow archives', () => {
  it('visits sheets, production variants and array sources through bounded composition', () => {
    const array = {
      sourceProjectJson: JSON.stringify({ tag: 'array-source' }),
      baselineProjectJson: JSON.stringify({ tag: 'baseline' }),
    };
    const production = {
      designProjectJson: JSON.stringify({ tag: 'design', arrayLayouts: [array] }),
      rows: [{ reviewedProjectJson: JSON.stringify({ tag: 'review' }) }],
    };
    const project = {
      sheetBook: {
        inactive: [
          { projectJson: JSON.stringify({ tag: 'sheet', productionManifest: production }) },
        ],
      },
    };
    const visited: unknown[] = [];
    expect(visitWorkflowArchives(project, (raw) => visited.push(raw['tag']))).toBeNull();
    expect(visited).toEqual(['sheet', 'design', 'review', 'array-source', 'baseline']);
  });
  it('rejects the combined archive budget before parsing a huge payload', () => {
    const oversized = { productionManifest: { designProjectJson: ' '.repeat(50_000_001) } };
    expect(visitWorkflowArchives(oversized)).toMatch(/budget/);
    expect(visitWorkflowArchives({ arrayLayouts: [{ sourceProjectJson: 'null' }] })).toMatch(
      /Invalid/,
    );
    expect(
      visitWorkflowArchives({ sheetBook: { inactive: [{ projectJson: '{broken' }] } }),
    ).toMatch(/JSON/);
  });
  it('preserves old project semantics under schema13 and rejects malformed run identity', () => {
    const project = createProject();
    const legacy = deserializeProject(JSON.stringify({ ...project, schemaVersion: 12 }));
    expect(legacy.kind).toBe('ok');
    if (legacy.kind !== 'ok') throw new Error('Expected v12 migration');
    expect(legacy.project).toEqual(project);
    let id = 0;
    const manifest = createProductionManifest(project, {
      name: 'Run',
      count: 2,
      now: new Date('2026-10-07T00:00:00.000Z'),
      designProjectJson: serializeProject(project),
      idFactory: () => String(++id),
    });
    const valid = { ...project, productionManifest: manifest };
    expect(deserializeProject(serializeProject(valid)).kind).toBe('ok');
    const duplicate = { ...manifest, rows: manifest.rows.map((row) => ({ ...row, id: 'same' })) };
    expect(
      deserializeProject(serializeProject({ ...project, productionManifest: duplicate })).kind,
    ).not.toBe('ok');
    const noVariant = {
      ...manifest,
      rows: manifest.rows.map((row) => ({ ...row, status: 'completed' as const })),
    };
    expect(
      deserializeProject(serializeProject({ ...project, productionManifest: noVariant })).kind,
    ).not.toBe('ok');
  });
});
