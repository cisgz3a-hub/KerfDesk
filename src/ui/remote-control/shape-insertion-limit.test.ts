import { afterEach, beforeEach, expect, it } from 'vitest';
import { createLayer } from '../../core/scene';
import { useStore } from '../state/store';
import { loadScene } from '../state/testing/scene-limit-fixtures';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  adapter = testAdapter();
});
afterEach(() => adapter.dispose());

function loadOperations(count: number) {
  loadScene(
    [],
    [],
    [],
    Array.from({ length: count }, (_, index) =>
      createLayer({
        id: `operation-${index}`,
        color: `#${index.toString(16).padStart(6, '0')}`,
      }),
    ),
  );
  return useStore.getState();
}
const rectangle = { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 };
it.each([
  ['add_rectangle', rectangle],
  ['add_ellipse', rectangle],
  [
    'add_polyline',
    {
      pointsMm: [
        { xMm: 0, yMm: 0 },
        { xMm: 10, yMm: 10 },
      ],
      closed: false,
    },
  ],
] as const)(
  '%s does not acknowledge a drawing refused by the desktop limits',
  async (command, args) => {
    const before = loadOperations(256);
    const revision = adapter.getRevision();
    const result = await adapter.execute(command, writeArgs(adapter, args));
    expect(resultCode(result)).toBe('failed');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(adapter.getRevision()).toBe(revision);
  },
);

it('rolls back the complete batch when a later shape cannot be inserted', async () => {
  const before = loadOperations(255);
  const result = await adapter.execute(
    'apply_edits',
    writeArgs(adapter, {
      edits: [
        { command: 'add_rectangle', args: rectangle },
        { command: 'add_ellipse', args: rectangle },
      ],
    }),
  );
  expect(resultCode(result)).not.toBe('ok');
  expect(useStore.getState().project).toBe(before.project);
  expect(useStore.getState().undoStack).toBe(before.undoStack);
  expect(useStore.getState().pendingUndo).toBeNull();
});
