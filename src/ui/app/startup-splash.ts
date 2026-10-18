const WORKSPACE_WAIT_MS = 5000;
const MINIMUM_VISIBLE_MS = 4000;
const FADE_MS = 750;

function fadeSplash(splash: HTMLElement): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.remove();
    return;
  }
  const remove = (): void => {
    window.clearTimeout(timer);
    splash.removeEventListener('transitionend', onTransitionEnd);
    splash.remove();
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
export function dismissStartupSplash(): void {
  const splash = document.getElementById('app-splash');
  if (splash === null) return;
  const installedAt = performance.now();
  let visibleMs = 0;
  let visibleSince: number | null = null;
  let started = false;
  const recordVisibility = (): void => {
    const now = performance.now();
    if (visibleSince !== null) visibleMs += now - visibleSince;
    visibleSince = document.visibilityState === 'hidden' ? null : now;
  };
  const onVisibilityChange = (): void => {
    if (started) recordVisibility();
  };
  const stopWatching = (): void => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
  const check = (): void => {
    if (!splash.isConnected) {
      stopWatching();
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
      requestAnimationFrame(() => fadeSplash(splash));
      return;
    }
    requestAnimationFrame(check);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  requestAnimationFrame(check);
}
