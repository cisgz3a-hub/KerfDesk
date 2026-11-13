// design-studio-shell — the boot-side face of the Design Studio (ADR-272
// Amendment 9, performance audit S9-P3-2).
//
// The workspace needs very little of the Studio before it is opened: whether a
// session is showing, a way to close it, and whether a closed drawing still
// holds unapplied work for the unsaved-changes prompt. Everything else — the
// session store with its tools, snapping, typed entry, dimensions, trim and
// layers, and the recovery-draft persistence — lives in the lazy runtime chunk
// (design-studio-runtime.ts), which design-studio-open.ts fetches on the first
// Open. Nothing here may import the session store or core/design: this module
// is in every first download.
//
// The session store registers itself here as its module loads and mirrors
// "is a session open" into the small store below, so boot components can
// subscribe without importing it.

import { create } from 'zustand';
import type { LazyLoadError } from '../common/lazy-load-failure';

/** What the loaded session store offers the boot side. */
export type DesignStudioRuntime = {
  readonly openStudio: () => void | Promise<void>;
  readonly closeStudio: () => void;
  readonly holdsUnappliedDrawing: () => boolean;
};

export type DesignStudioShellState = {
  /** True while a Studio session is on screen (the session store's `session !== null`). */
  readonly sessionOpen: boolean;
  /** True while the first Open fetches the Studio code. */
  readonly loading: boolean;
  /** Why the Studio code could not be fetched; cleared by Close. */
  readonly loadFailure: LazyLoadError | null;
};

export const useDesignStudioShell = create<DesignStudioShellState>(() => ({
  sessionOpen: false,
  loading: false,
  loadFailure: null,
}));

let runtime: DesignStudioRuntime | null = null;

/** Called once by the session store's module as it loads. */
export function registerDesignStudioRuntime(next: DesignStudioRuntime): void {
  runtime = next;
}

/** The loaded session store, or null before the first Open fetched it. */
export function designStudioRuntime(): DesignStudioRuntime | null {
  return runtime;
}

/** The session store reports every open and close here. */
export function setDesignStudioSessionOpen(sessionOpen: boolean): void {
  if (useDesignStudioShell.getState().sessionOpen !== sessionOpen)
    useDesignStudioShell.setState({ sessionOpen });
}

/** Closes (stashes) the Studio, and dismisses a load-failure notice. */
export function closeDesignStudio(): void {
  if (useDesignStudioShell.getState().loadFailure !== null)
    useDesignStudioShell.setState({ loadFailure: null });
  runtime?.closeStudio();
}

/** True while the Studio, open or closed, holds shapes drawn since the last
 *  Apply for the current project. Never true before the Studio first loads:
 *  until then there is no drawing. */
export function designStudioHoldsUnappliedDrawing(): boolean {
  return runtime?.holdsUnappliedDrawing() ?? false;
}
