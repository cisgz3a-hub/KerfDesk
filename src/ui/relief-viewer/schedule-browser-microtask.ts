/** Schedules browser cleanup without attaching the Web API to a dependency receiver. */
export function scheduleBrowserMicrotask(callback: () => void): void {
  queueMicrotask(callback);
}
