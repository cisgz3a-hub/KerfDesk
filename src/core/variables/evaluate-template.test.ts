import { describe, expect, it } from 'vitest';
import {
  addLayer,
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
  type VariableTemplate,
} from '../scene';
import { evaluateVariableTemplate } from './evaluate-template';

const text: TextObject = {
  kind: 'text',
  id: 'T1',
  content: 'fallback',
  fontKey: 'roboto',
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#ff0000',
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
};

function variableProject(): Project {
  const project = createProject();
  return {
    ...project,
    variables: {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      serialValue: 7,
      csv: {
        sourceName: 'people.csv',
        headers: ['name'],
        records: [['Ada'], ['Grace']],
      },
    },
    scene: addLayer(project.scene, {
      ...createLayer({ id: '#ff0000', color: '#ff0000' }),
      power: 42,
      speed: 1234,
      passes: 2,
      airAssist: true,
    }),
  };
}

describe('evaluateVariableTemplate', () => {
  it.each([
    null,
    undefined,
    Object,
    Object.prototype,
    { kind: 'unknown' },
    { kind: 'literal' },
    { kind: 'date-time', format: 'unrecognized' },
    { kind: 'date-time', format: Object.create(null) },
    { kind: 'csv', column: 3 },
    { kind: 'serial', width: 4 },
    { kind: 'serial', prefix: '', width: 4, offset: 0.5 },
    { kind: 'cut-setting', field: 'unrecognized' },
    { kind: 'cut-setting', field: Object.create(null) },
  ])('returns a structured error for malformed token %#', (token) => {
    const malformed = { tokens: [token] } as unknown as VariableTemplate;
    expect(
      evaluateVariableTemplate(malformed, text, variableProject(), { now: new globalThis.Date(0) }),
    ).toMatchObject({ ok: false, message: expect.any(String) });
  });

  it.each([null, undefined, {}, { tokens: null }])(
    'returns a structured error for a malformed template %#',
    (template) => {
      expect(
        evaluateVariableTemplate(template as VariableTemplate, text, variableProject(), {
          now: new globalThis.Date(0),
        }),
      ).toMatchObject({ ok: false, message: expect.any(String) });
    },
  );

  it('evaluates every typed token from one injected context', () => {
    const template: VariableTemplate = {
      tokens: [
        { kind: 'literal', value: 'ID:' },
        { kind: 'serial', prefix: 'A-', width: 4 },
        { kind: 'literal', value: ' ' },
        { kind: 'csv', column: 'name' },
        { kind: 'literal', value: ' ' },
        { kind: 'date-time', format: 'date-iso' },
        { kind: 'literal', value: ' P=' },
        { kind: 'cut-setting', field: 'power-percent' },
      ],
    };

    expect(
      evaluateVariableTemplate(template, text, variableProject(), {
        now: new globalThis.Date('2026-07-12T05:06:07.000Z'),
        recordIndex: 1,
      }),
    ).toEqual({ ok: true, value: 'ID:A-0007 Grace 2026-07-12 P=42' });
  });

  it('reports missing CSV data and out-of-range records without substituting silently', () => {
    const template: VariableTemplate = { tokens: [{ kind: 'csv', column: 'missing' }] };

    expect(
      evaluateVariableTemplate(template, text, variableProject(), {
        now: new globalThis.Date(0),
        recordIndex: 99,
      }),
    ).toMatchObject({ ok: false });
    expect(
      evaluateVariableTemplate(
        template,
        text,
        { ...variableProject(), variables: DEFAULT_PROJECT_VARIABLE_DATA },
        { now: new globalThis.Date(0) },
      ),
    ).toEqual({ ok: false, message: 'This template needs an embedded CSV.' });
  });

  it('resolves CSV headers by exact identity before a unique canonical fallback', () => {
    const context = { now: new globalThis.Date(0) };

    for (const [headers, records] of [
      [
        ['Caf\u00e9', 'Cafe\u0301', 'city'],
        ['NFC', 'NFD', 'Paris'],
      ],
      [
        ['Cafe\u0301', 'city', 'Caf\u00e9'],
        ['NFD', 'Paris', 'NFC'],
      ],
    ] as const) {
      const project: Project = {
        ...variableProject(),
        variables: {
          ...DEFAULT_PROJECT_VARIABLE_DATA,
          csv: { sourceName: 'canonical.csv', headers, records: [records] },
        },
      };
      expect(
        evaluateVariableTemplate(
          { tokens: [{ kind: 'csv', column: 'Cafe\u0301' }] },
          text,
          project,
          context,
        ),
      ).toEqual({ ok: true, value: 'NFD' });
    }

    expect(
      evaluateVariableTemplate(
        { tokens: [{ kind: 'csv', column: 'Caf\u0065\u0301' }] },
        text,
        {
          ...variableProject(),
          variables: {
            ...DEFAULT_PROJECT_VARIABLE_DATA,
            csv: {
              sourceName: 'canonical.csv',
              headers: ['Caf\u00e9', 'city'],
              records: [['UNIQUE', 'Paris']],
            },
          },
        },
        context,
      ),
    ).toEqual({ ok: true, value: 'UNIQUE' });
  });

  it('reports canonical header ambiguity independent of header order', () => {
    const query = 'A\u030a\u0301';
    const equivalentHeaders = ['\u01fa', '\u00c5\u0301'];
    const context = { now: new globalThis.Date(0) };

    for (const headers of [equivalentHeaders, [...equivalentHeaders].reverse()]) {
      const project: Project = {
        ...variableProject(),
        variables: {
          ...DEFAULT_PROJECT_VARIABLE_DATA,
          csv: { sourceName: 'ambiguous.csv', headers, records: [['FIRST', 'SECOND']] },
        },
      };
      expect(
        evaluateVariableTemplate(
          { tokens: [{ kind: 'csv', column: query }] },
          text,
          project,
          context,
        ),
      ).toEqual({
        ok: false,
        message: `CSV column "${query}" is ambiguous because multiple canonically equivalent headers exist.`,
      });
    }
  });

  it('does not treat compatibility-only forms as the same CSV header', () => {
    const project: Project = {
      ...variableProject(),
      variables: {
        ...DEFAULT_PROJECT_VARIABLE_DATA,
        csv: { sourceName: 'compatibility.csv', headers: ['\ufb01'], records: [['ligature']] },
      },
    };

    expect(
      evaluateVariableTemplate({ tokens: [{ kind: 'csv', column: 'fi' }] }, text, project, {
        now: new globalThis.Date(0),
      }),
    ).toEqual({ ok: false, message: 'CSV column "fi" was not found.' });
  });

  it('normalizes the final joined value after token boundaries are composed', () => {
    const project: Project = {
      ...variableProject(),
      variables: {
        ...DEFAULT_PROJECT_VARIABLE_DATA,
        csv: { sourceName: 'marks.csv', headers: ['mark'], records: [['\u0301']] },
      },
    };

    expect(
      evaluateVariableTemplate(
        {
          tokens: [
            { kind: 'literal', value: 'Cafe' },
            { kind: 'csv', column: 'mark' },
          ],
        },
        text,
        project,
        { now: new globalThis.Date(0) },
      ),
    ).toEqual({ ok: true, value: 'Caf\u00e9' });
  });

  it.each<{
    name: string;
    settings: Pick<TextObject, 'powerScale' | 'operationOverride'>;
    expected: string;
  }>([
    { name: 'base operation', settings: {}, expected: '10/1000/1/off' },
    { name: 'scale only', settings: { powerScale: 25 }, expected: '2.5/1000/1/off' },
    {
      name: 'override only',
      settings: { operationOverride: { power: 80, speed: 500, passes: 3, airAssist: true } },
      expected: '80/500/3/on',
    },
    {
      name: 'override with scale',
      settings: {
        powerScale: 25,
        operationOverride: { power: 80, speed: 500, passes: 3, airAssist: true },
      },
      expected: '20/500/3/on',
    },
    {
      name: 'zero scale',
      settings: { powerScale: 0, operationOverride: { power: 80 } },
      expected: '0/1000/1/off',
    },
    {
      name: 'zero-power override',
      settings: { powerScale: 25, operationOverride: { power: 0 } },
      expected: '0/1000/1/off',
    },
    {
      name: 'fractional scale and partial override',
      settings: { powerScale: 12.5, operationOverride: { power: 80, speed: 321.5 } },
      expected: '10/321.5/1/off',
    },
  ])('evaluates $name from the explicitly bound operation', ({ settings, expected }) => {
    const fallback = {
      ...createLayer({ id: 'fallback', color: '#ff0000' }),
      power: 91,
      speed: 910,
      passes: 9,
      airAssist: false,
    };
    const bound = {
      ...createLayer({ id: 'bound', color: '#0000ff' }),
      power: 10,
      speed: 1000,
      passes: 1,
      airAssist: false,
    };
    const effectiveText: TextObject = {
      ...text,
      paths: [{ color: text.color, operationIds: ['bound'], polylines: [] }],
      ...settings,
    };
    const project: Project = {
      ...variableProject(),
      scene: { objects: [effectiveText], layers: [fallback, bound] },
    };
    const template: VariableTemplate = {
      tokens: [
        { kind: 'cut-setting', field: 'power-percent' },
        { kind: 'literal', value: '/' },
        { kind: 'cut-setting', field: 'speed-mm-min' },
        { kind: 'literal', value: '/' },
        { kind: 'cut-setting', field: 'passes' },
        { kind: 'literal', value: '/' },
        { kind: 'cut-setting', field: 'air-assist' },
      ],
    };

    expect(
      evaluateVariableTemplate(template, effectiveText, project, {
        now: new globalThis.Date(0),
      }),
    ).toEqual({ ok: true, value: expected });
  });

  it('does not replace a missing explicit operation with same-color settings', () => {
    expect(
      evaluateVariableTemplate(
        { tokens: [{ kind: 'cut-setting', field: 'power-percent' }] },
        { ...text, operationIds: ['missing'], operationOverride: { power: 80 } },
        variableProject(),
        { now: new globalThis.Date(0) },
      ),
    ).toEqual({ ok: false, message: 'No operation is assigned to this text.' });
  });
});
