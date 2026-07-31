// use-design-preview-scene — owns the carve preview's three.js lifecycle.
//
// A distilled useCnc3dScene: the scene is created ONCE and updated in place;
// teardown lives in a zero-dependency effect so it runs at unmount only
// (sharing an effect with updates is what used to snap the operator's orbit);
// the StrictMode double-mount is handled by the cancelled flag AND by
// disposing the orphaned first handle, or a live WebGL context leaks.
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
  const [state, setState] = useState<DesignPreviewSceneState>('loading');

  // Zero deps: unmount only. See the module header.
  useEffect(() => {
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || content === null) return;
    let cancelled = false;

    const existing = handleRef.current;
    if (existing !== null) {
      void existing.updateContent(content).catch(() => {
        if (!cancelled) setState('failed');
      });
      return () => {
        cancelled = true;
      };
    }

    setState('loading');
    void createReliefThreeScene(canvas, content.mesh, content.stockThicknessMm)
      .then((outcome) => {
        if (cancelled) {
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
        // The builder took only the mesh; hand it the full content so material
        // shading arrives with the first paint rather than the first edit.
        void outcome.handle.updateContent(content).catch(() => setState('failed'));
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('failed');
      });

    return () => {
      cancelled = true;
    };
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
