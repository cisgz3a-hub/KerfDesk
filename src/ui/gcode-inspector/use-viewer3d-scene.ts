// useViewer3dScene — owns the Inspector's three.js scene lifecycle: create it
// for the current render model, keep the renderer sized to the canvas, and
// dispose completely on unmount or model change (ADR-255 stage 5 extraction).

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { GcodeRenderModel } from '../../core/gcode-view';
import { createViewer3dScene, type Viewer3dSceneHandle } from '../viewer3d';

export type Viewer3dSceneState = 'loading' | 'ready' | 'no-webgl';

export type Viewer3dSceneBinding = {
  readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
  readonly state: Viewer3dSceneState;
  /** Populated only in the 'no-webgl' state. */
  readonly reason: string;
};

export function useViewer3dScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  model: GcodeRenderModel,
): Viewer3dSceneBinding {
  const handleRef = useRef<Viewer3dSceneHandle | null>(null);
  const [state, setState] = useState<Viewer3dSceneState>('loading');
  const [reason, setReason] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let cancelled = false;
    setState('loading');
    void createViewer3dScene(canvas)
      .then((outcome) => {
        if (cancelled) {
          if (outcome.kind === 'ok') outcome.handle.dispose();
          return;
        }
        if (outcome.kind !== 'ok') {
          setReason(outcome.reason);
          setState('no-webgl');
          return;
        }
        handleRef.current = outcome.handle;
        outcome.handle.setSegments(model);
        outcome.handle.fitToBounds(model.stats.motionBounds);
        outcome.handle.resize(canvas.clientWidth, canvas.clientHeight);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReason(err instanceof Error ? err.message : String(err));
        setState('no-webgl');
      });
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [canvasRef, model]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      handleRef.current?.resize(canvas.clientWidth, canvas.clientHeight);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);

  return { handleRef, state, reason };
}
