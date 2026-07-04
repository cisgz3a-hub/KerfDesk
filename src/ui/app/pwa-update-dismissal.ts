// Persisted "Later" dismissal for the PWA update banner (ADR-060 follow-up).
//
// workbox-window (7.4.1) re-fires its `waiting` event on EVERY page load while a
// service worker is stuck in the waiting state (register() dispatches `waiting`
// with wasWaitingBeforeRegister:true). registerType is 'prompt', so a downloaded
// update sits waiting until Reload or a full app close. Without persistence,
// "Later" only clears React state and the banner re-nags on every reload for an
// update the user already deferred. We remember the RUNNING build's version that
// the user dismissed; a strictly-newer service worker clears this marker (see
// PwaUpdatePrompt's `updatefound` handler) so a genuinely-new version still
// surfaces. Browser-local (never in the .lf2 project), mirroring the
// preferred-camera pattern; storage failures degrade to "not dismissed" silently.

const DISMISSED_UPDATE_VERSION_KEY = 'kerfdesk.pwa.dismissedUpdateVersion.v1';

export function loadDismissedUpdateVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY);
  } catch {
    return null;
  }
}

export function saveDismissedUpdateVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, version);
  } catch {
    // Storage unavailable (private mode / quota): the banner reappears next
    // load, which is a safe degradation — the user just sees the prompt again.
  }
}

export function clearDismissedUpdateVersion(): void {
  try {
    localStorage.removeItem(DISMISSED_UPDATE_VERSION_KEY);
  } catch {
    // Best-effort re-arm; if removal fails the worst case is a newer update's
    // banner stays suppressed until the app fully closes and the SW activates.
  }
}
