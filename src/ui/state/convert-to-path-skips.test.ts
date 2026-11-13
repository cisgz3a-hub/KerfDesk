// Tools audit T1, T26: Convert to Path leaves variable text as text (its
// stored glyphs are the template, not the value that burns: T26-P1-1) and
// leaves the registration jig's outlines as they are (T26-P2-2), and says so.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import { createRegistrationBox } from '../../core/shapes';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const st = () => useStore.getState();

function load(objects: SceneObject[], layers: Layer[]): void {
  const base = createProject();
  const project: Project = { ...base, scene: { ...base.scene, objects, layers, groups: [] } };
  useStore.setState({
    project,
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
    undoStack: [],
    redoStack: [],
  });
}

const square = (id: string, x: number) =>
  ({
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 8, heightMm: 8, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x, y: 20 },
    }),
    operationIds: ['art'],
  }) as SceneObject;

const art = (): Layer => ({ ...createLayer({ id: 'art', color: '#000000', mode: 'line' }) });

function variableText(): TextObject {
  return {
    kind: 'text',
    id: 'VT',
    content: 'SN {{serial:4}}',
    variableTemplate: {
      tokens: [
        { kind: 'literal', value: 'SN ' },
        { kind: 'serial', prefix: '', width: 4 },
      ],
    },
    fontKey: 'roboto-regular',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 },
    operationIds: ['art'],
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
            ],
          },
        ],
      },
    ],
  } as unknown as TextObject;
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Convert to Path skips what it cannot convert faithfully (T26)', () => {
  it('leaves variable text as text and points to Bake Variable Text', () => {
    load([variableText()], [art()]);
    const before = st().project;

    st().convertSelectionToPath();

    expect(st().project).toBe(before);
    expect(st().project.scene.objects[0]?.kind).toBe('text');
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/Bake Variable Text/);
  });

  it('still converts the other selected art beside variable text', () => {
    load([variableText(), square('S', 10)], [art()]);
    st().convertSelectionToPath();
    const kinds = st().project.scene.objects.map((object) => `${object.id}:${object.kind}`);
    expect(kinds).toContain('VT:text');
    expect(kinds).toContain('S:imported-svg');
    expect(st().undoStack).toHaveLength(1);
  });

  it('keeps the registration jig outlines when everything is selected', () => {
    const boxes = ['box-a', 'box-b'].map((id, index) =>
      createRegistrationBox({ id, widthMm: 60, heightMm: 60, x: 10 + index * 80, y: 10 }),
    );
    load([...boxes, square('S', 30)], [{ ...createRegistrationLayer(), output: false }, art()]);

    st().convertSelectionToPath();

    expect(findRegistrationBoxes(st().project.scene)).toHaveLength(2);
    expect(st().project.scene.objects.find((object) => object.id === 'S')?.kind).toBe(
      'imported-svg',
    );
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/registration jig/);
  });
});
