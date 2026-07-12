import { describe, expect, it, vi } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import { prepareOutput } from './prepare-output';
import { prepareOutputSnapshot, type VariableTextRenderer } from './prepare-output-snapshot';

const NOW = new globalThis.Date('2026-07-12T01:02:03.000Z');

function variableProject(): Project {
  const project = createProject();
  const layer = { ...createLayer({ id: '#000000', color: '#000000' }), mode: 'line' as const };
  const text: TextObject = {
    kind: 'text',
    id: 'T1',
    content: 'fallback',
    variableTemplate: {
      tokens: [
        { kind: 'csv', column: 'name' },
        { kind: 'literal', value: '-' },
        { kind: 'serial', prefix: '', width: 2 },
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
      serialValue: 7,
      csv: { sourceName: 'names.csv', headers: ['name'], records: [['Ada']] },
    },
    scene: addObject(addLayer(project.scene, layer), text),
  };
}

const renderer: VariableTextRenderer = vi.fn(async ({ text, content }) => ({
  bounds: { minX: 0, minY: 0, maxX: content.length, maxY: 1 },
  paths: [
    {
      color: text.color,
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: content.length, y: 0 },
          ],
        },
      ],
    },
  ],
}));

describe('prepareOutputSnapshot', () => {
  it('evaluates and renders variable text once for a stable project/context', async () => {
    const project = variableProject();
    const options = { clock: () => NOW, renderVariableText: renderer };

    const first = await prepareOutputSnapshot(project, options);
    const second = await prepareOutputSnapshot(project, options);

    expect(first.ok).toBe(true);
    if (first.ok) {
      const evaluated = first.project.scene.objects[0];
      expect(evaluated?.kind === 'text' && evaluated.content).toBe('Ada-07');
      expect(evaluated?.kind === 'text' && evaluated.variableTemplate).toBeUndefined();
      expect(first.job.groups).not.toHaveLength(0);
    }
    expect(second).toBe(first);
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it('returns a typed preflight failure instead of stale fallback geometry', async () => {
    const project = variableProject();
    const { csv: _csv, ...variables } = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
    const missingCsv: Project = { ...project, variables };

    const result = await prepareOutputSnapshot(missingCsv, {
      clock: () => NOW,
      renderVariableText: renderer,
    });

    expect(result).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'variable-evaluation-failed' }] },
    });
  });

  it('keeps non-variable projects identical to the pure preparation pipeline', async () => {
    const project = createProject();

    const snapshot = await prepareOutputSnapshot(project, {
      clock: () => NOW,
      renderVariableText: renderer,
    });

    expect(snapshot).toMatchObject(prepareOutput(project));
  });
});
