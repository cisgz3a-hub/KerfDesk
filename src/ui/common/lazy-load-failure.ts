// A lazily loaded tool whose code could not be fetched. The service worker is
// shared by every KerfDesk window, so an Update applied in one window leaves
// the others on the previous build, and the hashed chunk they point at can be
// gone from the server and from the new worker's precache. The tool's import()
// then rejects, and React.lazy keeps that rejection for the rest of the page's
// life, so asking again cannot help until the window reloads.
//
// Each lazy overlay tags that rejection at its import, so the overlay's
// boundary (LazyOverlayBoundary) can tell "the tool's code never arrived" from
// a bug inside the tool, which still belongs on the root crash screen.

import { APP_DISPLAY_NAME } from '../../core/app-branding';

/**
 * What the operator can do about it. Never a reload of our own: ADR-060 forbids
 * unprompted reloads, and one during a job aborts the burn (use-unload-stop).
 */
export const LAZY_LOAD_FAILURE_ADVICE =
  `${APP_DISPLAY_NAME} was most likely updated in another window. ` +
  'Use Update in the status bar, or reload the page when no job is running.';

/** A lazy import that failed; the original failure is kept as `cause`. */
export class LazyLoadError extends Error {
  constructor(cause: unknown) {
    super(`Could not load part of ${APP_DISPLAY_NAME}.`, { cause });
    this.name = 'LazyLoadError';
  }
}

/** Use as `import('./Tool').catch(rejectAsLoadFailure)` inside React.lazy. */
export function rejectAsLoadFailure(cause: unknown): never {
  throw new LazyLoadError(cause);
}

export function isLazyLoadError(error: unknown): error is LazyLoadError {
  return error instanceof LazyLoadError;
}
