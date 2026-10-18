import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveEdition, UNRESTRICTED_EDITION } from '../licensing/edition';
import { useToastStore } from '../state/toast-store';
import { resetStore } from '../state/test-helpers';
import {
  cancelBackgroundVectorCommand,
  runVectorCommandInBackground,
} from './background-vector-command';
import type { VectorOpOutcome } from './vector-op-worker-client';
import { parityObjects } from './vector-op-worker.test-fixture';

type FakeSession = {
  resolve: (outcome: VectorOpOutcome<unknown>) => void;
  released: boolean;
};
const sessions: FakeSession[] = [];

vi.mock('./vector-op-worker-client', () => ({
  createVectorOpSession: () => {
    const session: FakeSession = { resolve: () => undefined, released: false };
    sessions.push(session);
    return {
      run: () => new Promise((resolve) => (session.resolve = resolve)),
      release: () => {
        session.released = true;
        session.resolve({ kind: 'superseded' });
      },
    };
  },
}));

function command(label: string) {
  return {
    label,
    sources: parityObjects(),
    task: { kind: 'offset-paths', deltaMm: 1, id: 'offset-paths' } as const,
    commit: vi.fn(),
    inThread: vi.fn(),
  };
}

const messages = (): ReadonlyArray<string> =>
  useToastStore.getState().toasts.map((toast) => toast.message);

beforeEach(() => {
  resetStore();
  sessions.length = 0;
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  cancelBackgroundVectorCommand();
  setActiveEdition(null);
  vi.useRealTimers();
});

describe('one-click background vector commands (ADR-609)', () => {
  it('reports work that failed and never retries it on the UI thread', async () => {
    const offset = command('Offset outlines');
    const running = runVectorCommandInBackground(offset);
    sessions[0]!.resolve({ kind: 'failed', message: 'Out of memory.' });
    await expect(running).resolves.toBe(false);
    expect(offset.inThread).not.toHaveBeenCalled();
    expect(offset.commit).not.toHaveBeenCalled();
    expect(messages()).toContain('Offset outlines could not be completed. Out of memory.');
  });

  it('runs in thread only when the worker could not start', async () => {
    const offset = command('Offset outlines');
    const running = runVectorCommandInBackground(offset);
    sessions[0]!.resolve({ kind: 'unavailable', message: 'No worker.' });
    await expect(running).resolves.toBe(true);
    expect(offset.inThread).toHaveBeenCalledOnce();
  });

  it('lets a newer command of another kind cancel the running one', async () => {
    const offset = command('Offset outlines');
    const cut = command('Cut Shapes');
    const first = runVectorCommandInBackground(offset);
    const second = runVectorCommandInBackground(cut);
    await expect(first).resolves.toBe(false);
    expect(sessions[0]!.released).toBe(true);
    expect(messages()).toContain('Offset outlines was cancelled: Cut Shapes started.');
    sessions[1]!.resolve({ kind: 'done', result: { kind: 'ok', value: null } });
    await expect(second).resolves.toBe(true);
    expect(offset.commit).not.toHaveBeenCalled();
    expect(cut.commit).toHaveBeenCalledOnce();
  });

  it('lets a refused click cancel the running command', async () => {
    const offset = command('Offset outlines');
    const running = runVectorCommandInBackground(offset);
    cancelBackgroundVectorCommand('Offset outlines');
    await expect(running).resolves.toBe(false);
    expect(sessions[0]!.released).toBe(true);
    expect(offset.commit).not.toHaveBeenCalled();
  });

  it('does not commit over an open Pro prompt', async () => {
    const offset = command('Offset outlines');
    const running = runVectorCommandInBackground(offset);
    setActiveEdition({ ...UNRESTRICTED_EDITION, proPromptOpen: true });
    sessions[0]!.resolve({ kind: 'done', result: { kind: 'ok', value: null } });
    await expect(running).resolves.toBe(false);
    expect(offset.commit).not.toHaveBeenCalled();
    expect(messages()).toContain(
      'Offset outlines was not applied: a Pro prompt is open. Close it, then run Offset outlines again.',
    );
  });

  it('keeps its working notice up until the work settles', async () => {
    vi.useFakeTimers();
    const running = runVectorCommandInBackground(command('Cut Shapes'));
    await vi.advanceTimersByTimeAsync(400);
    expect(messages()).toContain('Cut Shapes: working…');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(messages()).toContain('Cut Shapes: working…');
    sessions[0]!.resolve({ kind: 'done', result: { kind: 'ok', value: null } });
    await running;
    expect(messages()).not.toContain('Cut Shapes: working…');
  });
});
