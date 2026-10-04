import { afterEach, beforeEach, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, IDENTITY_TRANSFORM } from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives/create-ellipse';
import { createPolyline } from '../../core/shapes/create-polyline';
import { transformedBBox } from '../../core/scene/hit-test';
import { useStore } from '../state/store';
import { testAdapter, writeArgs, resultCode } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

const ellipse = { xMm: -12.5, yMm: 9, widthMm: 30, heightMm: 15 };
const stroke = {
  pointsMm: [
    { xMm: -12, yMm: 3 },
    { xMm: -8, yMm: 12 },
    { xMm: 4, yMm: 18 },
    { xMm: 8, yMm: 7 },
    { xMm: 24, yMm: 15 },
  ],
  closed: false,
};
const commands = [
  ['add_ellipse', ellipse],
  ['add_polyline', stroke],
] as const;
let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  adapter = testAdapter();
});
afterEach(() => adapter.dispose());

it('adds the canonical ellipse box in Free with one ordinary selected operation and undo step', async () => {
  const result = await adapter.execute('add_ellipse', writeArgs(adapter, ellipse));
  expect(result.ok).toBe(true);
  const state = useStore.getState();
  const object = state.project.scene.objects[0]!;
  const expected = createEllipse({
    id: object.id,
    color: '#000000',
    spec: { widthMm: 30, heightMm: 15 },
    transform: { ...IDENTITY_TRANSFORM, x: -12.5, y: 9 },
  });
  expect(object).toMatchObject({
    spec: expected.spec,
    bounds: expected.bounds,
    transform: expected.transform,
  });
  expect('paths' in object && object.paths[0]?.curves).toEqual(expected.paths[0]?.curves);
  expect(state.project.scene.layers[0]).toMatchObject({ mode: 'line', output: true });
  expect(state.selectedObjectId).toBe(object.id);
  expect(state.additionalSelectedIds.size).toBe(0);
  expect(state.undoStack).toHaveLength(1);
  expect(state.dirty).toBe(true);
  expect(result.ok && result.data.changedArtworkIds).toEqual([object.id]);
});

it.each([false, true])(
  'uses the real PC pen geometry and preserves points (closed=%s)',
  async (closed) => {
    const result = await adapter.execute('add_polyline', writeArgs(adapter, { ...stroke, closed }));
    expect(result.ok).toBe(true);
    const object = useStore.getState().project.scene.objects[0]!;
    const expected = createPolyline({
      id: object.id,
      color: '#000000',
      spec: { points: stroke.pointsMm.map(({ xMm, yMm }) => ({ x: xMm, y: yMm })), closed },
    });
    expect(object).toMatchObject({
      spec: expected.spec,
      bounds: expected.bounds,
      transform: expected.transform,
    });
    expect('paths' in object && object.paths[0]?.curves).toEqual(expected.paths[0]?.curves);
    expect('paths' in object && object.paths[0]?.polylines).toEqual(expected.paths[0]?.polylines);
  },
);

it.each(commands)(
  'deduplicates concurrent/completed %s and refuses changed request identity',
  async (command, values) => {
    const input = writeArgs(adapter, values);
    const results = await Promise.all([
      adapter.execute(command, input),
      adapter.execute(command, input),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]?.ok).toBe(true);
    expect(await adapter.execute(command, input)).toEqual(results[0]);
    const changed = command === 'add_ellipse' ? { ...input, xMm: 22 } : { ...input, closed: true };
    expect(resultCode(await adapter.execute(command, changed))).toBe('request_conflict');
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(1);
  },
);

it.each(commands)(
  'keeps %s in shared Undo/Redo and retains redo identity',
  async (command, values) => {
    await adapter.execute(command, writeArgs(adapter, values));
    const id = useStore.getState().project.scene.objects[0]!.id;
    expect(resultCode(await adapter.execute('undo', writeArgs(adapter)))).toBe('ok');
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(resultCode(await adapter.execute('redo', writeArgs(adapter)))).toBe('ok');
    expect(useStore.getState().project.scene.objects[0]?.id).toBe(id);
  },
);

it.each(commands)(
  'never lets %s inherit edit authority from basic capability',
  async (command, values) => {
    adapter.dispose();
    adapter = testAdapter({ canWrite: () => false });
    const workspace = await adapter.execute('get_workspace', {});
    expect(workspace.ok && workspace.data.capabilities).toEqual({ touchEditing: true });
    expect(workspace.ok && workspace.data.permissions).toMatchObject({ canEdit: false });
    expect(resultCode(await adapter.execute(command, writeArgs(adapter, values)))).toBe(
      'read_only',
    );
    expect(useStore.getState().undoStack).toHaveLength(0);
  },
);

it.each(commands)(
  'refuses CNC creation for %s without changing the scene or history',
  async (command, values) => {
    const state = useStore.getState();
    useStore.setState({ project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG } });
    const workspace = await adapter.execute('get_workspace', {});
    expect(workspace.ok && workspace.data.capabilities).toEqual({ touchEditing: false });
    expect(resultCode(await adapter.execute(command, writeArgs(adapter, values)))).toBe(
      'unsupported_operation',
    );
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().undoStack).toHaveLength(0);
  },
);

it.each(commands)(
  'fences %s queued before a New document replaces its owner',
  async (command, values) => {
    const request = adapter.execute(command, writeArgs(adapter, values));
    const state = useStore.getState();
    useStore.setState({
      project: createProject(state.project.device),
      projectDocumentEpoch: state.projectDocumentEpoch + 1,
    });
    expect(resultCode(await request)).toBe('stale_revision');
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
  },
);

it.each(commands)(
  'moves and resizes %s using ordinary grouped min-corner anchoring',
  async (command, values) => {
    await adapter.execute(command, writeArgs(adapter, values));
    const object = useStore.getState().project.scene.objects[0]!;
    const before = transformedBBox(object);
    expect(
      resultCode(
        await adapter.execute(
          'transform_artwork',
          writeArgs(adapter, {
            artworkIds: [object.id],
            transform: { type: 'move', dxMm: 7, dyMm: -3 },
          }),
        ),
      ),
    ).toBe('ok');
    expect(
      resultCode(
        await adapter.execute(
          'transform_artwork',
          writeArgs(adapter, {
            artworkIds: [object.id],
            transform: { type: 'resize', widthMm: 80, heightMm: 20 },
          }),
        ),
      ),
    ).toBe('ok');
    const resized = transformedBBox(useStore.getState().project.scene.objects[0]!);
    expect(resized.minX).toBeCloseTo(before.minX + 7);
    expect(resized.minY).toBeCloseTo(before.minY - 3);
    expect(resized.maxX - resized.minX).toBeCloseTo(80);
    expect(resized.maxY - resized.minY).toBeCloseTo(20);
  },
);

it.each(commands)(
  'cancels %s before mutation but preserves a committed receipt after cancellation',
  async (command, values) => {
    const before = new AbortController();
    const cancelled = adapter.execute(command, writeArgs(adapter, values), {
      signal: before.signal,
    });
    before.abort();
    expect(resultCode(await cancelled)).toBe('cancelled');
    expect(useStore.getState().undoStack).toHaveLength(0);
    const after = new AbortController();
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.project !== previous.project) after.abort();
    });
    try {
      const input = writeArgs(adapter, values);
      const committed = await adapter.execute(command, input, { signal: after.signal });
      expect(after.signal.aborted).toBe(true);
      expect(committed.ok).toBe(true);
      expect(await adapter.execute(command, input)).toEqual(committed);
      expect(useStore.getState().project.scene.objects).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  },
);

it.each(commands)('refuses %s while normal authoring is busy', async (command, values) => {
  adapter.dispose();
  adapter = testAdapter({ canEdit: () => false });
  expect(resultCode(await adapter.execute(command, writeArgs(adapter, values)))).toBe('busy');
  expect(useStore.getState().project.scene.objects).toHaveLength(0);
});

it('detaches a stroke point array before its queued mutation', async () => {
  const pointsMm = [
    { xMm: 1, yMm: 2 },
    { xMm: 3, yMm: 4 },
  ];
  const request = adapter.execute('add_polyline', writeArgs(adapter, { pointsMm, closed: false }));
  pointsMm[0]!.xMm = 900;
  pointsMm.push({ xMm: 500, yMm: 600 });
  expect((await request).ok).toBe(true);
  expect(useStore.getState().project.scene.objects[0]).toMatchObject({
    spec: {
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      closed: false,
    },
  });
});

it('publishes canonical visibility/lock hints and refuses an entire mixed touch edit', async () => {
  await adapter.execute('add_ellipse', writeArgs(adapter, ellipse));
  await adapter.execute('add_polyline', writeArgs(adapter, stroke));
  const state = useStore.getState();
  const hidden = state.project.scene.objects[0]!;
  const locked = state.project.scene.objects[1]!;
  const hiddenOperation = hidden.operationIds![0];
  useStore.setState({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) =>
          object.id === locked.id ? { ...object, locked: true } : object,
        ),
        layers: state.project.scene.layers.map((layer) =>
          layer.id === hiddenOperation ? { ...layer, visible: false } : layer,
        ),
      },
    },
  });
  const before = useStore.getState();
  const result = await adapter.execute('get_workspace', {});
  expect(result.ok && result.data.artwork).toEqual([
    expect.objectContaining({ id: hidden.id, visible: false, editable: false }),
    expect.objectContaining({ id: locked.id, visible: true, editable: false }),
  ]);
  expect(
    resultCode(
      await adapter.execute(
        'transform_artwork',
        writeArgs(adapter, {
          artworkIds: [hidden.id, locked.id],
          transform: { type: 'move', dxMm: 10, dyMm: 10 },
        }),
      ),
    ),
  ).toBe('not_editable');
  expect(useStore.getState().project).toBe(before.project);
  expect(useStore.getState().undoStack).toBe(before.undoStack);
});
