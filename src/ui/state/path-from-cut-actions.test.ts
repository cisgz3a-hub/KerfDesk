import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../core/scene/layer';
import { createProject } from '../../core/scene/project';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene/scene-object';
import { sceneObjectUsesOperation } from '../../core/scene/operation-binding';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { renderVariableText } from '../text/render-variable-text';
import type { TextObject } from '../../core/scene/scene-object';
import { DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene/variable-template';

vi.mock('../text/render-variable-text', () => ({ renderVariableText: vi.fn() }));

const SQUARE: ImportedSvg = {
  kind: 'imported-svg',
  id: 'square',
  source: 'square.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 },
  operationIds: ['cut'],
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
};

beforeEach(resetStore);

describe('Generate Path From Cut', () => {
  it('adds the burned outline as unbound artwork at the same place, in one undo step', async () => {
    const layer = createLayer({ id: 'cut', color: '#000000' });
    const project = {
      ...createProject(),
      scene: { objects: [SQUARE], layers: [layer], groups: [] },
    };
    useStore.setState({ project, selectedObjectId: 'square', additionalSelectedIds: new Set() });
    await useStore.getState().generatePathFromCut();
    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(2);
    const generated = state.project.scene.objects[1] as ImportedSvg;
    expect(generated.operationIds).toEqual([]);
    expect(sceneObjectUsesOperation(generated, layer)).toBe(false);
    const xs = generated.paths.flatMap((path) =>
      path.polylines.flatMap((p) => p.points.map((q) => q.x)),
    );
    const ys = generated.paths.flatMap((path) =>
      path.polylines.flatMap((p) => p.points.map((q) => q.y)),
    );
    expect(Math.min(...xs)).toBeCloseTo(50, 6);
    expect(Math.max(...xs)).toBeCloseTo(60, 6);
    expect(Math.min(...ys)).toBeCloseTo(50, 6);
    expect(Math.max(...ys)).toBeCloseTo(60, 6);
    expect(state.undoStack).toEqual([project]);
  });
});

it('materializes current serial values before generating the paths', async () => {
  const text: TextObject = {
    ...SQUARE,
    kind: 'text',
    content: 'old',
    color: '#000000',
    fontKey: 'roboto-regular',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    variableTemplate: { tokens: [{ kind: 'serial', prefix: '', width: 1 }] },
  };
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, serialValue: 17 },
      scene: {
        ...project.scene,
        objects: [text],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
      },
    },
    selectedObjectId: text.id,
    additionalSelectedIds: new Set(),
  });
  vi.mocked(renderVariableText).mockImplementation(async ({ text: source }) => ({
    bounds: source.bounds,
    paths: source.paths,
  }));
  await useStore.getState().generatePathFromCut();
  expect(renderVariableText).toHaveBeenCalledWith(expect.objectContaining({ content: '17' }));
  expect(useStore.getState().project.scene.objects).toHaveLength(2);
});
it('does not append stale paths after the project changes during preparation', async () => {
  const project = createProject();
  const source = {
    ...project,
    scene: {
      ...project.scene,
      objects: [SQUARE],
      layers: [createLayer({ id: 'cut', color: '#000000' })],
    },
  };
  useStore.setState({
    project: source,
    selectedObjectId: SQUARE.id,
    additionalSelectedIds: new Set(),
  });
  const pending = useStore.getState().generatePathFromCut();
  const replacement = createProject();
  useStore.setState({ project: replacement });
  await pending;
  expect(useStore.getState().project).toBe(replacement);
  expect(useStore.getState().project.scene.objects).toHaveLength(0);
});
