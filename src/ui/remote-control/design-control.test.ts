import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { createRemoteControlAdapter } from './adapter';
import type { RemoteCommandResult, RemoteControlAdapter, SafeRemoteAppStatus } from './types';

const APP: SafeRemoteAppStatus = {
  app: { name: 'KerfDesk', version: '1.0.3', platform: 'desktop' },
  edition: { mode: 'free' },
  updates: { available: false },
};
let adapter: RemoteControlAdapter;
let sharing = true;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  sharing = true;
  adapter = createRemoteControlAdapter({
    getAppStatus: () => APP,
    canWrite: () => true,
    canShareArtwork: () => sharing,
  });
});
afterEach(() => adapter.dispose());
const args = (extra: Record<string, unknown> = {}) => ({
  expectedRevision: adapter.getRevision(),
  requestId: crypto.randomUUID(),
  ...extra,
});
const code = (result: RemoteCommandResult) => (result.ok ? 'ok' : result.error.code);
const data = (result: RemoteCommandResult) => {
  if (!result.ok) throw new Error(`Expected success, got ${result.error.code}`);
  return result.data as Record<string, unknown>;
};

describe('ADR-584 batch edits', () => {
  it('applies several edits as one named Undo step and resolves $n references', async () => {
    const result = await adapter.execute(
      'apply_edits',
      args({
        edits: [
          { command: 'add_rectangle', args: { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 } },
          { command: 'add_ellipse', args: { xMm: 30, yMm: 0, widthMm: 10, heightMm: 10 } },
          { command: 'arrange_artwork', args: { artworkIds: ['$0', '$1'], action: 'align_top' } },
          { command: 'create_operation', args: { mode: 'fill', name: 'Engrave' } },
          {
            command: 'assign_artwork_to_operation',
            args: { artworkIds: ['$1'], operationId: '$3' },
          },
        ],
      }),
    );
    expect(code(result)).toBe('ok');
    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(2);
    expect(state.undoStack).toHaveLength(1);
    const layer = state.project.scene.layers.find((item) => item.name === 'Engrave');
    expect(layer?.mode).toBe('fill');
    const summary = data(await adapter.execute('get_workspace', {}));
    const artwork = summary.artwork as { id: string; operationId?: string }[];
    const ellipseId = (data(result).results as { changedArtworkIds?: string[] }[])[1]!
      .changedArtworkIds![0];
    expect(artwork.find((item) => item.id === ellipseId)?.operationId).toBe(layer?.id);
    const results = data(result).results as { command: string; operationId?: string }[];
    expect(results.map((item) => item.command)).toEqual([
      'add_rectangle',
      'add_ellipse',
      'arrange_artwork',
      'create_operation',
      'assign_artwork_to_operation',
    ]);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().project.scene.layers.some((item) => item.name === 'Engrave')).toBe(
      false,
    );
  });

  it('rolls the whole batch back with no Undo entry when one item fails', async () => {
    const before = useStore.getState().project;
    const result = await adapter.execute(
      'apply_edits',
      args({
        edits: [
          { command: 'add_rectangle', args: { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 } },
          {
            command: 'transform_artwork',
            args: { artworkIds: ['missing'], transform: { type: 'move', dxMm: 1, dyMm: 1 } },
          },
        ],
      }),
    );
    expect(code(result)).not.toBe('ok');
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('refuses a forward or out-of-range reference without editing', async () => {
    const before = useStore.getState().project;
    const result = await adapter.execute(
      'apply_edits',
      args({
        edits: [
          { command: 'arrange_artwork', args: { artworkIds: ['$1'], action: 'delete' } },
          { command: 'add_rectangle', args: { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 } },
        ],
      }),
    );
    expect(code(result)).not.toBe('ok');
    expect(useStore.getState().project).toBe(before);
  });
});

describe('ADR-584 operations', () => {
  it('creates, renames, reorders and deletes operations through the desktop actions', async () => {
    await adapter.execute('add_rectangle', args({ xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 }));
    const created = data(
      await adapter.execute('create_operation', args({ mode: 'image', name: 'Photo' })),
    );
    const id = created.operationId as string;
    expect(useStore.getState().project.scene.layers.find((item) => item.id === id)).toMatchObject({
      name: 'Photo',
      mode: 'image',
    });
    const firstId = useStore.getState().project.scene.layers[0]!.id;
    expect(
      code(await adapter.execute('reorder_operation', args({ operationId: id, direction: 'up' }))),
    ).toBe('ok');
    expect(
      useStore
        .getState()
        .project.scene.layers.map((item) => item.id)
        .indexOf(id),
    ).toBeLessThan(
      useStore
        .getState()
        .project.scene.layers.map((item) => item.id)
        .indexOf(firstId),
    );
    expect(code(await adapter.execute('delete_operation', args({ operationId: id })))).toBe('ok');
    expect(useStore.getState().project.scene.layers.some((item) => item.id === id)).toBe(false);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
  });

  it('never deletes the last operation and reports unknown operations as not found', async () => {
    const only = useStore.getState().project.scene.layers;
    if (only.length === 1)
      expect(
        code(await adapter.execute('delete_operation', args({ operationId: only[0]!.id }))),
      ).not.toBe('ok');
    expect(
      code(
        await adapter.execute('reorder_operation', args({ operationId: 'nope', direction: 'up' })),
      ),
    ).toBe('not_found');
  });

  it('edits the extended Laser fields and refuses CNC fields on a Laser operation', async () => {
    await adapter.execute('add_rectangle', args({ xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 }));
    const operationId = useStore.getState().project.scene.layers[0]!.id;
    expect(
      code(
        await adapter.execute(
          'update_operation',
          args({
            operationId,
            patch: { name: 'Score', mode: 'fill', fillIntervalMm: 0.2, airAssist: true },
          }),
        ),
      ),
    ).toBe('ok');
    expect(useStore.getState().project.scene.layers[0]).toMatchObject({
      name: 'Score',
      mode: 'fill',
      airAssist: true,
    });
    const before = useStore.getState().project;
    expect(
      code(
        await adapter.execute(
          'update_operation',
          args({ operationId, patch: { cnc: { depthMm: 2 } } }),
        ),
      ),
    ).toBe('unsupported_operation');
    expect(useStore.getState().project).toBe(before);
  });
});

describe('ADR-584 SVG import', () => {
  it('imports sanitised SVG as editable vector artwork in one Undo step', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20"><script>alert(1)</script><rect x="0" y="0" width="40" height="20" fill="none" stroke="#000"/></svg>';
    const result = await adapter.execute('add_svg', args({ svg, xMm: 5, yMm: 6 }));
    expect(code(result)).toBe('ok');
    expect(useStore.getState().project.scene.objects.length).toBeGreaterThan(0);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(JSON.stringify(useStore.getState().project.scene.objects)).not.toContain('alert(1)');
  });

  it('refuses text that is not SVG without editing', async () => {
    const before = useStore.getState().project;
    expect(code(await adapter.execute('add_svg', args({ svg: 'not an svg' })))).not.toBe('ok');
    expect(useStore.getState().project).toBe(before);
  });
});

describe('ADR-582 vector scene projection', () => {
  it('projects decodable geometry for current artwork and nothing when sharing is off', async () => {
    await adapter.execute('add_rectangle', args({ xMm: 10, yMm: 20, widthMm: 30, heightMm: 15 }));
    const read = await adapter.execute('get_workspace_scene', {});
    const scene = data(read);
    expect(scene.status).toBe('ready');
    expect(read.ok && read.revision).toBe(adapter.getRevision());
    const objects = scene.objects as {
      id: string;
      bounds: Record<string, number>;
      paths: { polylines: { points: string }[] }[];
    }[];
    expect(objects).toHaveLength(1);
    expect(objects[0]!.bounds.xMm).toBeCloseTo(10, 1);
    expect(objects[0]!.bounds.widthMm).toBeCloseTo(30, 1);
    const encoded = objects[0]!.paths[0]!.polylines[0]!.points;
    let x = 0;
    let y = 0;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const pair of encoded.split(' ')) {
      const [dx, dy] = pair.split(',').map(Number);
      x += dx!;
      y += dy!;
      xs.push(x / 100);
      ys.push(y / 100);
    }
    expect(Math.min(...xs)).toBeCloseTo(10, 1);
    expect(Math.max(...xs)).toBeCloseTo(40, 1);
    expect(Math.min(...ys)).toBeCloseTo(20, 1);
    expect(Math.max(...ys)).toBeCloseTo(35, 1);
    sharing = false;
    const disabled = data(await adapter.execute('get_workspace_scene', {}));
    expect(disabled.status).toBe('disabled');
    expect(JSON.stringify(disabled)).not.toContain('polylines');
  });
});
