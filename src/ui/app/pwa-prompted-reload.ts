// Makes the update banner's Reload click always end in a real page reload
// (ADR-060: "The update applies on the user's Reload").
//
// vite-plugin-pwa's own prompt flow reloads only when workbox-window fires
// `controlling` with `isUpdate: true` — which requires the page to have been
// service-worker-controlled when it registered. A page loaded WITHOUT a
// controller (hard reload, first visit after clearing site data, DevTools
// "Bypass for network") never gets that event; worse, with no controlled
// clients a freshly installed worker skips the waiting phase and activates
// silently, so by the time the user clicks, `registration.waiting` is empty
// and the plugin's SKIP_WAITING message is a silent no-op. Verified live
// 2026-07-17: the banner sat unactionable and the button did nothing.
//
// The reload is USER-CLICKED — ADR-060 forbids only unprompted reloads.

/** How long to wait for the skip-waited worker to activate before reloading
 * anyway (a worker missing the SKIP_WAITING handler would otherwise dead-end
 * the click). Normal activation lands well under this. */
const ACTIVATION_FALLBACK_MS = 2000;

export interface PromptedReloadHooks {
  /** navigator.serviceWorker.getRegistration(), or undefined when unsupported. */
  readonly getRegistration: () => Promise<ServiceWorkerRegistration | undefined>;
  /** Posts SKIP_WAITING to the waiting worker (the plugin's updateServiceWorker). */
  readonly requestSkipWaiting: () => Promise<void>;
  /** window.location.reload, injected for testability. */
  readonly reload: () => void;
}

/**
 * Applies the update behind the banner's Reload click and guarantees exactly
 * one page reload in every service-worker state: a waiting worker is
 * skip-waited and the reload happens once it leaves `installed` (statechange
 * fires on uncontrolled pages too, unlike the plugin's `controlling` path);
 * with nothing waiting — stale banner, unsupported or failed lookup — the
 * page plain-reloads, which lands on the newest deploy and clears the banner.
 */
export async function applyPromptedReload(hooks: PromptedReloadHooks): Promise<void> {
  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await hooks.getRegistration();
  } catch {
    registration = undefined;
  }
  const waiting = registration?.waiting ?? null;
  if (waiting === null) {
    hooks.reload();
    return;
  }
  let hasReloaded = false;
  const reloadOnce = (): void => {
    if (hasReloaded) return;
    hasReloaded = true;
    hooks.reload();
  };
  waiting.addEventListener('statechange', () => {
    // `activated`: the swap completed — the reload is now served by the new
    // worker. `redundant`: an even newer worker replaced this one mid-click;
    // reload and let the fresh page surface whatever is current.
    if (waiting.state === 'activated' || waiting.state === 'redundant') reloadOnce();
  });
  window.setTimeout(reloadOnce, ACTIVATION_FALLBACK_MS);
  await hooks.requestSkipWaiting();
}
