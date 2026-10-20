// ADR-634: the Live Motion popup is fixed over the lower centre of the window
// during a job, jog or Frame, and it is drawn above everything. On a short
// window the safety notice reached under it and lost its buttons, "I made the
// machine safe" included. The notice measures the popup the way the toast
// stack does (use-toast-placement) and stops above it.

import { useLayoutEffect, useState, type RefObject } from 'react';
import { liveMotionFloor } from '../common/use-toast-placement';

const GAP = 12;
// Keeps the title and a scroll bar usable when hardly any canvas is left above
// the popup.
const MINIMUM_ROOM = 96;

/** Height in px between the element's top and the Live Motion popup, or null
 * while the popup is closed. */
export function useLiveMotionRoom(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): number | null {
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!active) {
      setRoom(null);
      return undefined;
    }
    let scheduled: number | undefined;
    let backstop: number | undefined;

    function clearScheduled(): void {
      if (scheduled !== undefined) window.cancelAnimationFrame(scheduled);
      if (backstop !== undefined) window.clearTimeout(backstop);
      scheduled = undefined;
      backstop = undefined;
    }

    function sync(): void {
      clearScheduled();
      const floor = liveMotionFloor(GAP);
      const element = ref.current;
      if (floor === null || element === null) {
        setRoom(null);
        return;
      }
      const top = element.getBoundingClientRect().top;
      setRoom(Math.max(MINIMUM_ROOM, Math.floor(window.innerHeight - floor - top)));
    }

    function schedule(): void {
      scheduled ??= window.requestAnimationFrame(sync);
      // A tab that is not painting never runs rAF (see use-toast-placement).
      backstop ??= window.setTimeout(sync, 250);
    }

    // The popup mounts and unmounts as jobs, jogs and Frames start and end.
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    sync();
    return (): void => {
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      clearScheduled();
    };
  }, [active, ref]);
  return room;
}
