import { browserLocalStorage } from '../state/browser-local-storage';

const WORKSPACE_WAIT_MS = 5000;
const MINIMUM_VISIBLE_MS = 4000;
const FADE_MS = 750;
/** The app version whose first launch on this device has held the splash. */
export const SPLASH_HELD_VERSION_KEY = 'kerfdesk-startup-splash-held-version-v1';

/**
 * How long this launch holds the splash (ADR-049 Amendment 3): the full hold
 * for a version this device has not shown yet, a fresh install or an update,
 * and none on every other launch. Without working storage no launch can be
 * told from the first, and a hold on every one is the cost, so none holds.
 */
function versionHoldMs(): number {
  try {
    const storage = browserLocalStorage();
    if (storage === null) return 0;
    const held = storage.getItem(SPLASH_HELD_VERSION_KEY);
    if (held === __APP_VERSION__) return 0;
    // A store that reads but cannot write would hold on every launch. Prove
    // the write now; the version itself is recorded once the hold is served.
    storage.setItem(SPLASH_HELD_VERSION_KEY, held ?? '');
    return MINIMUM_VISIBLE_MS;
  } catch {
    return 0;
  }
}

function rememberVersionHold(): void {
  try {
    browserLocalStorage()?.setItem(SPLASH_HELD_VERSION_KEY, __APP_VERSION__);
  } catch {
    // The next launch holds once more.
  }
}

function fadeSplash(splash: HTMLElement, releaseInput: () => void): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.remove();
    releaseInput();
    return;
  }
  const remove = (): void => {
    window.clearTimeout(timer);
    splash.removeEventListener('transitionend', onTransitionEnd);
    splash.remove();
    releaseInput();
  };
  const onTransitionEnd = (event: TransitionEvent): void => {
    if (event.target === splash && event.propertyName === 'opacity') remove();
  };
  splash.style.transitionDuration = `${FADE_MS}ms`;
  splash.classList.add('app-splash--hidden');
  splash.addEventListener('transitionend', onTransitionEnd);
  // A missing transition event must never leave the splash mounted forever.
  const timer = window.setTimeout(remove, FADE_MS + 50);
}

/**
 * Reveal a painted workspace: at once on an ordinary launch, and after the
 * splash has actually been visible on the first launch of a version.
 */
export function dismissStartupSplash(options: { readonly desktop?: boolean } = {}): void {
  const splash = document.getElementById('app-splash');
  const root = document.getElementById('app-root');
  const blockKeyboard = (event: KeyboardEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const releaseInput = (): void => {
    root?.removeAttribute('inert');
    window.removeEventListener('keydown', blockKeyboard, true);
  };
  if (splash === null) {
    releaseInput();
    return;
  }
  root?.setAttribute('inert', '');
  window.addEventListener('keydown', blockKeyboard, true);
  const holdMs = versionHoldMs();
  const installedAt = performance.now();
  let visibleMs = 0;
  let visibleSince: number | null = null;
  let started = false;
  let nativeShown = false;
  const isVisible = (now: number): boolean => {
    const documentVisible = document.visibilityState !== 'hidden';
    if (options.desktop !== true) return documentVisible;
    // backgroundThrottling=false keeps Electron's document "visible" while
    // hidden. Main publishes actual BrowserWindow visibility independently.
    const native = document.documentElement.dataset.desktopWindowVisible;
    if (native === 'true') nativeShown = true;
    // A missing publication, or one that never reports the window shown (a
    // reveal or compositor main did not observe), must not hold input forever.
    const unobserved =
      native === undefined || (!nativeShown && now - installedAt >= WORKSPACE_WAIT_MS);
    return unobserved ? documentVisible : native === 'true';
  };
  const recordVisibility = (): void => {
    const now = performance.now();
    if (visibleSince !== null) visibleMs += now - visibleSince;
    visibleSince = isVisible(now) ? now : null;
  };
  const onVisibilityChange = (): void => {
    if (started) recordVisibility();
  };
  const stopWatching = (): void => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('kerfdesk:window-visibility', onVisibilityChange);
  };
  const check = (): void => {
    if (!splash.isConnected) {
      stopWatching();
      releaseInput();
      return;
    }
    // Cold navigation time before installation and time before this first
    // frame contribute nothing. Document-hidden intervals also do not count.
    started = true;
    recordVisibility();
    const crashed = document.querySelector('#app-root > [role="alert"]') !== null;
    const painted =
      document.querySelector('#app-root canvas[data-workspace-painted="true"]') !== null ||
      // A commercial build without a trial or licence opens to its settled
      // licence window instead of a workspace (ADR-623).
      document.querySelector(
        '#app-root [data-licence-state]:not([data-licence-state="checking"])',
      ) !== null;
    const timedOut = performance.now() - installedAt >= WORKSPACE_WAIT_MS;
    const held = (painted || timedOut) && visibleMs >= holdMs;
    if (crashed || held) {
      stopWatching();
      // A crash screen cut the hold short, so this version still owes one.
      if (held && holdMs > 0) rememberVersionHold();
      // Give a newly painted canvas its own paint opportunity before the fade.
      requestAnimationFrame(() => fadeSplash(splash, releaseInput));
      return;
    }
    requestAnimationFrame(check);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (options.desktop) window.addEventListener('kerfdesk:window-visibility', onVisibilityChange);
  requestAnimationFrame(check);
}
