import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRemoteControlAdapter } from './adapter';
import { useStore } from '../state/store';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { RemoteControlAdapter, RemoteCommandResult, SafeRemoteAppStatus } from './types';

const APP: SafeRemoteAppStatus = {
  app: { name: 'KerfDesk', version: '1.0.3', platform: 'desktop' },
  edition: { mode: 'free' },
  updates: { available: false },
};
let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  adapter = createRemoteControlAdapter({ getAppStatus: () => APP, canWrite: () => true });
});
afterEach(() => adapter.dispose());
function args(extra: Record<string, unknown> = {}) {
  return { expectedRevision: adapter.getRevision(), requestId: crypto.randomUUID(), ...extra };
}
async function rectangle(x = 0) {
  const result = await adapter.execute(
    'add_rectangle',
    args({ xMm: x, yMm: 0, widthMm: 10, heightMm: 20 }),
  );
  expect(result.ok).toBe(true);
  return useStore.getState().project.scene.objects.at(-1)!.id;
}
function code(result: RemoteCommandResult) {
  return result.ok ? 'ok' : result.error.code;
}

describe('remote renderer uses the real authoring store', () => {
  it('creates, changes laser settings, and keeps ordinary Undo/Redo and dirty tracking', async () => {
    const id = await rectangle();
    const state = useStore.getState();
    expect(state.dirty).toBe(true);
    expect(state.undoStack).toHaveLength(1);
    const operationId = state.project.scene.layers[0]!.id;
    expect(
      code(
        await adapter.execute(
          'update_operation',
          args({
            operationId,
            patch: { powerPercent: 47, speedMmPerMin: 2300, passes: 2, enabled: false },
          }),
        ),
      ),
    ).toBe('ok');
    expect(useStore.getState().project.scene.layers[0]).toMatchObject({
      power: 47,
      speed: 2300,
      passes: 2,
      output: false,
    });
    const updatedRevision = adapter.getRevision();
    useStore.getState().undo();
    expect(adapter.getRevision()).not.toBe(updatedRevision);
    expect(useStore.getState().project.scene.layers[0]!.power).toBe(30);
    useStore.getState().redo();
    expect(useStore.getState().project.scene.layers[0]!.power).toBe(47);
    expect(useStore.getState().project.scene.objects[0]!.id).toBe(id);
  });

  it('deduplicates completed and concurrent identical requests; rejects altered reuse', async () => {
    const request = args({ xMm: 3, yMm: 4, widthMm: 10, heightMm: 20 });
    const [first, second] = await Promise.all([
      adapter.execute('add_rectangle', request),
      adapter.execute('add_rectangle', { ...request }),
    ]);
    expect(first).toEqual(second);
    expect(await adapter.execute('add_rectangle', request)).toEqual(first);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(code(await adapter.execute('add_rectangle', { ...request, xMm: 99 }))).toBe(
      'request_conflict',
    );
  });

  it('renews a full idle request window and fences old writes behind a fresh read', async () => {
    const firstArgs = args({ artworkIds: [] });
    const first = await adapter.execute('set_selection', firstArgs);
    for (let index = 1; index < 256; index++)
      await adapter.execute('set_selection', args({ artworkIds: [] }));
    expect(await adapter.execute('set_selection', firstArgs)).toEqual(first);
    expect(
      code(await adapter.execute('set_selection', { ...firstArgs, artworkIds: ['missing'] })),
    ).toBe('request_conflict');
    const beforeRenewal = adapter.getRevision();
    const beforeState = useStore.getState();
    expect(code(await adapter.execute('set_selection', args({ artworkIds: [] })))).toBe(
      'stale_revision',
    );
    expect(adapter.getRevision()).not.toBe(beforeRenewal);
    expect(useStore.getState()).toBe(beforeState);
    expect(code(await adapter.execute('set_selection', firstArgs))).toBe('stale_revision');
    expect(useStore.getState()).toBe(beforeState);
    const current = await adapter.execute('get_workspace', {});
    expect(current.ok).toBe(true);
    expect(current.revision).toBe(adapter.getRevision());
    for (let index = 0; index < 254; index++)
      expect(code(await adapter.execute('set_selection', args({ artworkIds: [] })))).toBe('ok');
    const nextGeneration = adapter.getRevision();
    expect(code(await adapter.execute('set_selection', args({ artworkIds: [] })))).toBe('ok');
    expect(code(await adapter.execute('set_selection', args({ artworkIds: [] })))).toBe(
      'stale_revision',
    );
    expect(adapter.getRevision()).not.toBe(nextGeneration);
    expect(code(await adapter.execute('set_selection', args({ artworkIds: [] })))).toBe('ok');
  });

  it('continues real artwork edits through two request windows with ordinary Undo', async () => {
    const id = await rectangle();
    let renewals = 0;
    let firstMove: Record<string, unknown> | null = null;
    for (let index = 0; index < 520; index++) {
      let input = args({ artworkIds: [id], transform: { type: 'move', dxMm: 0.1, dyMm: 0.2 } });
      if (firstMove === null) firstMove = input;
      const before = useStore.getState();
      const result = await adapter.execute('transform_artwork', input);
      if (code(result) === 'stale_revision') {
        renewals += 1;
        expect(useStore.getState()).toBe(before);
        expect((await adapter.execute('get_workspace', {})).ok).toBe(true);
        input = args({ artworkIds: [id], transform: { type: 'move', dxMm: 0.1, dyMm: 0.2 } });
        expect(code(await adapter.execute('transform_artwork', input))).toBe('ok');
      } else expect(code(result)).toBe('ok');
    }
    expect(renewals).toBe(2);
    const beforeReplay = useStore.getState();
    expect(code(await adapter.execute('transform_artwork', firstMove))).toBe('stale_revision');
    expect(useStore.getState()).toBe(beforeReplay);
    const moved = useStore.getState().project.scene.objects[0]!.transform;
    expect(moved.x).toBeCloseTo(52, 8);
    expect(moved.y).toBeCloseTo(104, 8);
    useStore.getState().undo();
    const undone = useStore.getState().project.scene.objects[0]!.transform;
    expect(undone.x).toBeCloseTo(51.9, 8);
    expect(undone.y).toBeCloseTo(103.8, 8);
  });

  it('counts reserved writes before their execution microtasks start', async () => {
    const before = adapter.getRevision();
    const reserved = Array.from({ length: 256 }, () =>
      adapter.execute('set_selection', args({ artworkIds: [] })),
    );
    const refused = adapter.execute('set_selection', args({ artworkIds: [] }));
    expect(adapter.getRevision()).toBe(before);
    expect(code(await refused)).toBe('failed');
    await Promise.all(reserved);
    expect(code(await adapter.execute('set_selection', args({ artworkIds: [] })))).toBe(
      'stale_revision',
    );
  });

  it('rejects stale revisions after selection, local edits, Undo, and document replacement', async () => {
    const id = await rectangle();
    const stale = args({ artworkIds: [] });
    useStore.getState().selectObjects([]);
    expect(code(await adapter.execute('set_selection', stale))).toBe('stale_revision');
    const beforeUndo = adapter.getRevision();
    useStore.getState().undo();
    expect(adapter.getRevision()).not.toBe(beforeUndo);
    useStore.getState().redo();
    expect(useStore.getState().project.scene.objects[0]!.id).toBe(id);
    const beforeNew = adapter.getRevision();
    useStore.getState().newProject();
    expect(adapter.getRevision()).not.toBe(beforeNew);
    const other = createRemoteControlAdapter({ getAppStatus: () => APP, canWrite: () => true });
    expect(other.getRevision()).not.toBe(adapter.getRevision());
    other.dispose();
  });

  it('uses group-bounds resize and relative group-centre rotation in one undo step each', async () => {
    const first = await rectangle(0);
    const second = await rectangle(20);
    const artworkIds = [first, second];
    expect(
      code(
        await adapter.execute(
          'transform_artwork',
          args({ artworkIds, transform: { type: 'resize', widthMm: 60, heightMm: 40 } }),
        ),
      ),
    ).toBe('ok');
    expect(useStore.getState().project.scene.objects.map((object) => object.transform.x)).toEqual([
      0, 40,
    ]);
    expect(
      code(
        await adapter.execute(
          'transform_artwork',
          args({ artworkIds, transform: { type: 'rotate', angleDeg: 90 } }),
        ),
      ),
    ).toBe('ok');
    const transforms = useStore.getState().project.scene.objects.map((object) => object.transform);
    expect(transforms[0]!.x).toBeCloseTo(50);
    expect(transforms[0]!.y).toBeCloseTo(-10);
    expect(transforms[1]!.x).toBeCloseTo(50);
    expect(transforms[1]!.y).toBeCloseTo(30);
    expect(useStore.getState().undoStack).toHaveLength(4);
  });

  it('refuses the entire transform for missing or locked targets without a partial edit', async () => {
    const id = await rectangle();
    const state = useStore.getState();
    expect(
      code(
        await adapter.execute(
          'transform_artwork',
          args({ artworkIds: [id, 'missing'], transform: { type: 'move', dxMm: 3, dyMm: 4 } }),
        ),
      ),
    ).toBe('not_found');
    expect(useStore.getState().project).toBe(state.project);
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) => ({ ...object, locked: true })),
        },
      },
    });
    expect(
      code(
        await adapter.execute(
          'transform_artwork',
          args({ artworkIds: [id], transform: { type: 'move', dxMm: 3, dyMm: 4 } }),
        ),
      ),
    ).toBe('not_editable');
  });

  it('refuses CNC creation/settings without changing the workspace, but edits existing CNC art', async () => {
    const id = await rectangle();
    useStore.setState({
      project: { ...useStore.getState().project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    const project = useStore.getState().project;
    const writes = [
      ['add_rectangle', { xMm: 1, yMm: 2, widthMm: 3, heightMm: 4 }],
      ['add_text', { xMm: 1, yMm: 2, widthMm: 3, text: 'CNC', fontSizeMm: 5 }],
      [
        'update_operation',
        { operationId: project.scene.layers[0]!.id, patch: { powerPercent: 7 } },
      ],
    ] as const;
    for (const [command, value] of writes)
      expect(code(await adapter.execute(command, args(value)))).toBe('unsupported_operation');
    expect(useStore.getState().project).toBe(project);
    expect(
      code(
        await adapter.execute(
          'transform_artwork',
          args({ artworkIds: [id], transform: { type: 'move', dxMm: 5, dyMm: 6 } }),
        ),
      ),
    ).toBe('ok');
    expect(useStore.getState().project.scene.objects[0]!.transform).toMatchObject({ x: 5, y: 6 });
  });
});

describe('remote argument and permission boundary', () => {
  it('reports an already committed write accurately if cancellation arrives from a store listener', async () => {
    const controller = new AbortController();
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.project !== previous.project) controller.abort();
    });
    try {
      const input = args({ xMm: 0, yMm: 0, widthMm: 10, heightMm: 20 });
      const result = await adapter.execute('add_rectangle', input, { signal: controller.signal });
      expect(result.ok).toBe(true);
      expect(await adapter.execute('add_rectangle', input)).toEqual(result);
      expect(useStore.getState().project.scene.objects).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });
  it.each([
    ['start_job', {}],
    ['get_workspace', { extra: true }],
    ['add_rectangle', { xMm: NaN, yMm: 0, widthMm: 10, heightMm: 10 }],
    ['add_rectangle', { xMm: 0, yMm: 0, widthMm: -1, heightMm: 10 }],
    ['set_selection', { artworkIds: ['same', 'same'] }],
    ['update_operation', { operationId: 'x', patch: { powerPercent: 101 } }],
    ['update_operation', { operationId: 'x', patch: { passes: 1.5 } }],
    ['update_operation', { operationId: 'x', patch: { cnc: {} } }],
  ])('rejects invalid or unexposed command %s before mutation', async (command, input) => {
    const before = useStore.getState();
    const result = await adapter.execute(
      command,
      command === 'get_workspace' ? input : args(input),
    );
    expect(result.ok).toBe(false);
    expect(useStore.getState()).toBe(before);
  });
  it('keeps read-only connections readable and does not echo internal exceptions', async () => {
    adapter.dispose();
    adapter = createRemoteControlAdapter({
      getAppStatus: () => {
        throw Error('KD1.private-key C:/private/file');
      },
      canWrite: () => false,
    });
    expect(code(await adapter.execute('get_workspace', {}))).toBe('ok');
    expect(code(await adapter.execute('set_selection', args({ artworkIds: [] })))).toBe(
      'read_only',
    );
    const result = await adapter.execute('get_app_status', {});
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('requires strict empty read arguments and refuses a cancelled or disposed request', async () => {
    expect(code(await adapter.execute('get_machine', { rawProfile: true }))).toBe(
      'invalid_arguments',
    );
    expect(code(await adapter.execute('get_machine', {}, { signal: AbortSignal.abort() }))).toBe(
      'cancelled',
    );
    adapter.dispose();
    expect(code(await adapter.execute('get_workspace', {}))).toBe('cancelled');
  });
});
