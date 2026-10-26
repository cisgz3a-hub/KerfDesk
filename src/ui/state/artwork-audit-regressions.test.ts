import { beforeEach, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { createRectangle } from '../../core/shapes/primitives';
import { designNodeParent } from '../../core/scene/design-hierarchy-membership';
import { moveDesignNode } from '../../core/scene/design-hierarchy-edit';
import { repairArtwork, repairLine } from '../../__fixtures__/vector-repair-fixtures';
import { selectionUnitCount } from '../commands/selection-command-state';
import { currentHierarchyFocus, useDesignHierarchyStore } from './design-hierarchy-store';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';
import { deserializeProject, serializeProject } from '../../io/project';

const grid = { kind: 'grid', rows: 1, columns: 2, spacingX: 3, spacingY: 0 } as const;

beforeEach(() => {
  resetStore();
  useDesignHierarchyStore.setState({ focusId: null, documentEpoch: -1 });
});

function load(objects: ReadonlyArray<SceneObject>) {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      scene: { ...project.scene, objects, layers: [createLayer({ id: 'line', color: '#000000' })] },
    },
  });
}

function pen() {
  const object = createPolyline({
    id: 'pen',
    color: '#000000',
    spec: {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 10 },
      ],
      closed: false,
    },
  });
  load([object]);
  useStore.getState().selectPathNode({
    objectId: 'pen',
    pathIndex: 0,
    polylineIndex: 0,
    pointIndex: 1,
    geometry: 'curve',
  });
}

it.each(['break', 'delete-segment'])(
  'splits an open Pen path with %s as one undoable edit',
  (action) => {
    pen();
    const before = useStore.getState().project;
    if (action === 'break') useStore.getState().breakSelectedCurve();
    else
      useStore.getState().deletePathSegment({
        objectId: 'pen',
        pathIndex: 0,
        curveIndex: 0,
        segmentIndex: 1,
        t: 0.5,
      });
    const after = useStore.getState().project;
    const edited = after.scene.objects[0]!;
    expect(edited.kind).toBe('imported-svg');
    expect(edited.id).toBe('pen');
    if (!('paths' in edited)) throw new Error('Expected vector paths');
    expect(edited.paths[0]?.curves).toHaveLength(2);
    expect(edited.paths[0]?.polylines).toHaveLength(2);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(after);
  },
);

it.each(['duplicate', 'paste', 'paste-in-place'])(
  'clears node ownership when %s selects copied artwork',
  (action) => {
    pen();
    const original = useStore.getState().project.scene.objects[0];
    if (action === 'duplicate') useStore.getState().duplicateSelection();
    else {
      useStore.getState().copySelection();
      if (action === 'paste') useStore.getState().pasteClipboard();
      else useStore.getState().pasteClipboardInPlace();
    }
    expect(useStore.getState().selectedObjectId).not.toBe('pen');
    expect(useStore.getState().selectedPathNode).toBeNull();
    expect(useStore.getState().selectedPathNodes).toEqual([]);
    useStore.getState().nudgeSelectedPathNode(1, 0);
    expect(useStore.getState().project.scene.objects[0]).toBe(original);
  },
);

it.each(['align', 'distribute', 'same-width', 'together'])(
  'applies %s within an entered group without ungrouping',
  (action) => {
    const ids = ['A', 'B', 'C'];
    load(
      ids.map((id, i) => ({
        ...svgObj(id, ['#000000']),
        transform: {
          ...IDENTITY_TRANSFORM,
          x: [10, 30, 100][i]!,
          y: [10, 30, 50][i]!,
          scaleX: [1, 2, 3][i]!,
        },
      })),
    );
    useStore.getState().selectObjects(ids);
    useStore.getState().groupSelection();
    const group = useStore.getState().project.scene.groups![0]!;
    useStore.getState().focusDesignGroup(group.id);
    useStore.getState().selectObject('A');
    useStore.getState().toggleSelectObject('B');
    useStore.getState().toggleSelectObject('C');
    const state = useStore.getState();
    const focus = currentHierarchyFocus(state.project.scene, state.projectDocumentEpoch);
    expect(focus).toBe(group.id);
    expect(selectionUnitCount(state.project, ids, focus)).toBe(3);
    const before = state.project;
    if (action === 'align') state.alignSelection('left');
    if (action === 'distribute') state.distributeSelection('horizontal-centers');
    if (action === 'same-width') state.matchSelectionSize('width', false);
    if (action === 'together') state.moveSelectionTogether('horizontal');
    const after = useStore.getState().project;
    expect(after).not.toBe(before);
    expect(after.scene.groups).toBe(before.scene.groups);
    const transforms = after.scene.objects.map((object) => object.transform);
    if (action === 'align')
      expect(transforms.map((transform) => transform.x)).toEqual([100, 100, 100]);
    if (action === 'distribute')
      expect(transforms.map((transform) => transform.x)).toEqual([10, 55, 100]);
    if (action === 'same-width')
      expect(transforms.map((transform) => transform.scaleX)).toEqual([3, 3, 3]);
    if (action === 'together') {
      expect(transforms[2]).toBe(before.scene.objects[2]!.transform);
      expect(transforms[0]!.x + 10).toBeCloseTo(transforms[1]!.x);
      expect(transforms[1]!.x + 20).toBeCloseTo(transforms[2]!.x);
    }
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  },
);

function text(guideId: string): TextObject {
  return {
    kind: 'text',
    id: 'label',
    content: 'Label',
    fontKey: 'roboto-regular',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 8 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 8 },
            ],
          },
        ],
      },
    ],
    pathText: { guideObjectId: guideId, offsetMm: 0, reverse: false },
  };
}

it('detaches an absorbed Join guide while keeping cached text geometry editable and undoable', () => {
  const label = text('B');
  load([
    repairArtwork('A', [repairLine({ x: 0, y: 0 }, { x: 30, y: 0 })]),
    repairArtwork('B', [repairLine({ x: 30, y: 0 }, { x: 60, y: 0 })]),
    label,
  ]);
  useStore.getState().selectObject('A');
  useStore.getState().toggleSelectObject('B');
  const before = useStore.getState().project;
  expect(useStore.getState().joinSelectedPaths(0.1)).toBe(true);
  const after = useStore.getState().project;
  const detached = after.scene.objects.find((object) => object.id === label.id);
  expect(detached?.kind === 'text' && detached.pathText).toBeUndefined();
  expect(detached?.kind === 'text' && detached.paths).toBe(label.paths);
  expect(detached?.transform).toBe(label.transform);
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(before);
});

it('keeps an authored artwork name when Join repairs contours in place', () => {
  load([
    {
      ...repairArtwork('A', [
        repairLine({ x: 0, y: 0 }, { x: 10, y: 0 }),
        repairLine({ x: 10, y: 0 }, { x: 20, y: 0 }),
      ]),
      name: 'Left arch',
    },
  ]);
  useStore.getState().selectObject('A');
  expect(useStore.getState().joinSelectedPaths(0.1)).toBe(true);
  expect(useStore.getState().project.scene.objects[0]).toMatchObject({
    id: 'A',
    name: 'Left arch',
  });
});

function rectangle(id: string) {
  return createRectangle({
    id,
    color: '#000000',
    spec: { widthMm: 10, heightMm: 8, cornerRadiusMm: 0 },
  });
}

it('regenerates legacy path-text arrays without duplicating groups over their untouched locked source', () => {
  const group = { id: 'G', name: 'Original', objectIds: ['guide', 'label', 'outside'] };
  load([{ ...rectangle('guide'), locked: true }, text('guide'), rectangle('outside')]);
  useStore.setState((state) => ({
    project: { ...state.project, scene: { ...state.project.scene, groups: [group] } },
    selectedObjectId: 'label',
  }));
  useStore.getState().arraySelection(grid, undefined, undefined, { name: 'Labels' });
  const created = useStore.getState().project;
  const captured = created.arrayLayouts![0]!;
  const source = deserializeProject(captured.sourceProjectJson);
  if (source.kind !== 'ok') throw new Error('Expected an archived source');
  // Previous saved layouts trimmed a partial source parent into a complete group.
  const layout = {
    ...captured,
    sourceProjectJson: serializeProject({
      ...source.project,
      scene: {
        ...source.project.scene,
        groups: [{ ...group, objectIds: ['guide', 'label'] }],
      },
    }),
  };
  const made = { ...created, arrayLayouts: [layout] };
  useStore.setState({ project: made });
  const originals = made.scene.objects.filter((object) => group.objectIds.includes(object.id));
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const before = useStore.getState().project;
    expect(
      useStore.getState().regenerateArrayLayout(layout.id, grid, undefined, before),
    ).toBeNull();
    const scene = useStore.getState().project.scene;
    for (const original of originals)
      expect(scene.objects.find((object) => object.id === original.id)).toBe(original);
    expect(scene.groups?.filter((candidate) => candidate.objectIds.includes('label'))).toEqual([
      group,
    ]);
    expect(designNodeParent(scene, { kind: 'object', id: 'label' })).toBe('G');
    expect(
      moveDesignNode(scene, { node: { kind: 'object', id: 'label' }, parentId: null }).kind,
    ).toBe('ok');
  }
  const after = useStore.getState().project;
  useStore.getState().undo();
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(made);
  useStore.getState().redo();
  useStore.getState().redo();
  expect(useStore.getState().project).toBe(after);
});

it('keeps partial-group array copies ungrouped when regenerating with stable instance IDs', () => {
  const group = { id: 'G', name: 'Original', objectIds: ['a', 'b', 'c'] };
  load([rectangle('a'), rectangle('b'), rectangle('c')]);
  useStore.setState((state) => ({
    project: { ...state.project, scene: { ...state.project.scene, groups: [group] } },
    selectedObjectId: 'a',
    additionalSelectedIds: new Set(['b']),
  }));
  useStore.getState().arraySelection(grid, undefined, undefined, { name: 'Pairs' });
  const before = useStore.getState().project;
  const layout = before.arrayLayouts![0]!;
  expect(before.scene.groups).toEqual([group]);
  expect(useStore.getState().regenerateArrayLayout(layout.id, grid, undefined, before)).toBeNull();
  const after = useStore.getState().project;
  expect(after.scene.groups).toEqual([group]);
  expect(after.arrayLayouts![0]!.instances).toEqual(layout.instances);
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(before);
});

it('keeps old saved partial-group arrays ungrouped even when their source archive contains a trimmed parent', () => {
  const group = { id: 'G', name: 'Original', objectIds: ['a', 'b', 'c'] };
  load([rectangle('a'), rectangle('b'), rectangle('c')]);
  useStore.setState((state) => ({
    project: { ...state.project, scene: { ...state.project.scene, groups: [group] } },
    selectedObjectId: 'a',
    additionalSelectedIds: new Set(['b']),
  }));
  useStore.getState().arraySelection(grid, undefined, undefined, { name: 'Pairs' });
  const created = useStore.getState().project;
  const layout = created.arrayLayouts![0]!;
  const archived = deserializeProject(layout.sourceProjectJson);
  if (archived.kind !== 'ok') throw new Error('Expected a retained source');
  const legacy = {
    ...layout,
    sourceProjectJson: serializeProject({
      ...archived.project,
      scene: {
        ...archived.project.scene,
        groups: [{ ...group, objectIds: ['a', 'b'] }],
      },
    }),
  };
  const before = { ...created, arrayLayouts: [legacy] };
  useStore.setState({ project: before });
  expect(useStore.getState().regenerateArrayLayout(legacy.id, grid, undefined, before)).toBeNull();
  const after = useStore.getState().project;
  expect(after.scene.groups).toEqual([group]);
  expect(after.arrayLayouts![0]!.instances).toEqual(layout.instances);
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(before);
});
