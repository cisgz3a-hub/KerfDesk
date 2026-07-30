// design-frame-scheduler — coalesces many repaint requests into one animation
// frame (ADR-268, DS-3).
//
// Extracted from the canvas hook because inlining it caused a real, invisible
// bug: the cleanup cancelled the pending frame but left the handle set, so under
// React StrictMode's mount → cleanup → mount cycle the second mount's request()
// saw a non-null handle, returned early, and the canvas NEVER painted again.
// Green tests could not see it; only looking at the pixels could.
//
// The invariant that prevents it is small enough to own a module and a test:
// **cancel() must clear the handle, so a later request() can always schedule.**
// raf/cancel are injected so that invariant is testable without a browser.

export type FrameScheduler = {
  // Schedule a run on the next frame. Repeated calls before that frame are free.
  readonly request: () => void;
  // Drop any pending frame and return to the idle state.
  readonly cancel: () => void;
};

export type FrameSchedulerHost = {
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (handle: number) => void;
};

export function createFrameScheduler(run: () => void, host: FrameSchedulerHost): FrameScheduler {
  let handle: number | null = null;
  return {
    request: () => {
      if (handle !== null) return;
      handle = host.requestFrame(() => {
        handle = null;
        run();
      });
    },
    cancel: () => {
      if (handle === null) return;
      host.cancelFrame(handle);
      handle = null;
    },
  };
}

// Falls back to running synchronously when the document has no window to schedule
// against (jsdom without rAF, a detached document). A missing scheduler must not
// mean a blank canvas.
export function frameSchedulerHostFor(view: Window | null | undefined): FrameSchedulerHost {
  const requestFrame = view?.requestAnimationFrame;
  const cancelFrame = view?.cancelAnimationFrame;
  if (view === null || view === undefined || requestFrame === undefined) {
    return {
      requestFrame: (callback) => {
        callback();
        return 0;
      },
      cancelFrame: () => undefined,
    };
  }
  return {
    requestFrame: (callback) => requestFrame.call(view, callback),
    cancelFrame: (handle) => cancelFrame?.call(view, handle),
  };
}
