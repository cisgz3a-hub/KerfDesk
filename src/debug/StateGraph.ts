import { transitionLog, type TransitionLog } from './TransitionLog';

export interface DebugStateStore<T = unknown> {
  getSnapshot: () => T;
}

export type DebugStateStores = Record<string, DebugStateStore>;

export interface DebugStateGraphOptions {
  target?: Record<string, unknown>;
  dev?: boolean;
  transitions?: TransitionLog;
}

declare global {
  interface Window {
    __LASERFORGE_STATE__?: Record<string, unknown>;
  }
}

function defaultTarget(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as Record<string, unknown>;
}

function defaultDevMode(): boolean {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    return false;
  }
  return true;
}

/**
 * T3-68: install a live, getter-backed debug state graph for the dev console.
 * The getter reads store snapshots on demand so `window.__LASERFORGE_STATE__`
 * reflects current state without forcing React re-renders.
 */
export function installDebugStateGraph(
  stores: DebugStateStores,
  options: DebugStateGraphOptions = {},
): boolean {
  const isDev = options.dev ?? defaultDevMode();
  if (!isDev) return false;

  const target = options.target ?? defaultTarget();
  if (!target) return false;
  const transitions = options.transitions ?? transitionLog;

  Object.defineProperty(target, '__LASERFORGE_STATE__', {
    configurable: true,
    enumerable: false,
    get() {
      const snapshot: Record<string, unknown> = {};
      for (const [name, store] of Object.entries(stores)) {
        snapshot[name] = store.getSnapshot();
      }
      snapshot.transitions = transitions.getSnapshot();
      return snapshot;
    },
  });

  return true;
}
