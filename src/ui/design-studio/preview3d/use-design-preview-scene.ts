// use-design-preview-scene — owns the carve preview's three.js lifecycle.
//
// A distilled useCnc3dScene with one extra rule the Studio needs: content can
// change WHILE the first scene create is still awaiting its lazy three chunk
// (open the Studio, draw immediately). Starting a second renderer on the same
// canvas — and then disposing the "orphan" — kills the survivor's GL context,
// which is exactly the wedge live verification caught. So creation is
// serialized: at most one create ever runs, later content parks in pendingRef
// and is applied the moment the handle exists.
//
// The other shipped rules still hold: create once / update in place, teardown
// in a zero-dependency effect so it runs at unmount only, StrictMode handled
// by resetting the unmounted flag in setup and disposing a handle that
// resolves after a real unmount.
//
// This module imports the scene BUILDER from relief-viewer, never `three` —
// the ADR-102 §2 route ADR-271 Amendment 1 clause 3 records.

import { useEffect, useRef, useState } from 'react';
import type { ViewerContentInput } from '../../cnc-viewer3d/viewer3d-content';
import {
  createReliefThreeScene,
  type ReliefSceneHandle,
} from '../../relief-viewer/relief-three-scene';

export type DesignPreviewSceneState = 'loading' | 'ready' | 'failed';

export type DesignPreviewScene = {
  readonly canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  readonly state: DesignPreviewSceneState;
};

export function useDesignPreviewScene(content: ViewerContentInput | null): DesignPreviewScene {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<ReliefSceneHandle | null>(null);
  const creatingRef = useRef(false);
  const pendingRef = useRef<ViewerContentInput | null>(null);
  const unmountedRef = useRef(false);
  const [state, setState] = useState<DesignPreviewSceneState>('loading');

  // Zero deps: teardown at unmount only. The setup RESETS the flag because
  // StrictMode runs setup → cleanup → setup on the same refs.
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
    if (canvas === null || content === null) return;

    const existing = handleRef.current;
    if (existing !== null) {
      void existing.updateContent(content).catch(() => {
        if (!unmountedRef.current) setState('failed');
      });
      return;
    }

    // A create is already in flight: park the newest content for it. Never
    // start a second renderer on this canvas.
    if (creatingRef.current) {
      pendingRef.current = content;
      return;
    }

    creatingRef.current = true;
    setState('loading');
    void createReliefThreeScene(canvas, content.mesh, content.stockThicknessMm)
      .then((outcome) => {
        creatingRef.current = false;
        if (unmountedRef.current) {
          // Resolved after a real unmount — free the orphan or it leaks a
          // live WebGL context.
          if (outcome.kind === 'ok') outcome.handle.dispose();
          return;
        }
        if (outcome.kind !== 'ok') {
          setState('failed');
          return;
        }
        handleRef.current = outcome.handle;
        // Fit to the laid-out size, not mount-time attrs — the pane resizes.
        outcome.handle.resize(canvas.clientWidth, canvas.clientHeight);
        const latest = pendingRef.current ?? content;
        pendingRef.current = null;
        void outcome.handle.updateContent(latest).catch(() => {
          if (!unmountedRef.current) setState('failed');
        });
        setState('ready');
      })
      .catch(() => {
        creatingRef.current = false;
        if (!unmountedRef.current) setState('failed');
      });
  }, [content]);

  // Renders on demand, so keeping the buffer in step with the resizable pane
  // costs nothing while idle.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      handleRef.current?.resize(canvas.clientWidth, canvas.clientHeight);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return { canvasRef, state };
}
