// useViewer3dScene — owns the Inspector's three.js scene lifecycle: create it
// once for the canvas, draw whichever program is current into it, keep the
// renderer sized to the canvas, and dispose completely on unmount (ADR-255
// stage 5 extraction).
//
// The renderer belongs to the CANVAS, not to the program. Keying its creation
// on the model tore down the WebGLRenderer and re-imported/recompiled the
// whole scene on every program change — while the handle already swaps the
// drawn toolpath in place (viewer3d-scene.ts setSegments).

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
  }, [canvasRef]);

  // Draw the current program. `state` is a dependency so the first model lands
  // as soon as the scene is ready, and this runs before useSceneSync's effects
  // (declared after this hook) push the playhead and lens onto the new
  // geometry.
  useEffect(() => {
    if (state !== 'ready') return;
    handleRef.current?.setSegments(model);
    handleRef.current?.fitToBounds(model.stats.motionBounds);
  }, [model, state]);

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
