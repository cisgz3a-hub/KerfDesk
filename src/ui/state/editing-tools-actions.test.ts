// Store behaviour of the LightBurn gap batch 3 editing tools (ADR-410):
// Rotate 90°, Move to bed, Paste in Place, Invert Selection, Select Open Shapes.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
} from '../../core/scene';
import { selectionMetrics } from '../../core/scene/selection-transform';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const CLOSED: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
  ],
};
const OPEN: Polyline = {
  closed: false,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
  ],
};

function art(id: string, polylines: ReadonlyArray<Polyline>, patch: Partial<ImportedSvg> = {}) {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 },
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines }],
    ...patch,
  };
  return object;
}

function load(objects: ReadonlyArray<SceneObject>, selected: ReadonlyArray<string> = []): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects,
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    dirty: false,
  });
}

function selection(): ReadonlyArray<string> {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ].sort();
}

function bboxOf(id: string) {
  const object = useStore.getState().project.scene.objects.find((entry) => entry.id === id)!;
  return selectionMetrics([object])!.bbox;
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Rotate 90° and Move to bed', () => {
  it('turns the selection a quarter turn in one undo step', () => {
    load([art('a', [CLOSED])], ['a']);

    useStore.getState().rotateSelectionQuarterTurn(1);

    const state = useStore.getState();
    expect(state.project.scene.objects[0]?.transform.rotationDeg).toBe(90);
    const box = bboxOf('a');
    expect(box.maxX - box.minX).toBeCloseTo(10, 8);
    expect(box.maxY - box.minY).toBeCloseTo(20, 8);
    expect(state.undoStack).toHaveLength(1);
  });

  it('moves the selection to the centre of the bed', () => {
    load([art('a', [CLOSED])], ['a']);
    const { bedWidth, bedHeight } = useStore.getState().project.device;

    useStore.getState().moveSelectionToBed('c');

    const box = bboxOf('a');
    expect((box.minX + box.maxX) / 2).toBeCloseTo(bedWidth / 2, 8);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(bedHeight / 2, 8);
  });

  it('leaves locked artwork where it is', () => {
    load([art('a', [CLOSED], { locked: true })], ['a']);

    useStore.getState().moveSelectionToBed('nw');
    useStore.getState().rotateSelectionQuarterTurn(-1);

    expect(useStore.getState().project.scene.objects[0]?.transform).toMatchObject({ x: 30, y: 40 });
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

describe('Paste in Place', () => {
  it('pastes the copy exactly on top of the original', () => {
    load([art('a', [CLOSED])], ['a']);
    useStore.getState().copySelection();

    useStore.getState().pasteClipboardInPlace();

    const objects = useStore.getState().project.scene.objects;
    expect(objects).toHaveLength(2);
    expect(objects[1]?.id).not.toBe('a');
    expect(objects[1]?.transform).toEqual(objects[0]?.transform);
    expect(useStore.getState().selectedObjectId).toBe(objects[1]?.id);
  });

  it('keeps the ordinary Paste offset', () => {
    load([art('a', [CLOSED])], ['a']);
    useStore.getState().copySelection();

    useStore.getState().pasteClipboard();

    const objects = useStore.getState().project.scene.objects;
    expect(objects[1]?.transform.x).toBe(40);
  });
});

describe('Invert Selection', () => {
  it('selects the unselected, pickable artwork and drops the rest', () => {
    load(
      [
        art('a', [CLOSED]),
        art('b', [CLOSED]),
        art('c', [CLOSED]),
        art('held', [CLOSED], { locked: true }),
      ],
      ['a'],
    );

    useStore.getState().invertSelection();

    expect(selection()).toEqual(['b', 'c']);
  });

  it('selects everything pickable when nothing is selected', () => {
    load([art('a', [CLOSED]), art('b', [CLOSED])]);

    useStore.getState().invertSelection();

    expect(selection()).toEqual(['a', 'b']);
  });
});

describe('Select Open Shapes', () => {
  it('selects artwork with an open path, on any operation, and says how many', () => {
    load([art('closed', [CLOSED]), art('open', [OPEN]), art('mixed', [CLOSED, OPEN, OPEN])]);

    useStore.getState().selectOpenShapes();

    expect(selection()).toEqual(['mixed', 'open']);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain(
      'Selected 2 objects with 3 open paths',
    );
  });

  it('treats a path whose ends meet as closed', () => {
    const touching: Polyline = { closed: false, points: [...OPEN.points, { x: 0, y: 0 }] };
    load([art('loop', [touching])], ['loop']);

    useStore.getState().selectOpenShapes();

    expect(selection()).toEqual(['loop']);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('No open shapes');
  });
});
