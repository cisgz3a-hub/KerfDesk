import React, { useEffect } from 'react';

export interface CanvasRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  cursor: string;
  renderFrame: () => void;
  onMouseDown: React.MouseEventHandler<HTMLCanvasElement>;
  onMouseMove: React.MouseEventHandler<HTMLCanvasElement>;
  onMouseUp: React.MouseEventHandler<HTMLCanvasElement>;
  onMouseLeave: React.MouseEventHandler<HTMLCanvasElement>;
  onDoubleClick: React.MouseEventHandler<HTMLCanvasElement>;
  onContextMenu: React.MouseEventHandler<HTMLCanvasElement>;
}

/**
 * Owns the canvas element and schedules full-frame paints when `renderFrame` changes.
 * Interaction handlers stay on the canvas so hit-testing uses the same ref as the viewport.
 */
export function CanvasRenderer({
  canvasRef,
  width,
  height,
  cursor,
  renderFrame,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onDoubleClick,
  onContextMenu,
}: CanvasRendererProps) {
  useEffect(() => {
    renderFrame();
  }, [renderFrame]);

  useEffect(() => {
    const repaint = () => {
      renderFrame();
    };
    window.addEventListener('laserforge-canvas-repaint', repaint);
    return () => window.removeEventListener('laserforge-canvas-repaint', repaint);
  }, [renderFrame]);

  return React.createElement('canvas', {
    ref: canvasRef,
    width,
    height,
    style: {
      display: 'block',
      cursor,
    },
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    onDoubleClick,
    onContextMenu,
  });
}
