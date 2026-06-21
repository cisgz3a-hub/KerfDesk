import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { installUnsavedChangesGuard, shouldWarnBeforeUnload } from './use-unsaved-changes-guard';

describe('shouldWarnBeforeUnload', () => {
  it('warns only when there are unsaved changes and no job is running', () => {
    expect(shouldWarnBeforeUnload({ dirty: true, jobActive: false })).toBe(true);
    // Mid-job: useUnloadStop owns the unload (laser-off). A prompt here would
    // strand a stopped job if the user chose "Stay", so it must stay silent.
    expect(shouldWarnBeforeUnload({ dirty: true, jobActive: true })).toBe(false);
    expect(shouldWarnBeforeUnload({ dirty: false, jobActive: false })).toBe(false);
    expect(shouldWarnBeforeUnload({ dirty: false, jobActive: true })).toBe(false);
  });
});

describe('installUnsavedChangesGuard', () => {
  afterEach(() => {
    useStore.setState({ dirty: false });
  });

  function fakeWindow(): {
    readonly target: Window;
    readonly fire: (e: BeforeUnloadEvent) => void;
  } {
    let handler: ((e: BeforeUnloadEvent) => void) | null = null;
    const target = {
      addEventListener: (_type: string, h: (e: BeforeUnloadEvent) => void) => {
        handler = h;
      },
      removeEventListener: () => {
        handler = null;
      },
    } as unknown as Window;
    return { target, fire: (e) => handler?.(e) };
  }

  function fakeEvent(): BeforeUnloadEvent {
    return { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
  }

  it('blocks unload when the scene is dirty and no job is active', () => {
    useStore.setState({ dirty: true });
    const { target, fire } = fakeWindow();
    const cleanup = installUnsavedChangesGuard(target);
    const event = fakeEvent();

    fire(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe('');
    cleanup();
  });

  it('does not block unload when there are no unsaved changes', () => {
    useStore.setState({ dirty: false });
    const { target, fire } = fakeWindow();
    const cleanup = installUnsavedChangesGuard(target);
    const event = fakeEvent();

    fire(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    cleanup();
  });

  it('removes its listener on cleanup', () => {
    useStore.setState({ dirty: true });
    const { target, fire } = fakeWindow();
    const cleanup = installUnsavedChangesGuard(target);

    cleanup();
    const event = fakeEvent();
    fire(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
