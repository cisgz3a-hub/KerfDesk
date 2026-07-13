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
});
