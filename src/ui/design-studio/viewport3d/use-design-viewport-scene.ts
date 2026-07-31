// use-design-viewport-scene — owns the 3D design space's lifecycle.
//
// The same hardened rules the carve pane's hook learned (and this repo now
// treats as law for WebGL hooks): create ONCE and update in place; teardown
// in a zero-dependency effect so it runs at unmount only; serialize creation
// so content arriving mid-create parks in a pending ref instead of starting a
// second renderer on the same canvas; StrictMode handled by resetting the
// unmounted flag in setup and disposing a handle that resolves after a real
// unmount.

import { useEffect, useRef, useState } from 'react';
import type { ViewerContentInput } from '../../cnc-viewer3d/viewer3d-content';
import {
  createDesignViewportScene,
  type DesignViewportHandle,
  type ViewportFrame,
} from './viewport-scene';

export type DesignViewportState = 'loading' | 'ready' | 'failed';

export type DesignViewportBinding = {
  readonly canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  readonly handleRef: React.MutableRefObject<DesignViewportHandle | null>;
  readonly state: DesignViewportState;
};

export function useDesignViewportScene(
  frame: ViewportFrame,
  carve: ViewerContentInput | null,
): DesignViewportBinding {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<DesignViewportHandle | null>(null);
  const creatingRef = useRef(false);
  const pendingCarveRef = useRef<ViewerContentInput | null>(null);
  const unmountedRef = useRef(false);
  const [state, setState] = useState<DesignViewportState>('loading');

  // Zero deps: unmount only; setup resets the flag for StrictMode's
  // setup → cleanup → setup cycle on the same refs.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || carve === null) return;

    const existing = handleRef.current;
    if (existing !== null) {
      void existing.updateCarve(carve).catch(() => {
        if (!unmountedRef.current) setState('failed');
      });
      return;
    }
    if (creatingRef.current) {
      pendingCarveRef.current = carve;
      return;
    }

    creatingRef.current = true;
    setState('loading');
    void createDesignViewportScene(canvas, frame)
      .then(async (outcome) => {
        creatingRef.current = false;
        if (unmountedRef.current) {
          if (outcome.kind === 'ok') outcome.handle.dispose();
          return;
        }
        if (outcome.kind !== 'ok') {
          setState('failed');
          return;
        }
        handleRef.current = outcome.handle;
        outcome.handle.resize(canvas.clientWidth, canvas.clientHeight);
        const latest = pendingCarveRef.current ?? carve;
        pendingCarveRef.current = null;
        await outcome.handle.updateCarve(latest).catch(() => {
          if (!unmountedRef.current) setState('failed');
        });
        setState('ready');
      })
      .catch(() => {
        creatingRef.current = false;
        if (!unmountedRef.current) setState('failed');
      });
  }, [carve, frame]);

  // Renders on demand; keeping the buffer in step with layout costs nothing
  // while idle.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      handleRef.current?.resize(canvas.clientWidth, canvas.clientHeight);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return { canvasRef, handleRef, state };
}
