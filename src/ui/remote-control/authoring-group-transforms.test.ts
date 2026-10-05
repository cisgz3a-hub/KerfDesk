import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { setActiveEdition } from '../licensing/edition';
import type { RemoteControlAdapter, RemoteTransform } from './types';
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

async function groupAt(x = 0): Promise<[string, string]> {
  const ids: [string, string] = [
    await addTestRectangle(adapter, x),
    await addTestRectangle(adapter, x + 20),
  ];
  expect(
    resultCode(
      await adapter.execute(
        'arrange_artwork',
        writeArgs(adapter, { artworkIds: ids, action: 'group' }),
      ),
    ),
  ).toBe('ok');
  return ids;
}

const edits: readonly {
  readonly name: string;
  readonly transform: RemoteTransform;
  readonly expected: readonly Record<string, number>[];
}[] = [
  {
    name: 'move',
    transform: { type: 'move', dxMm: 5, dyMm: 7 },
    expected: [
      { x: 5, y: 7 },
      { x: 25, y: 7 },
    ],
  },
  {
    name: 'resize',
    transform: { type: 'resize', widthMm: 60, heightMm: 40 },
    expected: [
      { x: 0, y: 0, scaleX: 2, scaleY: 2 },
      { x: 40, y: 0, scaleX: 2, scaleY: 2 },
    ],
  },
  {
    name: 'rotate',
    transform: { type: 'rotate', angleDeg: 90 },
    expected: [
      { x: 25, y: -5, rotationDeg: 90 },
      { x: 25, y: 15, rotationDeg: 90 },
    ],
  },
];

describe('remote transforms retain complete persistent group ownership', () => {
  it.each(edits)(
    '$name includes the group in one undo step and leaves another group intact',
    async ({ transform, expected }) => {
      const ids = await groupAt();
      await groupAt(100);
      const before = useStore.getState();
      const request = writeArgs(adapter, { artworkIds: [ids[0]], transform });
      const result = await adapter.execute('transform_artwork', request);
      expect(result).toMatchObject({ ok: true, data: { changedArtworkIds: ids } });
      const after = useStore.getState();
      for (const [index, values] of expected.entries()) {
        const actual = after.project.scene.objects[index]!.transform;
        for (const [field, value] of Object.entries(values))
          expect(actual[field as keyof typeof actual]).toBeCloseTo(value, 8);
      }
      expect(after.project.scene.objects.slice(2)).toEqual(before.project.scene.objects.slice(2));
      expect(after.project.scene.objects[2]).toBe(before.project.scene.objects[2]);
      expect(after.project.scene.objects[3]).toBe(before.project.scene.objects[3]);
      expect(after.project.scene.groups).toBe(before.project.scene.groups);
      expect(after.projectDocumentEpoch).toBe(before.projectDocumentEpoch);
      expect(after.selectedObjectId).toBe(before.selectedObjectId);
      expect(after.additionalSelectedIds).toBe(before.additionalSelectedIds);
      expect(after.undoStack).toHaveLength(before.undoStack.length + 1);
      expect(await adapter.execute('transform_artwork', request)).toEqual(result);
      expect(useStore.getState().undoStack).toBe(after.undoStack);
      expect(resultCode(await adapter.execute('undo', writeArgs(adapter)))).toBe('ok');
      expect(useStore.getState().project.scene).toEqual(before.project.scene);
    },
  );

  it('uses the same whole-group targets as ordinary desktop selection and nudge', async () => {
    const ids = await groupAt();
    useStore.getState().selectObjects([ids[0]]);
    expect(useStore.getState().additionalSelectedIds.has(ids[1])).toBe(true);
    useStore.getState().nudgeSelection(5, 0);
    const desktop = useStore.getState().project.scene.objects.map((object) => object.transform);
    useStore.getState().undo();
    const result = await adapter.execute(
      'transform_artwork',
      writeArgs(adapter, {
        artworkIds: [ids[0]],
        transform: { type: 'move', dxMm: 5, dyMm: 0 },
      }),
    );
    expect(resultCode(result)).toBe('ok');
    expect(useStore.getState().project.scene.objects.map((object) => object.transform)).toEqual(
      desktop,
    );
  });

  it('expands overlapping memberships transitively without transforming a member twice', async () => {
    const ids = await groupAt();
    const third = await addTestRectangle(adapter, 40);
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          groups: [
            ...state.project.scene.groups!,
            { id: 'overlapping-group', name: 'Overlap', objectIds: [ids[1], third] },
          ],
        },
      },
    });
    expect(
      await adapter.execute(
        'transform_artwork',
        writeArgs(adapter, {
          artworkIds: [ids[0], ids[1]],
          transform: { type: 'move', dxMm: 5, dyMm: 0 },
        }),
      ),
    ).toMatchObject({ ok: true, data: { changedArtworkIds: [...ids, third] } });
    expect(useStore.getState().project.scene.objects.map((object) => object.transform.x)).toEqual([
      5, 25, 45,
    ]);
  });

  it.each(['missing', 'locked', 'hidden'] as const)(
    'refuses the whole transform if an expanded member is %s',
    async (kind) => {
      const ids = await groupAt();
      const state = useStore.getState();
      const hiddenLayer = { ...state.project.scene.layers[0]!, id: 'hidden-op', visible: false };
      useStore.setState({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects
              .map((object) =>
                object.id !== ids[1]
                  ? object
                  : {
                      ...object,
                      ...(kind === 'locked' ? { locked: true } : {}),
                      ...(kind === 'hidden' ? { operationIds: ['hidden-op'] } : {}),
                    },
              )
              .filter((object) => kind !== 'missing' || object.id !== ids[1]),
            layers:
              kind === 'hidden'
                ? [...state.project.scene.layers, hiddenLayer]
                : state.project.scene.layers,
          },
        },
      });
      const before = useStore.getState();
      expect(
        resultCode(
          await adapter.execute(
            'transform_artwork',
            writeArgs(adapter, {
              artworkIds: [ids[0]],
              transform: { type: 'move', dxMm: 5, dyMm: 0 },
            }),
          ),
        ),
      ).toBe(kind === 'missing' ? 'not_found' : 'not_editable');
      expect(useStore.getState()).toBe(before);
    },
  );

  it.each([200, 201])(
    'retains the existing whole-target bound for a %s-member group',
    async (count) => {
      const id = await addTestRectangle(adapter);
      const state = useStore.getState();
      const source = state.project.scene.objects[0]!;
      const objects = Array.from({ length: count }, (_, index) => ({
        ...source,
        id: index === 0 ? id : `member-${index}`,
      }));
      useStore.setState({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects,
            groups: [
              {
                id: 'large-group',
                name: 'Large group',
                objectIds: objects.map((object) => object.id),
              },
            ],
          },
        },
      });
      const before = useStore.getState();
      const result = await adapter.execute(
        'transform_artwork',
        writeArgs(adapter, {
          artworkIds: [id],
          transform: { type: 'move', dxMm: 5, dyMm: 0 },
        }),
      );
      expect(resultCode(result)).toBe(count === 200 ? 'ok' : 'unsupported_operation');
      if (count === 200) {
        expect(result.ok && result.data['changedArtworkIds']).toHaveLength(200);
        expect(
          useStore.getState().project.scene.objects.every((object) => object.transform.x === 5),
        ).toBe(true);
      } else expect(useStore.getState()).toBe(before);
    },
  );

  it.each(['selection', 'document'] as const)(
    'refuses an obsolete group transform after a local %s change',
    async (change) => {
      const ids = await groupAt();
      const request = writeArgs(adapter, {
        artworkIds: [ids[0]],
        transform: { type: 'move', dxMm: 5, dyMm: 0 },
      });
      if (change === 'document') useStore.getState().newProject();
      else useStore.getState().selectObjects([]);
      const current = useStore.getState();
      expect(resultCode(await adapter.execute('transform_artwork', request))).toBe(
        'stale_revision',
      );
      expect(useStore.getState()).toBe(current);
    },
  );
});
