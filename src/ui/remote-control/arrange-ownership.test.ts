import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import type { RemoteControlAdapter } from './types';
import { addTestRectangle, resultCode, testAdapter, writeArgs } from './authoring-test-support';

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  adapter = testAdapter();
});
afterEach(() => adapter.dispose());
async function arrange(artworkIds: readonly string[], action: string) {
  return adapter.execute('arrange_artwork', writeArgs(adapter, { artworkIds, action }));
}
function guidedText(guideObjectId: string, locked = false): TextObject {
  return {
    kind: 'text',
    id: 'dependent-text',
    content: 'Guided',
    fontKey: 'roboto-regular',
    sizeMm: 8,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    locked,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 5 },
            ],
          },
        ],
      },
    ],
    pathText: { guideObjectId, offsetMm: 0, reverse: false },
  };
}

describe('whole-target layout preparation', () => {
  it.each(['new', 'open-picker'] as const)(
    'does not group or copy into a %s document during selection settlement',
    async (action) => {
      const first = await addTestRectangle(adapter, 0);
      const second = await addTestRectangle(adapter, 20);
      let armed = true;
      const unsubscribe = useStore.subscribe((state) => {
        if (!armed || state.selectedObjectId !== first) return;
        armed = false;
        if (action === 'new') state.newProject();
        else state.claimProjectOpenRequest();
      });
      try {
        const result = await arrange([first, second], 'group');
        expect(resultCode(result)).toBe('stale_revision');
        expect(useStore.getState().project.scene.groups ?? []).toHaveLength(0);
        expect(useStore.getState().project.scene.objects).toHaveLength(action === 'new' ? 0 : 2);
      } finally {
        unsubscribe();
      }
    },
  );

  it('refuses copy dependencies that are locked before changing selection or history', async () => {
    const guide = await addTestRectangle(adapter);
    useStore.getState().upsertTextObject(guidedText(guide), undefined, { placement: 'canvas' });
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) =>
            object.id === guide ? { ...object, locked: true } : object,
          ),
        },
      },
    });
    const before = useStore.getState();
    expect(resultCode(await arrange(['dependent-text'], 'duplicate'))).toBe('not_editable');
    expect(useStore.getState()).toBe(before);
  });

  it('refuses deletion that would alter a locked text guide dependant, then uses ordinary repair when editable', async () => {
    const guide = await addTestRectangle(adapter);
    useStore
      .getState()
      .upsertTextObject(guidedText(guide, true), undefined, { placement: 'canvas' });
    const before = useStore.getState();
    expect(resultCode(await arrange([guide], 'delete'))).toBe('not_editable');
    expect(useStore.getState()).toBe(before);
    useStore.setState({
      project: {
        ...before.project,
        scene: {
          ...before.project.scene,
          objects: before.project.scene.objects.map((object) =>
            object.id === 'dependent-text' ? { ...object, locked: false } : object,
          ),
        },
      },
    });
    const editable = useStore.getState();
    expect(await arrange([guide], 'delete')).toMatchObject({
      ok: true,
      data: { changedArtworkIds: [guide, 'dependent-text'] },
    });
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(useStore.getState().project.scene.objects[0]).not.toHaveProperty('pathText');
    expect(resultCode(await adapter.execute('undo', writeArgs(adapter)))).toBe('ok');
    expect(useStore.getState().project).toBe(editable.project);
  });
});
