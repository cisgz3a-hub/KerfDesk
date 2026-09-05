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
      sequence: {
        recordStartIndex: 0,
        recordEndIndex: 0,
        serialStartValue: 10,
        serialEndValue: 99,
        advanceBy: 2,
      },
    },
    scene: { ...project.scene, objects: [text] },
  };
}

describe('project variable persistence', () => {
  it.each([
    ['date-time', 'format', ['date-iso']],
    ['date-time', 'format', { toString: null }],
    ['cut-setting', 'field', ['speed-mm-min']],
    ['cut-setting', 'field', { toString: null }],
  ] as const)(
    'rejects malformed %s %s with a structured import error (%#)',
    (kind, field, value) => {
      const raw = JSON.parse(serializeProject(projectWithVariables())) as {
        scene: { objects: Array<{ variableTemplate: { tokens: unknown[] } }> };
      };
      const object = raw.scene.objects[0];
      if (object === undefined) throw new Error('variable text fixture is missing');
      object.variableTemplate.tokens = [{ kind, [field]: value }];
      expect(deserializeProject(JSON.stringify(raw))).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining(`tokens[0].${field}`),
      });
    },
  );

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'returns a structured import error for inherited token kind %s',
    (kind) => {
      const raw = JSON.parse(serializeProject(projectWithVariables())) as {
        scene: { objects: Array<{ variableTemplate: { tokens: unknown[] } }> };
      };
      const object = raw.scene.objects[0];
      if (object === undefined) throw new Error('variable text fixture is missing');
      object.variableTemplate.tokens = [{ kind }];
      expect(deserializeProject(JSON.stringify(raw))).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('tokens[0].kind'),
      });
    },
  );

  it('round-trips structured templates and embedded CSV records', () => {
    const project = projectWithVariables();
    const result = deserializeProject(serializeProject(project));

    expect(result).toEqual({ kind: 'ok', project });
  });

  it('round-trips canonical-equivalent CSV and token identities without collapsing them', () => {
    const project = projectWithVariables();
    const variableText = project.scene.objects[0];
    if (variableText?.kind !== 'text') throw new Error('variable text fixture is missing');
    const withCanonicalTwins: Project = {
      ...project,
      variables: {
        ...(project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA),
        csv: {
          sourceName: 'canonical.csv',
          headers: ['Caf\u00e9', 'Cafe\u0301'],
          records: [['Caf\u00e9', 'Cafe\u0301']],
        },
      },
      scene: {
        ...project.scene,
        objects: [
          {
            ...variableText,
            variableTemplate: { tokens: [{ kind: 'csv', column: 'Cafe\u0301' }] },
          },
        ],
      },
    };

    expect(deserializeProject(serializeProject(withCanonicalTwins))).toEqual({
      kind: 'ok',
      project: withCanonicalTwins,
    });
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

  it('rejects inverted variable sequence ranges', () => {
    const raw = JSON.parse(serializeProject(projectWithVariables())) as {
      variables: { sequence: { recordStartIndex: number; recordEndIndex: number } };
    };
    raw.variables.sequence.recordStartIndex = 5;
    raw.variables.sequence.recordEndIndex = 2;

    expect(deserializeProject(JSON.stringify(raw))).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('recordEndIndex'),
    });
  });

  it('round-trips full safe-integer serial settings and rejects unsafe values', () => {
    const project = projectWithVariables();
    const maximum = Number.MAX_SAFE_INTEGER;
    const withMaximums: Project = {
      ...project,
      variables: {
        ...DEFAULT_PROJECT_VARIABLE_DATA,
        ...project.variables,
        serialValue: maximum,
        sequence: {
          recordStartIndex: 0,
          recordEndIndex: 0,
          serialStartValue: maximum - 2,
          serialEndValue: maximum,
          advanceBy: maximum,
        },
      },
    };

    expect(deserializeProject(serializeProject(withMaximums))).toEqual({
      kind: 'ok',
      project: withMaximums,
    });

    const unsafe = JSON.parse(serializeProject(withMaximums)) as {
      variables: { sequence: { advanceBy: number } };
    };
    unsafe.variables.sequence.advanceBy = maximum + 1;
    expect(deserializeProject(JSON.stringify(unsafe))).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('advanceBy'),
    });
  });
});
