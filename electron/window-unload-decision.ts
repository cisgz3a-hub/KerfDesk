export type WindowUnloadDecision = 'leave' | 'stay';

interface WindowUnloadEvent {
  preventDefault(): void;
}

interface WindowUnloadTarget {
  readonly webContents: {
    on(event: 'will-prevent-unload', listener: (event: WindowUnloadEvent) => void): unknown;
  };
}

/**
 * Surfaces the renderer's existing beforeunload request in Electron.
 * Electron reverses the usual preventDefault meaning for this event: calling
 * it here explicitly ignores the renderer cancellation and permits unload.
 */
export function installWindowUnloadDecision(
  window: WindowUnloadTarget,
  decide: () => WindowUnloadDecision,
): void {
  window.webContents.on('will-prevent-unload', (event) => {
    if (decide() === 'leave') event.preventDefault();
  });
}
