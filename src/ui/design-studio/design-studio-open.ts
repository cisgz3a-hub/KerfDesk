// design-studio-open — the Design Studio's Open command, the one boot path
// that fetches the Studio's session code (ADR-272 Amendment 9).
//
// Kept apart from design-studio-shell.ts on purpose: the session store imports
// the shell to register itself, so the shell must not import (even lazily) the
// runtime chunk that holds the store.

import { LazyLoadError } from '../common/lazy-load-failure';
import {
  designStudioRuntime,
  useDesignStudioShell,
  type DesignStudioRuntime,
} from './design-studio-shell';

let loading: Promise<DesignStudioRuntime | null> | null = null;

/**
 * Opens the Studio. Synchronous once the Studio code is loaded, exactly as the
 * session store's own openStudio; the first Open waits for that code. A fetch
 * that fails (a window left on the previous build) shows the Studio's
 * load-failure notice instead, and a later Open asks again.
 */
export function openDesignStudio(): void | Promise<void> {
  const runtime = designStudioRuntime();
  if (runtime !== null) return runtime.openStudio();
  return loadDesignStudioRuntime().then((loaded) => {
    // Opened before the loading card goes, so the host never blinks empty
    // when the session is ready at once.
    try {
      return loaded?.openStudio();
    } finally {
      useDesignStudioShell.setState({ loading: false });
    }
  });
}

function loadDesignStudioRuntime(): Promise<DesignStudioRuntime | null> {
  if (loading !== null) return loading;
  useDesignStudioShell.setState({ loading: true, loadFailure: null });
  loading = import('./design-studio-runtime').then(
    () => {
      loading = null;
      // The runtime's store registered itself as its module loaded.
      return designStudioRuntime();
    },
    (cause: unknown) => {
      loading = null;
      useDesignStudioShell.setState({ loading: false, loadFailure: new LazyLoadError(cause) });
      return null;
    },
  );
  return loading;
}
