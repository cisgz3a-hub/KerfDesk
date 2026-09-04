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

  it('normalizes composed variable content before rendering and compiled preparation', async () => {
    const base = variableProject();
    const variableText = base.scene.objects[0];
    if (variableText?.kind !== 'text') throw new Error('variable text fixture is missing');
    const rendered: string[] = [];
    const capturingRenderer: VariableTextRenderer = async ({ text, content }) => {
      rendered.push(content);
      return {
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
      };
    };
    const splitProject: Project = {
      ...base,
      variables: {
        ...(base.variables ?? DEFAULT_PROJECT_VARIABLE_DATA),
        csv: { sourceName: 'marks.csv', headers: ['mark'], records: [['\u0301']] },
      },
      scene: {
        ...base.scene,
        objects: [
          {
            ...variableText,
            variableTemplate: {
              tokens: [
                { kind: 'literal', value: 'Cafe' },
                { kind: 'csv', column: 'mark' },
              ],
            },
          },
        ],
      },
    };
    const composedProject: Project = {
      ...splitProject,
      scene: {
        ...splitProject.scene,
        objects: [
          {
            ...variableText,
            variableTemplate: { tokens: [{ kind: 'literal', value: 'Caf\u00e9' }] },
          },
        ],
      },
    };

    const split = await prepareOutputSnapshot(splitProject, {
      clock: () => NOW,
      renderVariableText: capturingRenderer,
    });
    const composed = await prepareOutputSnapshot(composedProject, {
      clock: () => NOW,
      renderVariableText: capturingRenderer,
    });

    expect(rendered).toEqual(['Caf\u00e9', 'Caf\u00e9']);
    expect(split.ok).toBe(true);
    expect(composed.ok).toBe(true);
    if (split.ok && composed.ok) expect(split.job).toEqual(composed.job);
  });

  it.each(['object', 'path'] as const)(
    'keeps rendered cut-setting text equal to compiled output with %s bindings',
    async (binding) => {
      const base = variableProject();
      const variableText = base.scene.objects[0];
      const operation = base.scene.layers[0];
      if (variableText?.kind !== 'text' || operation === undefined) {
        throw new Error('variable text fixture is missing');
      }
      const effectiveText: TextObject = {
        ...variableText,
        ...(binding === 'object'
          ? { operationIds: [operation.id] }
          : {
              paths: [{ color: variableText.color, operationIds: [operation.id], polylines: [] }],
            }),
        powerScale: 25,
        operationOverride: {
          power: 80,
          speed: 500,
          passes: 3,
          airAssist: true,
        },
        variableTemplate: {
          tokens: [
            { kind: 'cut-setting', field: 'power-percent' },
            { kind: 'literal', value: '/' },
            { kind: 'cut-setting', field: 'speed-mm-min' },
            { kind: 'literal', value: '/' },
            { kind: 'cut-setting', field: 'passes' },
            { kind: 'literal', value: '/' },
            { kind: 'cut-setting', field: 'air-assist' },
          ],
        },
      };
      const project: Project = {
        ...base,
        scene: {
          ...base.scene,
          layers: [
            { ...operation, color: '#0000ff', power: 10, speed: 1000, passes: 1, airAssist: false },
          ],
          objects: [effectiveText],
        },
      };
      const rendered: string[] = [];
      const result = await prepareOutputSnapshot(project, {
        clock: () => NOW,
        renderVariableText: async (input) => {
          rendered.push(input.content);
          return renderer(input);
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(rendered).toEqual(['20/500/3/on']);
      expect(result.project.scene.objects[0]).toMatchObject({ content: '20/500/3/on' });
      expect(result.job.groups[0]).toMatchObject({
        power: 20,
        speed: 500,
        passes: 3,
        airAssist: true,
      });
    },
  );

  it('materializes many variable objects in source order with bounded concurrency', async () => {
    const first = variableProject();
    const template = first.scene.objects[0];
    if (template?.kind !== 'text') throw new Error('variable text fixture is missing');
    const project: Project = {
      ...first,
      scene: addObject(first.scene, { ...template, id: 'T2' }),
    };
    let active = 0;
    let maximumActive = 0;
    const order: string[] = [];
    const boundedRenderer: VariableTextRenderer = async ({ text, content }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push(text.id);
      await Promise.resolve();
      active -= 1;
      return {
        bounds: { minX: 0, minY: 0, maxX: content.length, maxY: 1 },
        paths: [],
      };
    };

    await prepareOutputSnapshot(project, {
      clock: () => NOW,
      renderVariableText: boundedRenderer,
    });

    expect(maximumActive).toBe(1);
    expect(order).toEqual(['T1', 'T2']);
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

  it('applies registration before the shared output preparation pipeline', async () => {
    const snapshot = await prepareOutputSnapshot(variableProject(), {
      clock: () => NOW,
      renderVariableText: renderer,
      registration: {
        scale: 2,
        rotationRad: Math.PI / 2,
        translation: { x: 100, y: 50 },
      },
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const text = snapshot.project.scene.objects[0];
    expect(text?.transform.x).toBeCloseTo(100);
    expect(text?.transform.y).toBeCloseTo(50);
    expect(text?.transform.scaleX).toBeCloseTo(2);
    expect(text?.transform.rotationDeg).toBeCloseTo(90);
  });

  it('fails closed for stale registration but lets Frame decide job-origin composition', async () => {
    const stale = await prepareOutputSnapshot(createProject(), {
      clock: () => NOW,
      renderVariableText: renderer,
      registration: null,
    });
    expect(stale).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'print-and-cut-registration-invalid' }] },
    });

    const doublePlaced = await prepareOutputSnapshot(variableProject(), {
      clock: () => NOW,
      renderVariableText: renderer,
      registration: { scale: 1, rotationRad: 0, translation: { x: 1, y: 2 } },
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    expect(doublePlaced.ok).toBe(true);
  });
});
