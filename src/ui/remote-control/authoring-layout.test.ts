import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import { setActiveEdition } from '../licensing/edition';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { transformedBBox } from '../../core/scene/hit-test';
import type { RemoteArrangeAction, RemoteControlAdapter } from './types';
import { addTestRectangle, resultCode, testAdapter, writeArgs } from './authoring-test-support';

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  setActiveEdition(null);
  adapter = testAdapter();
});
afterEach(() => {
  adapter.dispose();
  setActiveEdition(null);
});
async function arrange(artworkIds: readonly string[], action: RemoteArrangeAction) {
  return adapter.execute('arrange_artwork', writeArgs(adapter, { artworkIds, action }));
}
function object(id: string) {
  const result = useStore.getState().project.scene.objects.find((entry) => entry.id === id);
  if (result === undefined) throw new Error('Fixture artwork missing.');
  return result;
}

describe('remote layouts use normal editor maths and history', () => {
  it('does not report an artwork mutation for Ungroup on already ungrouped artwork', async () => {
    const id = await addTestRectangle(adapter);
    const before = useStore.getState();
    const result = await arrange([id], 'ungroup');
    expect(result).toMatchObject({ ok: true, data: { changedArtworkIds: [] } });
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
  });
  it.each([
    ['align_left', 40, 5],
    ['align_center', 50, 5],
    ['align_right', 60, 5],
    ['align_top', 0, 30],
    ['align_middle', 0, 40],
    ['align_bottom', 0, 50],
  ] as const)(
    '%s aligns to the last requested reference in one undo step',
    async (action, x, y) => {
      const first = await addTestRectangle(adapter, 0, 5);
      const result = await adapter.execute(
        'add_rectangle',
        writeArgs(adapter, { xMm: 40, yMm: 30, widthMm: 30, heightMm: 40 }),
      );
      expect(resultCode(result)).toBe('ok');
      const ref = useStore.getState().project.scene.objects.at(-1)!;
      const before = object(first);
      const history = useStore.getState().undoStack.length;
      expect(resultCode(await arrange([first, ref.id], action))).toBe('ok');
      expect(object(first).transform).toMatchObject({ x, y });
      expect(object(ref.id)).toBe(ref);
      expect(useStore.getState().undoStack).toHaveLength(history + 1);
      expect(resultCode(await adapter.execute('undo', writeArgs(adapter)))).toBe('ok');
      expect(object(first)).toEqual(before);
    },
  );

  it.each(['distribute_horizontal', 'distribute_vertical'] as const)(
    '%s keeps endpoints and spaces the middle by centres',
    async (action) => {
      const ids = [
        await addTestRectangle(adapter, 0, 0),
        await addTestRectangle(adapter, 7, 9),
        await addTestRectangle(adapter, 50, 60),
      ];
      const first = object(ids[0]!);
      const last = object(ids[2]!);
      expect(resultCode(await arrange(ids, action))).toBe('ok');
      expect(object(ids[0]!)).toBe(first);
      expect(object(ids[2]!)).toBe(last);
      expect(object(ids[1]!).transform).toMatchObject(
        action === 'distribute_horizontal' ? { x: 25, y: 9 } : { x: 7, y: 30 },
      );
    },
  );

  it.each(['mirror_horizontal', 'mirror_vertical'] as const)(
    '%s reflects about world bounds and preserves dimensions',
    async (action) => {
      const id = await addTestRectangle(adapter, 12, 23);
      const original = object(id);
      useStore.getState().setObjectTransform(id, { ...original.transform, rotationDeg: 35 });
      const before = object(id);
      const bounds = transformedBBox(before);
      expect(resultCode(await arrange([id], action))).toBe('ok');
      const mirrored = transformedBBox(object(id));
      for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const)
        expect(mirrored[key]).toBeCloseTo(bounds[key], 8);
      expect(object(id).transform.rotationDeg).toBe(325);
      expect(object(id).transform).toMatchObject(
        action === 'mirror_horizontal' ? { mirrorX: true } : { mirrorY: true },
      );
      expect(resultCode(await adapter.execute('undo', writeArgs(adapter)))).toBe('ok');
      expect(object(id)).toEqual(before);
    },
  );

  it('groups, expands group targets, aligns the group rigidly, and ungroups with normal Undo', async () => {
    const first = await addTestRectangle(adapter, 0);
    const second = await addTestRectangle(adapter, 20);
    const reference = await addTestRectangle(adapter, 100);
    expect(resultCode(await arrange([first, second], 'group'))).toBe('ok');
    expect(useStore.getState().project.scene.groups).toHaveLength(1);
    expect(resultCode(await arrange([first, reference], 'align_left'))).toBe('ok');
    expect(object(first).transform.x).toBe(100);
    expect(object(second).transform.x).toBe(120);
    expect(resultCode(await arrange([second], 'ungroup'))).toBe('ok');
    expect(useStore.getState().project.scene.groups).toHaveLength(0);
    expect(resultCode(await adapter.execute('undo', writeArgs(adapter)))).toBe('ok');
    expect(useStore.getState().project.scene.groups).toHaveLength(1);
  });

  it('duplicates once, keeps bindings, deletes atomically, and fences Undo/Redo replays', async () => {
    const ids = [await addTestRectangle(adapter, 0), await addTestRectangle(adapter, 20)];
    const request = writeArgs(adapter, { artworkIds: ids, action: 'duplicate' });
    const first = await adapter.execute('arrange_artwork', request);
    expect(resultCode(first)).toBe('ok');
    expect(await adapter.execute('arrange_artwork', request)).toEqual(first);
    expect(useStore.getState().project.scene.objects).toHaveLength(4);
    const clones = useStore.getState().project.scene.objects.slice(2);
    expect(clones.map((clone) => clone.operationIds)).toEqual(
      ids.map((id) => object(id).operationIds),
    );
    expect(clones.map((clone) => clone.transform)).toEqual(ids.map((id) => object(id).transform));
    const cloneIds = clones.map((clone) => clone.id);
    expect(resultCode(await arrange(cloneIds, 'delete'))).toBe('ok');
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    const undoRequest = writeArgs(adapter);
    const undo = await adapter.execute('undo', undoRequest);
    expect(resultCode(undo)).toBe('ok');
    expect(useStore.getState().project.scene.objects).toHaveLength(4);
    expect(await adapter.execute('undo', undoRequest)).toEqual(undo);
    expect(useStore.getState().project.scene.objects).toHaveLength(4);
    expect(resultCode(await adapter.execute('redo', writeArgs(adapter)))).toBe('ok');
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(await adapter.execute('arrange_artwork', request)).toEqual(first);
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(await adapter.execute('get_workspace', {})).toMatchObject({
      ok: true,
      data: {
        history: { canUndo: true, canRedo: false },
        permissions: { canEdit: true, artworkSharingEnabled: false },
      },
    });
  });

  it.each(['missing', 'locked', 'hidden'] as const)(
    'refuses whole group edits when an expanded target is %s',
    async (kind) => {
      const first = await addTestRectangle(adapter, 0);
      const second = await addTestRectangle(adapter, 20);
      expect(resultCode(await arrange([first, second], 'group'))).toBe('ok');
      const state = useStore.getState();
      const source = object(second);
      useStore.setState({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects
              .map((entry) =>
                entry.id !== second
                  ? entry
                  : {
                      ...source,
                      ...(kind === 'locked' ? { locked: true } : {}),
                      ...(kind === 'hidden' ? { operationIds: ['hidden-op'] } : {}),
                    },
              )
              .filter((entry) => kind !== 'missing' || entry.id !== second),
            layers:
              kind === 'hidden'
                ? [
                    ...state.project.scene.layers,
                    { ...state.project.scene.layers[0]!, id: 'hidden-op', visible: false },
                  ]
                : state.project.scene.layers,
          },
        },
      });
      const before = useStore.getState();
      expect(resultCode(await arrange([first], 'mirror_horizontal'))).toBe(
        kind === 'missing' ? 'not_found' : 'not_editable',
      );
      expect(useStore.getState()).toBe(before);
    },
  );

  it('rejects stale, read-only, pending interaction and cancelled history requests without popping Undo', async () => {
    await addTestRectangle(adapter);
    const stale = writeArgs(adapter);
    useStore.getState().selectObjects([]);
    expect(resultCode(await adapter.execute('undo', stale))).toBe('stale_revision');
    const readOnly = testAdapter({ canWrite: () => false });
    const before = useStore.getState();
    expect(resultCode(await readOnly.execute('undo', writeArgs(readOnly)))).toBe('read_only');
    readOnly.dispose();
    const controller = new AbortController();
    controller.abort();
    expect(
      resultCode(await adapter.execute('undo', writeArgs(adapter), { signal: controller.signal })),
    ).toBe('cancelled');
    expect(useStore.getState()).toBe(before);
    useStore.getState().beginInteraction();
    const interacting = useStore.getState();
    expect(resultCode(await adapter.execute('redo', writeArgs(adapter)))).toBe('busy');
    expect(useStore.getState()).toBe(interacting);
  });
});

describe('Pro copying stays at the existing authoring boundary', () => {
  it.each([
    { cutType: 'v-carve' as const },
    { cutType: 'relief-finish' as const },
    { cutType: 'pocket' as const, pocketStrategy: 'adaptive' as const },
  ])('refuses new $cutType copies in commercial Free without a deferred edit', async (cnc) => {
    const id = await addTestRectangle(adapter);
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: state.project.scene.layers.map((layer) => ({
            ...layer,
            cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
          })),
        },
      },
    });
    const requestPro = vi.fn(() => false);
    setActiveEdition({
      status: null,
      licensed: true,
      pro: false,
      requestPro,
      openLicence: vi.fn(),
    });
    const before = useStore.getState();
    expect(resultCode(await arrange([id], 'duplicate'))).toBe('needs_pro');
    expect(useStore.getState()).toBe(before);
    expect(requestPro).not.toHaveBeenCalled();
    expect(resultCode(await arrange([id], 'mirror_horizontal'))).toBe('ok');
    expect(resultCode(await adapter.execute('undo', writeArgs(adapter)))).toBe('ok');
    setActiveEdition(null);
    expect(resultCode(await arrange([id], 'duplicate'))).toBe('ok');
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
  });
});
