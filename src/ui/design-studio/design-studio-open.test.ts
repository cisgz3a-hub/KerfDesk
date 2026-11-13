// ADR-272 Amendment 9: the boot workspace reaches the Studio only through the
// shell. Before the first Open there is no session code and nothing to save
// or warn about; the first Open fetches the runtime, which registers the
// session store, and from then on the shell mirrors it.

import { afterEach, expect, it } from 'vitest';
import { openDesignStudio } from './design-studio-open';
import {
  closeDesignStudio,
  designStudioHoldsUnappliedDrawing,
  designStudioRuntime,
  useDesignStudioShell,
} from './design-studio-shell';

afterEach(() => closeDesignStudio());

it('fetches the session code on the first Open and mirrors the session into the shell', async () => {
  // Nothing loaded: Close is a no-op and no drawing can be unapplied.
  expect(designStudioRuntime()).toBeNull();
  closeDesignStudio();
  expect(designStudioHoldsUnappliedDrawing()).toBe(false);

  await openDesignStudio();

  expect(designStudioRuntime()).not.toBeNull();
  const { useDesignStudioStore } = await import('./design-studio-store');
  expect(useDesignStudioStore.getState().session).not.toBeNull();
  expect(useDesignStudioShell.getState()).toMatchObject({
    sessionOpen: true,
    loading: false,
    loadFailure: null,
  });

  // Close stashes through the store's own action; reopening is synchronous now.
  closeDesignStudio();
  expect(useDesignStudioShell.getState().sessionOpen).toBe(false);
  expect(useDesignStudioStore.getState().stash).not.toBeNull();
  expect(openDesignStudio()).toBeUndefined();
  expect(useDesignStudioShell.getState().sessionOpen).toBe(true);
});
