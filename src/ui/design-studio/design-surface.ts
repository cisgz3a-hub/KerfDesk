// design-surface — what a drawing surface must provide for the gesture state
// machine to run on it (ADR-272 Amendment 2). The 2D canvas and the 3D
// viewport differ ONLY here: how a pointer event becomes sketch millimetres,
// and how big a screen pixel is at the drawing plane (so hit radii and snap
// tolerances keep their on-screen size from any camera).

import { useMemo } from 'react';
import type { Vec2 } from '../../core/scene';
import { useDesignStudioStore } from './design-studio-store';
import { pxToMm } from './design-view';

export type DesignSurface = {
  // Raw pointer position → sketch mm, or null when the surface cannot map it
  // yet (no measured view, or a ray that misses the drawing plane).
  readonly toMm: (event: React.PointerEvent<HTMLCanvasElement>) => Vec2 | null;
  // Screen pixels per millimetre AT the drawing plane.
  readonly pxPerMm: () => number;
};

/** The flat canvas surface: the classic pan/zoom view transform. */
export function useCanvas2dSurface(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): DesignSurface {
  return useMemo(
    () => ({
      toMm: (event) => {
        const view = useDesignStudioStore.getState().session?.view ?? null;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (view === null || rect === undefined) return null;
        return pxToMm(view, { x: event.clientX - rect.left, y: event.clientY - rect.top });
      },
      pxPerMm: () => useDesignStudioStore.getState().session?.view?.pxPerMm ?? 1,
    }),
    [canvasRef],
  );
}
