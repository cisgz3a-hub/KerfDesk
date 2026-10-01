import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { transformedBBox } from '../../core/scene/hit-test';
import { createRemoteControlAdapter } from './adapter';
import type { RemoteControlAdapter } from './types';
import type { TextRenderResult } from '../../core/text';

const render = vi.hoisted(() => vi.fn());
vi.mock('../text/render-text-geometry', () => ({ renderTextGeometry: render }));
let adapter: RemoteControlAdapter;
let finish: (geometry: TextRenderResult) => void;
let editable = true;
let writable = true;
const geometry: TextRenderResult = {
  bounds: { minX: -2, minY: -4, maxX: 38, maxY: 6 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: -2, y: -4 },
            { x: 38, y: 6 },
          ],
        },
      ],
    },
  ],
};
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  editable = true;
  writable = true;
  render.mockReset().mockImplementation(
    () =>
      new Promise<TextRenderResult>((resolve) => {
        finish = resolve;
      }),
  );
  adapter = createRemoteControlAdapter({
    getAppStatus: () => ({
      app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
      edition: { mode: 'free' },
      updates: { available: false },
    }),
    canWrite: () => writable,
    canEdit: () => editable,
  });
});
afterEach(() => adapter.dispose());
function request() {
  return {
    expectedRevision: adapter.getRevision(),
    requestId: crypto.randomUUID(),
    xMm: 12,
    yMm: 23,
    widthMm: 20,
    text: 'Remote text',
    fontSizeMm: 450,
  };
}
async function rendering() {
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
}
function localRectangle() {
  useStore.getState().drawShape(
    createRectangle({
      id: 'local-art',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    }),
  );
}

describe('delayed text never crosses renderer authority', () => {
  it('does not renew a full request window while a text write remains unresolved', async () => {
    const firstRequest = request();
    const pending = adapter.execute('add_text', firstRequest);
    await rendering();
    for (let index = 1; index < 256; index++) {
      const denied = await adapter.execute('transform_artwork', {
        expectedRevision: adapter.getRevision(),
        requestId: crypto.randomUUID(),
        artworkIds: ['missing'],
        transform: { type: 'move', dxMm: 1, dyMm: 0 },
      });
      expect(denied).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    const beforeCapacity = adapter.getRevision();
    writable = false;
    expect(
      await adapter.execute('set_selection', {
        expectedRevision: beforeCapacity,
        requestId: crypto.randomUUID(),
        artworkIds: [],
      }),
    ).toMatchObject({ ok: false, error: { code: 'read_only' } });
    expect(adapter.getRevision()).toBe(beforeCapacity);
    writable = true;
    expect(
      await adapter.execute('set_selection', {
        expectedRevision: 'old-generation:1',
        requestId: crypto.randomUUID(),
        artworkIds: [],
      }),
    ).toMatchObject({ ok: false, error: { code: 'stale_revision' } });
    expect(adapter.getRevision()).toBe(beforeCapacity);
    const refused = await adapter.execute('set_selection', {
      expectedRevision: beforeCapacity,
      requestId: crypto.randomUUID(),
      artworkIds: [],
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'failed' } });
    expect(adapter.getRevision()).toBe(beforeCapacity);
    const repeated = adapter.execute('add_text', firstRequest);
    expect(render).toHaveBeenCalledTimes(1);
    finish(geometry);
    expect(await pending).toEqual(await repeated);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(
      await adapter.execute('set_selection', {
        expectedRevision: adapter.getRevision(),
        requestId: crypto.randomUUID(),
        artworkIds: [],
      }),
    ).toMatchObject({ ok: false, error: { code: 'stale_revision' } });
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
  });
  it('places actual renderer geometry without bed fit and shrinks uniformly to maximum width', async () => {
    const result = adapter.execute('add_text', request());
    await rendering();
    expect(render.mock.calls[0]![0]).toMatchObject({ sizeMm: 450, content: 'Remote text' });
    finish(geometry);
    expect((await result).ok).toBe(true);
    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(1);
    const object = state.project.scene.objects[0]!;
    expect(transformedBBox(object)).toEqual({ minX: 12, minY: 23, maxX: 32, maxY: 28 });
    expect(object.transform.scaleX).toBe(object.transform.scaleY);
    expect(state.undoStack).toHaveLength(1);
    state.undo();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
  });

  it.each(['new', 'selection', 'edit', 'undo', 'open', 'open-picker'] as const)(
    'rejects a delayed text commit after %s',
    async (action) => {
      localRectangle();
      const result = adapter.execute('add_text', request());
      await rendering();
      switch (action) {
        case 'open-picker':
          useStore.getState().claimProjectOpenRequest();
          break;
        case 'new':
          useStore.getState().newProject();
          break;
        case 'selection':
          useStore.getState().selectObjects([]);
          break;
        case 'edit':
          useStore
            .getState()
            .setLayerParam(useStore.getState().project.scene.layers[0]!.id, { power: 56 });
          break;
        case 'undo':
          useStore.getState().undo();
          break;
        case 'open': {
          const project = { ...useStore.getState().project, notes: 'Opened document' };
          useStore.getState().setProject(project);
          useStore.getState().markLoaded('replacement.lf2');
          break;
        }
      }
      const afterLocal = useStore.getState().project;
      finish(geometry);
      expect(await result).toMatchObject({ ok: false, error: { code: 'stale_revision' } });
      expect(useStore.getState().project).toBe(afterLocal);
      expect(
        useStore.getState().project.scene.objects.some((object) => object.kind === 'text'),
      ).toBe(false);
    },
  );

  it('returns cancellation promptly and still discards a renderer that finishes later', async () => {
    const controller = new AbortController();
    const input = request();
    const result = adapter.execute('add_text', input, { signal: controller.signal });
    await rendering();
    controller.abort();
    expect(await result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    finish(geometry);
    await Promise.resolve();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(await adapter.execute('add_text', input)).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it.each(['permission', 'read-only', 'dispose'] as const)(
    'cannot commit after %s changes while rendering',
    async (change) => {
      const result = adapter.execute('add_text', request());
      await rendering();
      if (change === 'permission') editable = false;
      else if (change === 'read-only') writable = false;
      else adapter.dispose();
      finish(geometry);
      expect(await result).toMatchObject({
        ok: false,
        error: {
          code: change === 'dispose' ? 'cancelled' : change === 'read-only' ? 'read_only' : 'busy',
        },
      });
      expect(useStore.getState().project.scene.objects).toHaveLength(0);
    },
  );

  it('snapshots request arguments so a caller cannot replace text during asynchronous work', async () => {
    const input = request();
    const result = adapter.execute('add_text', input);
    input.text = 'Changed outside the relay';
    await rendering();
    finish(geometry);
    expect((await result).ok).toBe(true);
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({ content: 'Remote text' });
  });
});
