/**
 * T2-52: centralized active-profile external store with React's official
 * `useSyncExternalStore` primitive.
 *
 * Pre-T2-52 the codebase had two coexisting profile-sync mechanisms:
 *
 *   (1) `ConnectionPanel.tsx`: a React-state shim that combined
 *       `getActiveProfile()` polling on a 1-second interval +
 *       `window.addEventListener('storage', ...)` for cross-tab updates +
 *       `window.addEventListener('laserforge:active-profile-changed',
 *       ...)` for in-app updates. The interval was a tell that the
 *       events didn't reliably fire on every mutation path.
 *
 *   (2) `App.tsx`: a `profileRevision` counter that consumers' useMemos
 *       keyed off. Worked but required every mutator to remember to
 *       bump the counter, with the same custom-event fallback for
 *       cross-component notification.
 *
 * Both mechanisms had drift hazards (the polling interval was a band-aid
 * for missed event dispatches in third mechanism) and added per-consumer
 * boilerplate.
 *
 * Post-T2-52: a single external store implementing the
 * `useSyncExternalStore` contract. Consumers migrate one at a time —
 * `useActiveProfile()` returns the current snapshot; React handles
 * re-render scheduling. The store listens to BOTH the existing custom
 * event (`laserforge:active-profile-changed`) AND the storage event
 * (cross-tab) so legacy mutators that dispatch the custom event
 * continue to drive the store without modification. Future migrations
 * can replace `setActiveProfileId(id); window.dispatchEvent(...)` with
 * `activeProfileStore.setActiveProfile(profile)` for a single-write-path
 * shape.
 *
 * The store does NOT yet replace the existing `profileRevision` /
 * polling consumers — that's per-component migration work filed as
 * T2-52-followup. Shipping the store + hook + tests is the minimum-
 * viable foundation; consumers gain `useSyncExternalStore`-driven
 * reactivity without each one reinventing the listener wiring.
 */
import { useSyncExternalStore } from 'react';
import {
  type DeviceProfile,
  getActiveProfile,
  setActiveProfileId as legacySetActiveProfileId,
} from './DeviceProfile';

const ACTIVE_PROFILE_CHANGED_EVENT = 'laserforge:active-profile-changed';
const ACTIVE_PROFILE_STORAGE_KEY = 'laserforge_active_profile';

type Listener = () => void;

/**
 * External store wrapping the active-profile state. Singleton — one
 * instance per renderer process (export `activeProfileStore` below).
 *
 * Stable function-references for `subscribe` and `getSnapshot` are
 * required by `useSyncExternalStore`'s contract — passing different
 * function identities across renders triggers React's tearing-detection
 * warnings. Class methods bound via property syntax (`subscribe = () =>
 * {...}`) keep the references stable across instances.
 */
export class ActiveProfileStore {
  private _listeners = new Set<Listener>();
  private _snapshot: DeviceProfile | null = null;
  private _initialized = false;

  /**
   * Bind window listeners on first call. Calling the constructor in a
   * non-DOM environment (e.g. test bootstrap before localStorage is
   * mocked) would throw or produce a half-initialized store; lazy init
   * defers the side effect to the first `subscribe` or `getSnapshot`
   * call when the runtime is ready.
   */
  private _ensureInitialized(): void {
    if (this._initialized) return;
    this._initialized = true;
    this._snapshot = getActiveProfile();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', this._onStorage);
      window.addEventListener(ACTIVE_PROFILE_CHANGED_EVENT, this._onCustomEvent);
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this._ensureInitialized();
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getSnapshot = (): DeviceProfile | null => {
    this._ensureInitialized();
    return this._snapshot;
  };

  /**
   * In-app mutator. Updates the storage layer via the existing
   * `setActiveProfileId`, refreshes the snapshot, and notifies
   * subscribers. Future migrations of mutators (currently scattered
   * across `ConnectionPanel.tsx` and `FalconWiFiConnectBlock.tsx`)
   * route through this method instead of dispatching the custom event
   * directly. For back-compat, the legacy custom event is still
   * dispatched here so any component still listening for it continues
   * to function during the migration.
   */
  setActiveProfile(profile: DeviceProfile | null): void {
    legacySetActiveProfileId(profile?.id ?? null);
    // Re-read the cached profile object so `_snapshot` matches what
    // `getActiveProfile()` returns. Without this, the custom event
    // dispatched below triggers `_onCustomEvent` → `refresh`, which
    // compares `_snapshot` against `getActiveProfile()` — if the
    // caller passed a profile reference that differs from the cache's
    // canonical instance, identity mismatches and `refresh` fires a
    // second `_notifyAll`, double-notifying every subscriber.
    this._snapshot = getActiveProfile();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(ACTIVE_PROFILE_CHANGED_EVENT));
    }
    this._notifyAll();
  }

  /**
   * Re-read from storage and notify subscribers. Useful when a mutator
   * outside this store updated the underlying profile fields (e.g.
   * `saveDeviceProfile` mutating the active profile in-place via
   * the existing global cache). Cheap to call — no-op if the snapshot
   * identity is unchanged.
   */
  refresh(): void {
    this._ensureInitialized();
    const next = getActiveProfile();
    if (next !== this._snapshot) {
      this._snapshot = next;
      this._notifyAll();
    }
  }

  /** Test-only: tear down listeners. Production code never calls this. */
  destroyForTests(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('storage', this._onStorage);
      window.removeEventListener(ACTIVE_PROFILE_CHANGED_EVENT, this._onCustomEvent);
    }
    this._listeners.clear();
    this._snapshot = null;
    this._initialized = false;
  }

  private _onStorage = (e: StorageEvent): void => {
    if (e.key === ACTIVE_PROFILE_STORAGE_KEY) {
      this.refresh();
    }
  };

  private _onCustomEvent = (): void => {
    this.refresh();
  };

  private _notifyAll(): void {
    for (const l of this._listeners) {
      try {
        l();
      } catch (err) {
        console.warn('[T2-52] active-profile listener threw', err);
      }
    }
  }
}

export const activeProfileStore = new ActiveProfileStore();

/**
 * React hook returning the current active profile, re-rendering on
 * every change. Replaces ad-hoc `useState + addEventListener +
 * setInterval` patterns scattered across the UI.
 *
 * Migration target. Currently `App.tsx`'s `profileRevision` counter
 * and `ConnectionPanel.tsx`'s polling-shim continue to work — each
 * dispatches the same custom event that this hook subscribes to.
 * Replacing those consumers with `useActiveProfile()` is per-component
 * cleanup filed as T2-52-followup.
 */
export function useActiveProfile(): DeviceProfile | null {
  return useSyncExternalStore(
    activeProfileStore.subscribe,
    activeProfileStore.getSnapshot,
    activeProfileStore.getSnapshot,
  );
}
