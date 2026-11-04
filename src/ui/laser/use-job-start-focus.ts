import { useEffect, type RefObject } from 'react';

/**
 * Start job is disabled once pressed, and Job Review closes on it, so focus
 * fell to the page and a screen reader lost its place (UX audit U7-P3-1). When
 * a job's Live Motion bar appears with focus nowhere, focus its primary action
 * (Pause). Focus anywhere else is left alone.
 */
export function useJobStartFocus(bar: RefObject<HTMLElement>, job: boolean): void {
  useEffect(() => {
    if (!job) return undefined;
    const focusPrimary = (): void => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      bar.current?.querySelector<HTMLButtonElement>('[role="group"] button')?.focus();
    };
    focusPrimary();
    // Job Review can close just after the bar mounts.
    const frame = requestAnimationFrame(focusPrimary);
    return () => cancelAnimationFrame(frame);
  }, [bar, job]);
}
