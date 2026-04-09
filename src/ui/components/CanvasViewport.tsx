/**
 * === FILE: /src/ui/components/CanvasViewport.tsx ===
 *
 * Purpose:    Orchestration-only React component. Owns no rendering
 *             logic — delegates to SceneRenderer & SimulationRenderer.
 *             Owns no coordinate math — delegates to Transform.
 *             Only manages: canvas ref, viewport state, mouse events,
 *             playback state, and calls the right renderer at the right time.
 *
 * Dependencies:
 *   - /src/core/scene/Scene.ts
 *   - /src/core/plan/Simulation.ts
 *   - /src/ui/viewport.ts (Transform, ViewportState)
 *   - /src/ui/renderers/SceneRenderer.ts
 *   - /src/ui/renderers/SimulationRenderer.ts
 * Last updated: Refactor — Transform, pure orchestration
 */

import React, { useRef, useEffect, useState, useCallback, type MutableRefObject } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { createRect, createEllipse, createLine } from '../../core/scene/SceneObject';
import { moveObjects } from '../../core/scene/SceneOps';
import { type SimulationResult } from '../../core/plan/Simulation';
import {
  type ViewportState,
  DEFAULT_VIEWPORT,
  Transform,
  zoomAt,
  wheelToZoomFactor,
  pan,
  fitToAABB,
  fitToBounds,
} from '../viewport';
import { computeFitBounds, computeObjectBounds } from '../../geometry/bounds';
import { aabbIntersects, type Matrix3x2 } from '../../core/types';
import { hitTestPoint } from '../../geometry/hit-test';
import { renderScene, renderSceneBackground, renderSceneObjects } from '../renderers/SceneRenderer';
import {
  renderSimulationPath,
  renderLaserHead,
  renderTrail,
} from '../renderers/SimulationRenderer';
import { type ToolType } from './ToolBar';

function defaultCursorForTool(activeTool: ToolType): string {
  const cursors: Record<string, string> = {
    select: 'default',
    node: 'crosshair',
    rect: 'crosshair',
    ellipse: 'crosshair',
    line: 'crosshair',
    text: 'text',
  };
  return cursors[activeTool] || 'default';
}

const GRID_SNAP = 1; // mm — snap to 1mm grid. Set to 0 to disable.

function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

function drawRulers(
  ctx: CanvasRenderingContext2D,
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number
): void {
  const rulerSize = 20;
  ctx.save();

  ctx.fillStyle = '#0f0f1a';
  ctx.fillRect(0, 0, canvasWidth, rulerSize);
  ctx.fillRect(0, rulerSize, rulerSize, canvasHeight - rulerSize);

  ctx.fillStyle = '#141422';
  ctx.fillRect(0, 0, rulerSize, rulerSize);

  const zoom = transform.zoom;
  let tickMm = 100;
  if (zoom > 0.5) tickMm = 50;
  if (zoom > 1) tickMm = 20;
  if (zoom > 2) tickMm = 10;
  if (zoom > 5) tickMm = 5;
  if (zoom > 10) tickMm = 1;

  ctx.fillStyle = '#555570';
  ctx.strokeStyle = '#333355';
  ctx.lineWidth = 1;
  ctx.font = '8px "JetBrains Mono", monospace';
  ctx.textBaseline = 'top';

  const worldLeft = transform.screenToWorld({ x: rulerSize, y: rulerSize }).x;
  const worldRight = transform.screenToWorld({ x: canvasWidth, y: rulerSize }).x;
  const startX = Math.floor(worldLeft / tickMm) * tickMm;

  for (let wmm = startX; wmm <= worldRight; wmm += tickMm) {
    const sx = transform.worldToScreen({ x: wmm, y: 0 }).x;
    if (sx < rulerSize) continue;

    ctx.beginPath();
    ctx.moveTo(sx, rulerSize - 5);
    ctx.lineTo(sx, rulerSize);
    ctx.stroke();

    if (wmm % (tickMm * 2) === 0 || tickMm >= 10) {
      ctx.fillText(`${wmm}`, sx + 2, 3);
    }
  }

  const worldTop = transform.screenToWorld({ x: rulerSize, y: rulerSize }).y;
  const worldBottom = transform.screenToWorld({ x: rulerSize, y: canvasHeight }).y;
  const startY = Math.floor(worldTop / tickMm) * tickMm;

  for (let wmm = startY; wmm <= worldBottom; wmm += tickMm) {
    const sy = transform.worldToScreen({ x: 0, y: wmm }).y;
    if (sy < rulerSize) continue;

    ctx.beginPath();
    ctx.moveTo(rulerSize - 5, sy);
    ctx.lineTo(rulerSize, sy);
    ctx.stroke();

    if (wmm % (tickMm * 2) === 0 || tickMm >= 10) {
      ctx.save();
      ctx.translate(3, sy + 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${wmm}`, 0, 0);
      ctx.restore();
    }
  }

  ctx.strokeStyle = '#252540';
  ctx.beginPath();
  ctx.moveTo(rulerSize, 0);
  ctx.lineTo(rulerSize, canvasHeight);
  ctx.moveTo(0, rulerSize);
  ctx.lineTo(canvasWidth, rulerSize);
  ctx.stroke();

  ctx.restore();
}

// ─── PROPS ───────────────────────────────────────────────────────

export type ViewportActions = {
  zoomIn: () => void;
  zoomOut: () => void;
  fitToBed: () => void;
};

interface CanvasViewportProps {
  scene: Scene;
  simulation?: SimulationResult | null;
  width?: number;
  height?: number;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (selectedIds: ReadonlySet<string>) => void;
  /** Called during drag — for live preview. Parent updates scene state but NOT history. */
  onSceneChange?: (scene: Scene) => void;
  /** Called on drag end — for history. Parent pushes to history. */
  onSceneCommit?: (scene: Scene) => void;
  activeTool?: ToolType;
  /** After draw-tool shape creation, parent can switch back to select (e.g. setActiveTool). */
  onActiveTool?: (tool: ToolType) => void;
  onZoomChange?: (zoom: number) => void;
  actionsRef?: MutableRefObject<ViewportActions | null>;
  previewMode?: boolean;
  /** Screen-space anchor for floating UI (selection top-center), canvas coordinates + getBoundingClientRect. */
  onSelectionScreenPos?: (pos: { x: number; y: number } | null) => void;
  /** Text tool: user clicked canvas — open text dialog with this world position. */
  onRequestTextPlacement?: (world: { x: number; y: number }) => void;
}

// ─── COMPONENT ───────────────────────────────────────────────────

export function CanvasViewport({
  scene,
  simulation = null,
  width = 800,
  height = 600,
  selectedIds = new Set() as ReadonlySet<string>,
  onSelectionChange,
  onSceneChange,
  onSceneCommit,
  activeTool = 'select',
  onActiveTool,
  onZoomChange,
  actionsRef,
  previewMode = false,
  onSelectionScreenPos,
  onRequestTextPlacement,
}: CanvasViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_VIEWPORT);
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; vp: ViewportState } | null>(null);
  const mouseWorldRef = useRef({ x: 0, y: 0 });
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const animFrameRef = useRef(0);
  const playStartRef = useRef(0);
  const playOffsetRef = useRef(0);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const lastClickTimeRef = useRef<number>(0);
  const lastClickIdRef = useRef<string>('');
  const spaceHeldRef = useRef(false);
  const nodeTargetIdRef = useRef<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  useEffect(() => {
    onZoomChangeRef.current?.(Math.round(viewport.zoom * 100));
  }, [viewport.zoom]);

  const selectionKey = [...selectedIds].sort().join(',');

  useEffect(() => {
    if (!onSelectionScreenPos) return;

    const report = () => {
      const canvas = canvasRef.current;
      if (selectedIds.size === 0) {
        onSelectionScreenPos(null);
        return;
      }
      if (!canvas) {
        onSelectionScreenPos(null);
        return;
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const id of selectedIds) {
        const obj = scene.objects.find(o => o.id === id);
        if (!obj) continue;
        const b = computeObjectBounds(obj);
        if (b.minX > b.maxX) continue;
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
      }

      if (minX === Infinity) {
        onSelectionScreenPos(null);
        return;
      }

      const transform = Transform.from(viewport);
      const cx = (minX + maxX) / 2;
      const screen = transform.worldToScreen({ x: cx, y: minY });
      const rect = canvas.getBoundingClientRect();
      onSelectionScreenPos({ x: rect.left + screen.x, y: rect.top + screen.y });
    };

    report();
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(report);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [scene, viewport, selectionKey, width, height, onSelectionScreenPos, selectedIds]);

  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      zoomIn: () => {
        setViewport(vp => {
          const next = zoomAt(vp, width / 2, height / 2, 1.3);
          onZoomChangeRef.current?.(Math.round(next.zoom * 100));
          return next;
        });
      },
      zoomOut: () => {
        setViewport(vp => {
          const next = zoomAt(vp, width / 2, height / 2, 1 / 1.3);
          onZoomChangeRef.current?.(Math.round(next.zoom * 100));
          return next;
        });
      },
      fitToBed: () => {
        const next = fitToBounds(0, 0, scene.canvas.width, scene.canvas.height, width, height, 20);
        onZoomChangeRef.current?.(Math.round(next.zoom * 100));
        setViewport(next);
      },
    };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, scene.canvas.width, scene.canvas.height, width, height]);

  useEffect(() => {
    isPanningRef.current = isPanning;
  }, [isPanning]);

  // ─── RENDER LOOP ─────────────────────────────────────────────
  // Pure orchestration: create transform, call renderers in order.

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;

    const transform = Transform.from(viewport);

    // 1–4. Scene (bed, grid, origin, objects) + selection highlights
    if (simulation && simulation.frames.length > 1) {
      ctx.save();
      ctx.globalAlpha = 0.15;
      renderScene(ctx, scene, transform, width, height, selectedIds, previewMode);
      ctx.restore();
      drawRulers(ctx, transform, width, height);
    } else {
      renderSceneBackground(ctx, scene, transform, width, height);
      ctx.restore();
      drawRulers(ctx, transform, width, height);
      ctx.save();
      transform.applyToContext(ctx);
      renderSceneObjects(ctx, scene, transform, width, height, selectedIds, previewMode);
    }

    if (!previewMode) {
    // Resize handles (union bounds of all selected, world space)
    if (selectedIds.size >= 1) {
      let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
      let any = false;
      for (const obj of scene.objects) {
        if (!selectedIds.has(obj.id)) continue;
        if (!obj.visible || obj.locked) continue;
        const layer = scene.layers.find(l => l.id === obj.layerId);
        if (!layer || !layer.visible || layer.locked) continue;
        const b = computeObjectBounds(obj);
        if (!b || b.minX > b.maxX) continue;
        any = true;
        gMinX = Math.min(gMinX, b.minX);
        gMinY = Math.min(gMinY, b.minY);
        gMaxX = Math.max(gMaxX, b.maxX);
        gMaxY = Math.max(gMaxY, b.maxY);
      }
      if (any && isFinite(gMinX) && gMinX <= gMaxX) {
        const x1 = gMinX;
        const y1 = gMinY;
        const x2 = gMaxX;
        const y2 = gMaxY;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        ctx.save();
        transform.applyToContext(ctx);
        const hSize = transform.screenPx(HANDLE_SIZE);
        ctx.fillStyle = '#3b8beb';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = transform.screenPx(1);
        const handlePositions = [
          { x: x1, y: y1 }, { x: mx, y: y1 }, { x: x2, y: y1 },
          { x: x2, y: my }, { x: x2, y: y2 }, { x: mx, y: y2 },
          { x: x1, y: y2 }, { x: x1, y: my },
        ];
        for (const hp of handlePositions) {
          ctx.fillRect(hp.x - hSize / 2, hp.y - hSize / 2, hSize, hSize);
          ctx.strokeRect(hp.x - hSize / 2, hp.y - hSize / 2, hSize, hSize);
        }
        ctx.restore();
      }
    }

    // Node editing overlay — single targeted path/polygon
    if (activeTool === 'node' && nodeTargetIdRef.current) {
      const obj = scene.objects.find(o => o.id === nodeTargetIdRef.current);
      if (obj && selectedIds.has(obj.id) && (obj.geometry.type === 'path' || obj.geometry.type === 'polygon')) {
        ctx.save();
        transform.applyToContext(ctx);

        const t = obj.transform;
        ctx.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);

        const nodeSize = transform.screenPx(3);

        if (obj.geometry.type === 'path') {
          const pathGeom = obj.geometry as any;
          for (const sp of (pathGeom.subPaths || [])) {
            for (const seg of sp.segments) {
              if (seg.type === 'close') continue;
              ctx.fillStyle = 'rgba(45, 212, 160, 0.4)';
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
              ctx.lineWidth = transform.screenPx(0.5);
              ctx.beginPath();
              ctx.arc(seg.to.x, seg.to.y, nodeSize, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();

              if (seg.type === 'cubic' && seg.cp1 && seg.cp2) {
                ctx.strokeStyle = 'rgba(45, 212, 160, 0.12)';
                ctx.lineWidth = transform.screenPx(0.5);
                ctx.beginPath();
                ctx.moveTo(seg.cp1.x, seg.cp1.y);
                ctx.lineTo(seg.to.x, seg.to.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(seg.cp2.x, seg.cp2.y);
                ctx.lineTo(seg.to.x, seg.to.y);
                ctx.stroke();

                ctx.fillStyle = 'rgba(255, 100, 100, 0.35)';
                const cpSize = transform.screenPx(2);
                ctx.beginPath();
                ctx.arc(seg.cp1.x, seg.cp1.y, cpSize, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(seg.cp2.x, seg.cp2.y, cpSize, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
        } else if (obj.geometry.type === 'polygon') {
          const polyGeom = obj.geometry as any;
          for (const pt of (polyGeom.points || [])) {
            ctx.fillStyle = 'rgba(45, 212, 160, 0.4)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = transform.screenPx(0.5);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, nodeSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }

        ctx.restore();
      }
    }

    // 8. Drawing preview (rubber band)
    if (drawRef.current && drawRef.current.tool === activeTool) {
      ctx.save();
      transform.applyToContext(ctx);
      const sx = drawRef.current.startWorldX;
      const sy = drawRef.current.startWorldY;
      const cx = drawRef.current.currentWorldX;
      const cy = drawRef.current.currentWorldY;

      ctx.strokeStyle = '#3b8beb';
      ctx.lineWidth = transform.screenPx(1);
      ctx.setLineDash([transform.screenPx(4), transform.screenPx(3)]);

      if (activeTool === 'rect') {
        const x = Math.min(sx, cx);
        const y = Math.min(sy, cy);
        ctx.strokeRect(x, y, Math.abs(cx - sx), Math.abs(cy - sy));
      } else if (activeTool === 'ellipse') {
        const x = Math.min(sx, cx);
        const y = Math.min(sy, cy);
        const w = Math.abs(cx - sx);
        const h = Math.abs(cy - sy);
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (activeTool === 'line') {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }

      ctx.setLineDash([]);
      ctx.restore();
    }

    // Marquee selection rectangle
    if (marqueeRef.current) {
      ctx.save();
      transform.applyToContext(ctx);
      const sx = marqueeRef.current.startWorldX;
      const sy = marqueeRef.current.startWorldY;
      const cx = marqueeRef.current.currentWorldX;
      const cy = marqueeRef.current.currentWorldY;
      const x = Math.min(sx, cx);
      const y = Math.min(sy, cy);
      const w = Math.abs(cx - sx);
      const h = Math.abs(cy - sy);

      ctx.fillStyle = 'rgba(59, 139, 235, 0.08)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#3b8beb';
      ctx.lineWidth = transform.screenPx(1);
      ctx.setLineDash([transform.screenPx(4), transform.screenPx(3)]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.restore();
    }

    }

    // 5–6. Simulation overlay (in world space)
    if (simulation && simulation.frames.length > 1) {
      const visibleBounds = transform.getVisibleWorldBounds(width, height);
      ctx.save();
      transform.applyToContext(ctx);
      renderSimulationPath(ctx, simulation, transform, playbackTime, visibleBounds);
      renderTrail(ctx, simulation, transform, playbackTime, 0.5, visibleBounds);
      renderLaserHead(ctx, simulation, transform, playbackTime);
      ctx.restore();
    }

    // 7. Screen-space overlay
    renderOverlay(ctx, width, height, mouseWorldRef.current, scene.objects.length, selectedIds.size);
  }, [scene, simulation, viewport, width, height, playbackTime, selectedIds, activeTool, previewMode]);

  useEffect(() => { render(); }, [render]);

  useEffect(() => {
    if (activeTool !== 'node') {
      nodeTargetIdRef.current = null;
    }
    render();
  }, [activeTool, render]);

  // ─── ANIMATION PLAYBACK ──────────────────────────────────────

  useEffect(() => {
    if (!isPlaying || !simulation) return;

    playStartRef.current = performance.now();
    playOffsetRef.current = playbackTime;

    const animate = () => {
      const elapsed = (performance.now() - playStartRef.current) / 1000;
      const newTime = playOffsetRef.current + elapsed;

      if (newTime >= simulation.totalTime) {
        setPlaybackTime(simulation.totalTime);
        setIsPlaying(false);
        return;
      }

      setPlaybackTime(newTime);
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, simulation]);

  // ─── MOUSE HANDLERS ──────────────────────────────────────────

  // Interaction state machine:
  //   idle → (mouseDown on empty)  → clickPending → (mouseUp < 3px) → select/clear
  //   idle → (mouseDown on object) → clickPending → (mouseUp < 3px) → select object
  //   idle → (mouseDown on object) → clickPending → (move > 3px)   → dragging → (mouseUp) → commit
  //   idle → (alt+mouseDown)       → panning      → (mouseUp) → idle

  const clickStartRef = useRef<{ sx: number; sy: number; worldX: number; worldY: number } | null>(null);
  const dragRef = useRef<{
    isDragging: boolean;
    lastWorldX: number;
    lastWorldY: number;
    hitSelectedObject: boolean;  // Did mouseDown land on a selected object?
    dragIds: ReadonlySet<string>;
  } | null>(null);
  const drawRef = useRef<{
    tool: string;
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
  } | null>(null);
  const marqueeRef = useRef<{
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
  } | null>(null);
  const resizeRef = useRef<{
    handle: string;
    startX: number;
    startY: number;
    origBounds: { minX: number; minY: number; maxX: number; maxY: number };
    selectedIds: Set<string>;
    origTransforms: Map<string, Matrix3x2>;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const nodeDragRef = useRef<{
    objId: string;
    subPathIdx: number;
    segIdx: number;
    field: 'to' | 'cp1' | 'cp2';  // which point is being dragged
    isPolygonPt: boolean;
    ptIdx: number;
  } | null>(null);
  const startDragRef = useRef<{ startX: number; startY: number } | null>(null);

  const HANDLE_SIZE = 8;

  const getHandleAtPoint = useCallback((screenX: number, screenY: number, selectedObjs: typeof scene.objects) => {
    if (selectedObjs.length === 0) return null;

    let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
    for (const obj of selectedObjs) {
      if (!obj.visible || obj.locked) continue;
      const layer = scene.layers.find(l => l.id === obj.layerId);
      if (!layer || !layer.visible || layer.locked) continue;
      const bounds = computeObjectBounds(obj);
      if (!bounds || bounds.minX > bounds.maxX) continue;
      gMinX = Math.min(gMinX, bounds.minX);
      gMinY = Math.min(gMinY, bounds.minY);
      gMaxX = Math.max(gMaxX, bounds.maxX);
      gMaxY = Math.max(gMaxY, bounds.maxY);
    }
    if (!isFinite(gMinX) || gMinX > gMaxX) return null;

    const bw = gMaxX - gMinX;
    const bh = gMaxY - gMinY;
    if (bw <= 0 || bh <= 0) return null;

    const transform = Transform.from(viewport);
    const corners = [
      { name: 'nw', x: gMinX, y: gMinY },
      { name: 'n', x: (gMinX + gMaxX) / 2, y: gMinY },
      { name: 'ne', x: gMaxX, y: gMinY },
      { name: 'e', x: gMaxX, y: (gMinY + gMaxY) / 2 },
      { name: 'se', x: gMaxX, y: gMaxY },
      { name: 's', x: (gMinX + gMaxX) / 2, y: gMaxY },
      { name: 'sw', x: gMinX, y: gMaxY },
      { name: 'w', x: gMinX, y: (gMinY + gMaxY) / 2 },
    ];

    for (const c of corners) {
      const sp = transform.worldToScreen({ x: c.x, y: c.y });
      if (Math.abs(screenX - sp.x) <= HANDLE_SIZE && Math.abs(screenY - sp.y) <= HANDLE_SIZE) {
        return { handle: c.name, bounds: { minX: gMinX, minY: gMinY, maxX: gMaxX, maxY: gMaxY } };
      }
    }
    return null;
  }, [scene, viewport]);

  // Native wheel listener — must be non-passive for preventDefault to work.
  // React synthetic onWheel is passive in Chrome 73+, making preventDefault a no-op.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setViewport(vp => {
        const next = zoomAt(vp, sx, sy, wheelToZoomFactor(e.deltaY));
        onZoomChangeRef.current?.(Math.round(next.zoom * 100));
        return next;
      });
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceHeldRef.current = true;
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = 'grab';
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        const canvas = canvasRef.current;
        if (canvas && !isPanningRef.current) canvas.style.cursor = defaultCursorForTool(activeTool);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [activeTool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.cursor = defaultCursorForTool(activeTool);
  }, [activeTool]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Pan: middle mouse button OR spacebar + left click (Alt+left fallback)
    if (e.button === 1 || (e.button === 0 && (spaceHeldRef.current || e.altKey))) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, vp: viewport });
      return;
    }

    if (e.button !== 0) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const transform = Transform.from(viewport);
    const worldPt = transform.screenToWorld({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });

    if (activeTool === 'text') {
      onRequestTextPlacement?.({
        x: snapToGrid(worldPt.x, GRID_SNAP),
        y: snapToGrid(worldPt.y, GRID_SNAP),
      });
      return;
    }

    if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'line') {
      // Drawing tools: record start point
      drawRef.current = {
        tool: activeTool,
        startWorldX: snapToGrid(worldPt.x, GRID_SNAP),
        startWorldY: snapToGrid(worldPt.y, GRID_SNAP),
        currentWorldX: snapToGrid(worldPt.x, GRID_SNAP),
        currentWorldY: snapToGrid(worldPt.y, GRID_SNAP),
      };
      return;
    }

    // Start position dot drag
    if (scene.startPosition) {
      const sp = scene.startPosition;
      const hitRadius = 10 / (viewport.zoom || 1);
      if (Math.abs(worldPt.x - sp.x) < hitRadius && Math.abs(worldPt.y - sp.y) < hitRadius) {
        startDragRef.current = { startX: worldPt.x, startY: worldPt.y };
        e.preventDefault();
        return;
      }
    }

    // Check for resize handle hit (union bounds of selection)
    if (selectedIds.size >= 1) {
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const selObjs = scene.objects.filter(o => selectedIds.has(o.id));
      const handleHit = getHandleAtPoint(sx, sy, selObjs);
      if (handleHit) {
        let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
        const origTransforms = new Map<string, Matrix3x2>();

        for (const obj of scene.objects) {
          if (!selectedIds.has(obj.id)) continue;
          origTransforms.set(obj.id, { ...obj.transform });
          const ob = computeObjectBounds(obj);
          if (!ob) continue;
          gMinX = Math.min(gMinX, ob.minX);
          gMinY = Math.min(gMinY, ob.minY);
          gMaxX = Math.max(gMaxX, ob.maxX);
          gMaxY = Math.max(gMaxY, ob.maxY);
        }

        const handle = handleHit.handle;
        let anchorX = (gMinX + gMaxX) / 2;
        let anchorY = (gMinY + gMaxY) / 2;
        if (handle.includes('e')) anchorX = gMinX;
        if (handle.includes('w')) anchorX = gMaxX;
        if (handle.includes('s')) anchorY = gMinY;
        if (handle.includes('n')) anchorY = gMaxY;
        if (handle === 'n' || handle === 's') anchorX = gMinX;
        if (handle === 'e' || handle === 'w') anchorY = gMinY;

        resizeRef.current = {
          handle,
          startX: worldPt.x,
          startY: worldPt.y,
          origBounds: { minX: gMinX, minY: gMinY, maxX: gMaxX, maxY: gMaxY },
          selectedIds: new Set(selectedIds),
          origTransforms,
          anchorX,
          anchorY,
        };
        dragRef.current = null;
        clickStartRef.current = null;
        e.preventDefault();
        return;
      }
    }

    if (activeTool === 'node' && nodeTargetIdRef.current) {
      const obj = scene.objects.find(o => o.id === nodeTargetIdRef.current);
      if (obj) {
        const hitRadius = 6 / (viewport.zoom || 1);
        // Transform world point to object-local coordinates
        const localX = (worldPt.x - obj.transform.tx) / (obj.transform.a || 1);
        const localY = (worldPt.y - obj.transform.ty) / (obj.transform.d || 1);

        if (obj.geometry.type === 'path') {
          const pathGeom = obj.geometry as any;
          for (let si = 0; si < (pathGeom.subPaths || []).length; si++) {
            const sp = pathGeom.subPaths[si];
            for (let gi = 0; gi < sp.segments.length; gi++) {
              const seg = sp.segments[gi];
              if (seg.type === 'close') continue;

              // Check main point
              if (Math.abs(seg.to.x - localX) < hitRadius && Math.abs(seg.to.y - localY) < hitRadius) {
                nodeDragRef.current = { objId: obj.id, subPathIdx: si, segIdx: gi, field: 'to', isPolygonPt: false, ptIdx: 0 };
                return;
              }
              // Check control points
              if (seg.type === 'cubic') {
                if (seg.cp1 && Math.abs(seg.cp1.x - localX) < hitRadius && Math.abs(seg.cp1.y - localY) < hitRadius) {
                  nodeDragRef.current = { objId: obj.id, subPathIdx: si, segIdx: gi, field: 'cp1', isPolygonPt: false, ptIdx: 0 };
                  return;
                }
                if (seg.cp2 && Math.abs(seg.cp2.x - localX) < hitRadius && Math.abs(seg.cp2.y - localY) < hitRadius) {
                  nodeDragRef.current = { objId: obj.id, subPathIdx: si, segIdx: gi, field: 'cp2', isPolygonPt: false, ptIdx: 0 };
                  return;
                }
              }
            }
          }
        } else if (obj.geometry.type === 'polygon') {
          const polyGeom = obj.geometry as any;
          for (let pi = 0; pi < (polyGeom.points || []).length; pi++) {
            const pt = polyGeom.points[pi];
            if (Math.abs(pt.x - localX) < hitRadius && Math.abs(pt.y - localY) < hitRadius) {
              nodeDragRef.current = { objId: obj.id, subPathIdx: 0, segIdx: 0, field: 'to', isPolygonPt: true, ptIdx: pi };
              return;
            }
          }
        }
      }
    }

    // Select tool: existing click/drag logic continues below
    // Record click start for click-vs-drag detection
    clickStartRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      worldX: worldPt.x,
      worldY: worldPt.y,
    };

    // Hit test to determine if this is a potential drag
    const tolerance = transform.screenPx(5);
    const hit = hitTestPoint(worldPt, scene, tolerance);
    const hitIsSelected = hit !== null && selectedIds.has(hit.id);

    dragRef.current = {
      isDragging: false,  // Not dragging yet — waiting for 3px threshold
      lastWorldX: worldPt.x,
      lastWorldY: worldPt.y,
      hitSelectedObject: hitIsSelected,
      dragIds: new Set(selectedIds),
    };

    // If clicking an unselected object (without shift), select it immediately
    // so the drag moves the right thing
    if (hit && !hitIsSelected && !e.shiftKey) {
      const newSel = new Set([hit.id]);
      onSelectionChange?.(newSel);
      dragRef.current.hitSelectedObject = true;
      dragRef.current.dragIds = newSel;
    }
  }, [viewport, scene, selectedIds, onSelectionChange, onSceneCommit, activeTool, getHandleAtPoint, onRequestTextPlacement]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const transform = Transform.from(viewport);
    const world = transform.screenToWorld({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    mouseWorldRef.current = world;

    // Start position dragging
    if (startDragRef.current) {
      const newScene = {
        ...scene,
        startPosition: {
          x: Math.round(world.x),
          y: Math.round(world.y),
        },
      };
      onSceneChange?.(newScene);
      return;
    }

    // Drawing preview: update current position for rubber band
    if (drawRef.current && (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'line')) {
      drawRef.current.currentWorldX = snapToGrid(world.x, GRID_SNAP);
      drawRef.current.currentWorldY = snapToGrid(world.y, GRID_SNAP);
      render();
    }

    // Pan (middle held, or left + space / Alt)
    if (isPanning && panStart) {
      if (e.buttons === 4 || (e.buttons === 1 && (spaceHeldRef.current || e.altKey))) {
        setViewport(pan(panStart.vp, e.clientX - panStart.x, e.clientY - panStart.y));
      }
      return;
    }

    // Resize handle dragging
    if (resizeRef.current) {
      const r = resizeRef.current;
      const dx = world.x - r.startX;
      const dy = world.y - r.startY;
      const handle = r.handle;
      const origW = r.origBounds.maxX - r.origBounds.minX;
      const origH = r.origBounds.maxY - r.origBounds.minY;

      if (origW === 0 || origH === 0) return;

      let sx = 1, sy = 1;

      if (handle === 'se') {
        sx = sy = Math.max(0.05, 1 + Math.max(dx / origW, dy / origH));
      } else if (handle === 'nw') {
        sx = sy = Math.max(0.05, 1 + Math.max(-dx / origW, -dy / origH));
      } else if (handle === 'ne') {
        sx = sy = Math.max(0.05, 1 + Math.max(dx / origW, -dy / origH));
      } else if (handle === 'sw') {
        sx = sy = Math.max(0.05, 1 + Math.max(-dx / origW, dy / origH));
      } else if (handle === 'e') {
        sx = Math.max(0.05, 1 + dx / origW);
      } else if (handle === 'w') {
        sx = Math.max(0.05, 1 - dx / origW);
      } else if (handle === 's') {
        sy = Math.max(0.05, 1 + dy / origH);
      } else if (handle === 'n') {
        sy = Math.max(0.05, 1 - dy / origH);
      }

      const ax = r.anchorX;
      const ay = r.anchorY;

      const newScene = {
        ...scene,
        objects: scene.objects.map(o => {
          if (!r.selectedIds.has(o.id)) return o;
          const ot = r.origTransforms.get(o.id);
          if (!ot) return o;

          const newA = ot.a * sx;
          const newD = ot.d * sy;
          const newTx = ax + (ot.tx - ax) * sx;
          const newTy = ay + (ot.ty - ay) * sy;

          return {
            ...o,
            transform: { ...o.transform, a: newA, b: ot.b, c: ot.c, d: newD, tx: newTx, ty: newTy },
            _bounds: null, _worldTransform: null,
          };
        }),
      };
      onSceneChange?.(newScene);
      return;
    }

    // Node dragging
    if (nodeDragRef.current) {
      const nd = nodeDragRef.current;
      const obj = scene.objects.find(o => o.id === nd.objId);
      if (!obj) { nodeDragRef.current = null; return; }

      const localX = (world.x - obj.transform.tx) / (obj.transform.a || 1);
      const localY = (world.y - obj.transform.ty) / (obj.transform.d || 1);

      const newScene = {
        ...scene,
        objects: scene.objects.map(o => {
          if (o.id !== nd.objId) return o;

          if (nd.isPolygonPt) {
            const polyGeom = { ...(o.geometry as any) };
            const newPoints = [...polyGeom.points];
            newPoints[nd.ptIdx] = { x: localX, y: localY };
            return { ...o, geometry: { ...polyGeom, points: newPoints }, _bounds: null, _worldTransform: null };
          }

          const pathGeom = { ...(o.geometry as any) };
          const newSubPaths = pathGeom.subPaths.map((sp: any, si: number) => {
            if (si !== nd.subPathIdx) return sp;
            return {
              ...sp,
              segments: sp.segments.map((seg: any, gi: number) => {
                if (gi !== nd.segIdx) return seg;
                if (nd.field === 'to') return { ...seg, to: { x: localX, y: localY } };
                if (nd.field === 'cp1') return { ...seg, cp1: { x: localX, y: localY } };
                if (nd.field === 'cp2') return { ...seg, cp2: { x: localX, y: localY } };
                return seg;
              }),
            };
          });
          return { ...o, geometry: { ...pathGeom, subPaths: newSubPaths }, _bounds: null, _worldTransform: null };
        }),
      };
      onSceneChange?.(newScene);
      render();
      return;
    }

    // Drag detection: check threshold while click is pending
    if (dragRef.current && !dragRef.current.isDragging && clickStartRef.current) {
      const dx = e.clientX - clickStartRef.current.sx;
      const dy = e.clientY - clickStartRef.current.sy;
      const distSq = dx * dx + dy * dy;

      if (distSq > 9) {
        if (dragRef.current.hitSelectedObject && dragRef.current.dragIds.size > 0) {
          dragRef.current.isDragging = true;
          setIsDragging(true);
          dragRef.current.lastWorldX = world.x;
          dragRef.current.lastWorldY = world.y;
          clickStartRef.current = null;
        } else if (activeTool === 'select') {
          // Dragging on empty space — start marquee selection
          const startX = clickStartRef.current!.worldX;
          const startY = clickStartRef.current!.worldY;
          clickStartRef.current = null;
          dragRef.current = null;
          marqueeRef.current = {
            startWorldX: startX,
            startWorldY: startY,
            currentWorldX: world.x,
            currentWorldY: world.y,
          };
        } else {
          clickStartRef.current = null;
          dragRef.current = null;
        }
      }
    }

    // Drag movement: runs every mouseMove while drag is active
    if (dragRef.current?.isDragging) {
      const worldDx = world.x - dragRef.current.lastWorldX;
      const worldDy = world.y - dragRef.current.lastWorldY;
      dragRef.current.lastWorldX = world.x;
      dragRef.current.lastWorldY = world.y;

      if ((worldDx !== 0 || worldDy !== 0) && onSceneChange) {
        const moved = moveObjects(scene, dragRef.current.dragIds, worldDx, worldDy);
        const dragIds = dragRef.current.dragIds;
        const snapped = {
          ...moved,
          objects: moved.objects.map(o => {
            if (!dragIds.has(o.id)) return o;
            return {
              ...o,
              transform: {
                ...o.transform,
                tx: snapToGrid(o.transform.tx, GRID_SNAP),
                ty: snapToGrid(o.transform.ty, GRID_SNAP),
              },
              _bounds: null,
              _worldTransform: null,
            };
          }),
        };
        onSceneChange(snapped);
      }
    }

    // Marquee selection tracking
    if (marqueeRef.current) {
      marqueeRef.current.currentWorldX = world.x;
      marqueeRef.current.currentWorldY = world.y;
      render();
    }

    const canvas = canvasRef.current;
    if (canvas) {
      if (isPanning) {
        canvas.style.cursor = 'grabbing';
      } else if (spaceHeldRef.current && !dragRef.current?.isDragging && !resizeRef.current) {
        canvas.style.cursor = 'grab';
      } else if (activeTool === 'select' && selectedIds.size >= 1 && !dragRef.current?.isDragging && !resizeRef.current) {
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const selObjs = scene.objects.filter(o => selectedIds.has(o.id));
        const handleHit = getHandleAtPoint(sx, sy, selObjs);
        if (handleHit) {
          const cursors: Record<string, string> = {
            nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize',
            n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
          };
          canvas.style.cursor = cursors[handleHit.handle] || 'default';
        } else {
          canvas.style.cursor = defaultCursorForTool(activeTool);
        }
      } else if (!isPanning && !dragRef.current?.isDragging) {
        canvas.style.cursor = defaultCursorForTool(activeTool);
      }
    }
  }, [viewport, isPanning, panStart, scene, selectedIds, onSceneChange, activeTool, render, getHandleAtPoint]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    setIsPanning(false);
    setPanStart(null);

    // Start position drag completion
    if (startDragRef.current) {
      onSceneCommit?.(scene);
      startDragRef.current = null;
      return;
    }

    // Drawing tool: create shape on mouseUp
    if (drawRef.current && (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'line')) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const transform = Transform.from(viewport);
        const endWorld = transform.screenToWorld({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });

        const sx0 = snapToGrid(drawRef.current.startWorldX, GRID_SNAP);
        const sy0 = snapToGrid(drawRef.current.startWorldY, GRID_SNAP);
        const ex0 = snapToGrid(endWorld.x, GRID_SNAP);
        const ey0 = snapToGrid(endWorld.y, GRID_SNAP);

        const x1 = Math.min(sx0, ex0);
        const y1 = Math.min(sy0, ey0);
        const x2 = Math.max(sx0, ex0);
        const y2 = Math.max(sy0, ey0);
        const w = x2 - x1;
        const h = y2 - y1;

        if (w > 0.5 || h > 0.5 || activeTool === 'line') {
          const layerId = scene.activeLayerId || scene.layers[0]?.id;
          let newObj: ReturnType<typeof createRect> | ReturnType<typeof createEllipse> | ReturnType<typeof createLine> | undefined;

          if (layerId) {
            if (activeTool === 'rect') {
              newObj = createRect(layerId, x1, y1, w, h);
            } else if (activeTool === 'ellipse') {
              newObj = createEllipse(layerId, x1 + w / 2, y1 + h / 2, w / 2, h / 2);
            } else if (activeTool === 'line') {
              newObj = createLine(layerId, sx0, sy0, ex0, ey0);
            }

            if (newObj) {
              const newScene = { ...scene, objects: [...scene.objects, newObj] };
              onSceneChange?.(newScene);
              onSceneCommit?.(newScene);
              onSelectionChange?.(new Set([newObj.id]));
              // After shape creation is complete, switch back to select tool
              onActiveTool?.('select');
            }
          }
        }
      }
      drawRef.current = null;
      return;
    }

    const wasDragging = dragRef.current?.isDragging ?? false;
    dragRef.current = null;
    setIsDragging(false);

    // Marquee selection: select objects within rectangle
    if (marqueeRef.current) {
      const mx1 = Math.min(marqueeRef.current.startWorldX, marqueeRef.current.currentWorldX);
      const my1 = Math.min(marqueeRef.current.startWorldY, marqueeRef.current.currentWorldY);
      const mx2 = Math.max(marqueeRef.current.startWorldX, marqueeRef.current.currentWorldX);
      const my2 = Math.max(marqueeRef.current.startWorldY, marqueeRef.current.currentWorldY);
      const marqueeBox = { minX: mx1, minY: my1, maxX: mx2, maxY: my2 };

      const hits = new Set<string>();
      for (const obj of scene.objects) {
        if (!obj.visible || obj.locked) continue;
        const layer = scene.layers.find(l => l.id === obj.layerId);
        if (!layer || !layer.visible || layer.locked) continue;
        const objBounds = computeObjectBounds(obj);
        if (aabbIntersects(objBounds, marqueeBox)) {
          hits.add(obj.id);
        }
      }

      if (hits.size > 0) {
        onSelectionChange?.(hits);
      } else {
        // Don't deselect when using node tool — keep current selection for node editing
        if (activeTool === 'node' && selectedIds.size > 0) {
          // Do nothing — keep selection for node editing
        } else {
          onSelectionChange?.(new Set());
        }
      }

      marqueeRef.current = null;
      return;
    }

    // Resize completion
    if (resizeRef.current) {
      onSceneCommit?.(scene);
      resizeRef.current = null;
      return;
    }

    // Node drag completion
    if (nodeDragRef.current) {
      onSceneCommit?.(scene);
      nodeDragRef.current = null;
      return;
    }

    // If was dragging: commit the final scene to history, then done
    if (wasDragging) {
      clickStartRef.current = null;
      onSceneCommit?.(scene);  // Single history entry for entire drag
      return;
    }

    // Click detection: mouseUp at roughly same position as mouseDown
    if (clickStartRef.current && e.button === 0) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const transform = Transform.from(viewport);
        const worldPt = transform.screenToWorld({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        const tolerance = transform.screenPx(5);
        const hit = hitTestPoint(worldPt, scene, tolerance);

        let newSelection: ReadonlySet<string>;

        if (hit) {
          const hitObj = scene.objects.find(o => o.id === hit.id);
          if (e.shiftKey) {
            const next = new Set(selectedIds);
            if (next.has(hit.id)) {
              next.delete(hit.id);
            } else {
              next.add(hit.id);
            }
            newSelection = next;
          } else {
            // Double-click selects individual object inside group
            // Single click selects entire group
            const now = Date.now();
            const isDoubleClick = (now - (lastClickTimeRef.current || 0)) < 300
              && hitObj != null && hitObj.id === lastClickIdRef.current;
            lastClickTimeRef.current = now;
            lastClickIdRef.current = hitObj?.id ?? hit.id;

            if (hitObj?.parentId && !isDoubleClick && !e.shiftKey) {
              // Single click: select entire group
              newSelection = new Set(
                scene.objects
                  .filter(o => o.parentId === hitObj.parentId)
                  .map(o => o.id)
              );
            } else {
              // Double click, shift click, or ungrouped: select individual object
              newSelection = new Set([hitObj?.id ?? hit.id]);
            }
          }
          onSelectionChange?.(newSelection);
          // Set node target when using node tool
          if (activeTool === 'node' && hitObj) {
            nodeTargetIdRef.current = hitObj.id;
          }
          render();
        } else {
          nodeTargetIdRef.current = null;
          // Don't deselect when using node tool — keep current selection for node editing
          if (activeTool === 'node' && selectedIds.size > 0) {
            // Do nothing — keep selection for node editing
          } else {
            onSelectionChange?.(new Set());
          }
          render();
        }
      }
      clickStartRef.current = null;
    }
  }, [viewport, scene, selectedIds, onSelectionChange, onSceneCommit, activeTool, onSceneChange, render, onActiveTool]);

  const handleFitView = useCallback(() => {
    const bounds = computeFitBounds(scene, simulation);
    setViewport(fitToAABB(bounds, width, height, 0.1));
  }, [scene, simulation, width, height]);

  // Fit to content on initial load and when scene/simulation changes
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (!didInitialFit.current) {
      handleFitView();
      didInitialFit.current = true;
    }
  }, [handleFitView]);

  // ─── JSX ─────────────────────────────────────────────────────

  const totalTime = simulation?.totalTime ?? 0;

  return React.createElement('div', {
    style: { position: 'relative', width: '100%', height: '100%', background: '#06060c' },
  },
    React.createElement('canvas', {
      ref: canvasRef, width, height,
      style: {
        display: 'block',
        cursor: isPanning ? 'grabbing' : isDragging ? 'move' : defaultCursorForTool(activeTool),
      },
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    }),

    simulation && React.createElement(PlaybackControls, {
      isPlaying,
      playbackTime,
      totalTime,
      onPlayPause: () => setIsPlaying(!isPlaying),
      onScrub: (t: number) => { setPlaybackTime(t); setIsPlaying(false); },
      onReset: () => { setPlaybackTime(0); setIsPlaying(false); },
      onFitView: handleFitView,
    }),
  );
}

// ─── SCREEN-SPACE OVERLAY ────────────────────────────────────────

function renderOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mouseWorld: { x: number; y: number },
  objectCount: number,
  selectedCount: number
): void {
  ctx.fillStyle = '#0c0c18cc';
  ctx.fillRect(0, h - 22, w, 22);

  ctx.font = '10px monospace';
  ctx.fillStyle = '#555580';
  const selText = selectedCount > 0 ? `  |  Selected: ${selectedCount}` : '';
  ctx.fillText(
    `X: ${mouseWorld.x.toFixed(1)}mm  Y: ${mouseWorld.y.toFixed(1)}mm  |  Objects: ${objectCount}${selText}`,
    8, h - 7
  );
}

// ─── PLAYBACK CONTROLS ──────────────────────────────────────────

interface PlaybackControlsProps {
  isPlaying: boolean;
  playbackTime: number;
  totalTime: number;
  onPlayPause: () => void;
  onScrub: (time: number) => void;
  onReset: () => void;
  onFitView: () => void;
}

function PlaybackControls({
  isPlaying, playbackTime, totalTime,
  onPlayPause, onScrub, onReset, onFitView,
}: PlaybackControlsProps) {
  const btnStyle = {
    background: 'none', border: '1px solid #333', borderRadius: 3,
    color: '#aaa', padding: '2px 8px', cursor: 'pointer', fontSize: 10,
  };

  return React.createElement('div', {
    style: {
      position: 'absolute' as const, bottom: 26, left: 8, right: 8,
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 8px', background: '#0c0c18ee', borderRadius: 4,
      fontSize: 10, fontFamily: 'monospace', color: '#888',
    },
  },
    React.createElement('button', { onClick: onPlayPause, style: btnStyle }, isPlaying ? '⏸' : '▶'),
    React.createElement('span', { style: { color: '#e63e6d', minWidth: 48 } }, formatTime(playbackTime)),
    React.createElement('input', {
      type: 'range', min: 0, max: totalTime * 1000, value: playbackTime * 1000,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onScrub(Number(e.target.value) / 1000),
      style: { flex: 1, accentColor: '#e63e6d' },
    }),
    React.createElement('span', null, formatTime(totalTime)),
    React.createElement('button', { onClick: onReset, style: btnStyle }, '⏹'),
    React.createElement('button', { onClick: onFitView, style: btnStyle }, 'Fit'),
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds * 10) % 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}
