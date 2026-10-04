import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import { IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import type { TextRenderResult } from '../../core/text';
import type { RemoteControlAdapter } from './types';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';

const render = vi.hoisted(() => vi.fn());
vi.mock('../text/render-text-geometry', () => ({ renderTextGeometry: render }));
const geometry: TextRenderResult = {
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 10 },
          ],
        },
      ],
    },
  ],
};
const original: TextObject = {
  kind: 'text',
  id: 'text-owner',
  content: 'Original',
  fontKey: 'roboto-regular',
  sizeMm: 8,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#000000',
  transform: IDENTITY_TRANSFORM,
  bounds: geometry.bounds,
  paths: geometry.paths,
};
let adapter: RemoteControlAdapter;
let writable = true;
let editable = true;
let finish: (value: TextRenderResult) => void;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().upsertTextObject(original, undefined, { placement: 'canvas' });
  writable = editable = true;
  render.mockReset().mockImplementation(
    () =>
      new Promise<TextRenderResult>((resolve) => {
        finish = resolve;
      }),
  );
  adapter = testAdapter({ canWrite: () => writable, canEdit: () => editable });
});
afterEach(() => adapter.dispose());
function request() {
  return writeArgs(adapter, {
    artworkId: original.id,
    patch: { text: 'New words', fontSizeMm: 12 },
  });
}
async function rendering() {
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
}

describe('remote text update keeps exact document ownership across font work', () => {
  it.each(['new', 'open', 'open-picker', 'undo', 'local-settings', 'selection'] as const)(
    'refuses late text after %s without touching the replacement',
    async (action) => {
      const pending = adapter.execute('update_text', request());
      await rendering();
      const state = useStore.getState();
      if (action === 'new') state.newProject();
      if (action === 'open') {
        state.setProject({ ...state.project, notes: 'Replacement document' });
        useStore.getState().markLoaded('replacement.lf2');
      }
      if (action === 'open-picker') state.claimProjectOpenRequest();
      if (action === 'undo') state.undo();
      if (action === 'local-settings')
        state.setLayerParam(state.project.scene.layers[0]!.id, { power: 15 });
      if (action === 'selection') state.selectObjects([]);
      const afterLocal = useStore.getState();
      finish(geometry);
      expect(resultCode(await pending)).toBe('stale_revision');
      expect(useStore.getState()).toBe(afterLocal);
    },
  );

  it.each(['permission', 'busy', 'interaction', 'dispose', 'abort'] as const)(
    'refuses late text after %s',
    async (action) => {
      const controller = new AbortController();
      const pending = adapter.execute('update_text', request(), { signal: controller.signal });
      await rendering();
      if (action === 'permission') writable = false;
      if (action === 'busy') editable = false;
      if (action === 'interaction') useStore.getState().beginInteraction();
      if (action === 'dispose') adapter.dispose();
      if (action === 'abort') controller.abort();
      const before = useStore.getState();
      finish(geometry);
      const expected =
        action === 'permission'
          ? 'read_only'
          : action === 'busy' || action === 'interaction'
            ? 'busy'
            : 'cancelled';
      expect(resultCode(await pending)).toBe(expected);
      expect(useStore.getState()).toBe(before);
    },
  );

  it('deduplicates asynchronous edits and detaches mutable caller patches', async () => {
    const args = request();
    const initial = structuredClone(args);
    const first = adapter.execute('update_text', args);
    const second = adapter.execute('update_text', structuredClone(args));
    (args['patch'] as { text: string }).text = 'Caller changed it while loading';
    await rendering();
    finish(geometry);
    expect(await first).toEqual(await second);
    expect(resultCode(await adapter.execute('update_text', initial))).toBe('ok');
    expect(resultCode(await adapter.execute('update_text', args))).toBe('request_conflict');
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({ content: 'New words' });
    expect(useStore.getState().undoStack).toHaveLength(2);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('lets only one of two parallel edits at the same revision publish', async () => {
    const resolvers: ((value: TextRenderResult) => void)[] = [];
    render.mockImplementation(
      () => new Promise<TextRenderResult>((resolve) => resolvers.push(resolve)),
    );
    const first = adapter.execute('update_text', request());
    const second = adapter.execute(
      'update_text',
      writeArgs(adapter, { artworkId: original.id, patch: { text: 'Second edit' } }),
    );
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    resolvers[1]!(geometry);
    expect(resultCode(await second)).toBe('ok');
    resolvers[0]!(geometry);
    expect(resultCode(await first)).toBe('stale_revision');
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({ content: 'Second edit' });
    expect(useStore.getState().undoStack).toHaveLength(2);
  });
});
