interface WindowReadinessTarget {
  once(event: 'ready-to-show', listener: () => void): unknown;
  show(): void;
}

/**
 * Registers the one-shot visibility transition for an initially hidden window.
 * Call this before renderer loading begins because `ready-to-show` can precede
 * `did-finish-load` during fast packaged startup.
 */
export function installWindowReadinessPolicy(window: WindowReadinessTarget): void {
  window.once('ready-to-show', () => window.show());
}
