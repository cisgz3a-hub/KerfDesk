import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { reportLinkMachineWork, resetLinkMachineWorkForTests } from '../state/link-machine-work';
import { installUnsavedChangesGuard, shouldWarnBeforeUnload } from './use-unsaved-changes-guard';
import { useDesignStudioStore } from '../design-studio/design-studio-store';
import {
  createDesignSession,
  markSessionApplied,
  withSketch,
} from '../design-studio/design-session';

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

  // Code quality audit C2 D4-P2-3: the unload stop has already stopped a link
  // job, so a Leave site? prompt would let Stay keep a stopped job.
  it('does not prompt while a Moshi, K40 or Ruida link job runs', () => {
    useStore.setState({ dirty: true });
    reportLinkMachineWork('moshi-usb', {
      controller: 'Moshiboard',
      activity: 'running',
      advisories: [],
      abort: async () => undefined,
    });
    const { target, fire } = fakeWindow();
    const cleanup = installUnsavedChangesGuard(target);
    const event = fakeEvent();
    try {
      fire(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    } finally {
      cleanup();
      resetLinkMachineWorkForTests();
    }
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

  // ADR-590 Amendment 1: a Design Studio drawing not yet applied is unsaved work.
  it('blocks unload when only the Design Studio holds a drawing not yet applied', () => {
    useStore.setState({ dirty: false });
    const epoch = useStore.getState().projectDocumentEpoch;
    const drawing = withSketch(createDesignSession(), {
      entities: [{ id: 'line', kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
    });
    useDesignStudioStore.setState({ documentEpoch: epoch, session: null, stash: drawing });
    const { target, fire } = fakeWindow();
    const cleanup = installUnsavedChangesGuard(target);
    try {
      const event = fakeEvent();
      fire(event);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      useDesignStudioStore.setState({ stash: markSessionApplied(drawing, null) });
      const applied = fakeEvent();
      fire(applied);
      expect(applied.preventDefault).not.toHaveBeenCalled();
    } finally {
      cleanup();
      useDesignStudioStore.setState({ documentEpoch: -1, session: null, stash: null });
    }
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
