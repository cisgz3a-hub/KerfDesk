import { describe, expect, it } from 'vitest';
import {
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function projectWithVariables(): Project {
  const project = createProject();
  const text: TextObject = {
    kind: 'text',
    id: 'T1',
    content: 'fallback',
    variableTemplate: {
      tokens: [
        { kind: 'literal', value: 'Hello ' },
        { kind: 'csv', column: 'name' },
        { kind: 'serial', prefix: '#', width: 3 },
      ],
    },
    fontKey: 'roboto',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
  return {
    ...project,
    variables: {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      csv: { sourceName: 'people.csv', headers: ['name'], records: [['Ada']] },
    },
    scene: { ...project.scene, objects: [text] },
  };
}

describe('project variable persistence', () => {
  it('round-trips structured templates and embedded CSV records', () => {
    const project = projectWithVariables();
    const result = deserializeProject(serializeProject(project));

    expect(result).toEqual({ kind: 'ok', project });
  });

  it('rejects invalid token fields and uneven embedded records', () => {
    const badToken = JSON.parse(serializeProject(projectWithVariables())) as Record<
      string,
      unknown
    >;
    const scene = badToken['scene'] as { objects: Array<Record<string, unknown>> };
    const template = scene.objects[0]?.['variableTemplate'] as {
      tokens: Array<Record<string, unknown>>;
    };
    if (template.tokens[2] !== undefined) template.tokens[2]['width'] = 0;

    const badCsv = JSON.parse(serializeProject(projectWithVariables())) as Record<string, unknown>;
    const variables = badCsv['variables'] as { csv: { records: string[][] } };
    variables.csv.records = [['Ada', 'extra']];

    expect(deserializeProject(JSON.stringify(badToken))).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('width'),
    });
    expect(deserializeProject(JSON.stringify(badCsv))).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('records[0]'),
    });
  });
});
