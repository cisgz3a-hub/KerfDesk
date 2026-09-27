// Full-window mode for the G-code 3D view (ADR-426), through the browser's
// Fullscreen API. Where the API is missing (some embedded web views, jsdom)
// the control is not offered at all.

import { useCallback, useEffect, useState, type RefObject } from 'react';

export function useFullWindow(target: RefObject<HTMLElement | null>): {
  readonly supported: boolean;
  readonly active: boolean;
  readonly toggle: () => void;
} {
  const supported = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!supported) return;
    const sync = (): void => setActive(document.fullscreenElement === target.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [supported, target]);
  const toggle = useCallback(() => {
    const element = target.current;
    if (element === null) return;
    const request =
      document.fullscreenElement === element
        ? document.exitFullscreen()
        : element.requestFullscreen();
    // A refused request (no user gesture, a policy) leaves the view as it was.
    request.catch(() => undefined);
  }, [target]);
  return { supported, active, toggle };
}
