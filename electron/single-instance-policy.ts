export interface PrimaryWindowTarget {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/** Bring the one process-owned application window forward for a second launch. */
export function revealPrimaryWindow(window: PrimaryWindowTarget): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
