const WORKSPACE_WAIT_MS = 5000;
const MINIMUM_VISIBLE_MS = 4000;
const FADE_MS = 750;

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

/** Reveal a painted workspace after the splash has actually been visible. */
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
  const installedAt = performance.now();
  let visibleMs = 0;
  let visibleSince: number | null = null;
  let started = false;
  const recordVisibility = (): void => {
    const now = performance.now();
    if (visibleSince !== null) visibleMs += now - visibleSince;
    // backgroundThrottling=false keeps Electron's document "visible" while
    // hidden. Main publishes actual BrowserWindow visibility independently.
    const visible = options.desktop
      ? document.documentElement.dataset.desktopWindowVisible === 'true'
      : document.visibilityState !== 'hidden';
    visibleSince = visible ? now : null;
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
      document.querySelector('#app-root canvas[data-workspace-painted="true"]') !== null;
    const timedOut = performance.now() - installedAt >= WORKSPACE_WAIT_MS;
    if (crashed || ((painted || timedOut) && visibleMs >= MINIMUM_VISIBLE_MS)) {
      stopWatching();
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
