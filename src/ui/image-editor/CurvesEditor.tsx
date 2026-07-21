// The Curves point editor (ADR-242, PP-E): Photoshop's tone-curve widget —
// luma histogram backdrop, quarter grid, the monotone-cubic curve, and
// draggable control points. Click empty space adds a point, dragging moves
// it (x clamped between neighbours), dragging far outside removes it.

import { useRef, useState } from 'react';
import { curveLut, lumaHistogram, type CurvePoint } from '../../core/image-adjust';
import { maskBounds } from '../../core/image-select';
import { useAdjustDialogStore } from './adjust-dialog-store';
import type { EditorSession } from './editor-session';

const PAD = 8;
const PLOT = 256;
const CANVAS_SIZE = PLOT + PAD * 2;
const HIT_RADIUS_PX = 9;
/** Dragging this far outside the plot removes the point (Photoshop). */
const REMOVE_DISTANCE_PX = 36;
const MIN_POINTS = 2;

export function CurvesEditor(props: {
  readonly points: readonly CurvePoint[];
  readonly session: EditorSession;
}): JSX.Element {
  const { points, session } = props;
  const setCurvePoints = useAdjustDialogStore((s) => s.setCurvePoints);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const binsRef = useRef<Uint32Array | null>(null);
  if (binsRef.current === null) {
    const rect = session.selection === null ? null : maskBounds(session.selection);
    binsRef.current = lumaHistogram(session.doc, rect, session.selection);
  }

  const toTone = (e: React.PointerEvent<HTMLCanvasElement>): CurvePoint => {
    const box = e.currentTarget.getBoundingClientRect();
    const scale = box.width / CANVAS_SIZE;
    return {
      x: clampByte((e.clientX - box.left) / scale - PAD),
      y: clampByte(255 - ((e.clientY - box.top) / scale - PAD)),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an optimization; a dead pointer id must not kill the drag.
    }
    const tone = toTone(e);
    const hit = points.findIndex(
      (p) => Math.abs(p.x - tone.x) <= HIT_RADIUS_PX && Math.abs(p.y - tone.y) <= HIT_RADIUS_PX,
    );
    if (hit >= 0) {
      setDragIndex(hit);
      return;
    }
    const next = [...points, tone].sort((a, b) => a.x - b.x);
    setCurvePoints(next);
    setDragIndex(next.findIndex((p) => p.x === tone.x && p.y === tone.y));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (dragIndex === null) return;
    const box = e.currentTarget.getBoundingClientRect();
    const outside =
      e.clientY < box.top - REMOVE_DISTANCE_PX || e.clientY > box.bottom + REMOVE_DISTANCE_PX;
    if (outside && points.length > MIN_POINTS) {
      setCurvePoints(points.filter((_, i) => i !== dragIndex));
      setDragIndex(null);
      return;
    }
    setCurvePoints(movePoint(points, dragIndex, toTone(e)));
  };

  return (
    <canvas
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      style={curvesCanvasStyle}
      aria-label="Tone curve editor: click to add a point, drag to shape the curve"
      title="Click to add a point; drag to shape; drag a point away to remove it"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragIndex(null)}
      onPointerCancel={() => setDragIndex(null)}
      ref={(canvas) => {
        const ctx = canvas?.getContext('2d') ?? null;
        if (ctx !== null && binsRef.current !== null) {
          drawCurves(ctx, points, binsRef.current, dragIndex);
        }
      }}
    />
  );
}

// Keep x strictly between the neighbours so the point order never flips.
function movePoint(
  points: readonly CurvePoint[],
  index: number,
  tone: CurvePoint,
): readonly CurvePoint[] {
  const prev = points[index - 1];
  const next = points[index + 1];
  const minX = prev === undefined ? 0 : prev.x + 1;
  const maxX = next === undefined ? 255 : next.x - 1;
  const x = Math.min(maxX, Math.max(minX, tone.x));
  return points.map((p, i) => (i === index ? { x, y: tone.y } : p));
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

// Canvas paint, not themable chrome — fixed drawing colors (ADR-047 canvas
// exemption, same as the editor scene painter).
/* eslint-disable no-restricted-syntax */
const HISTOGRAM_INK = '#5a5a5a';
const GRID_INK = '#4a4a4a';
const CURVE_INK = '#e8e8e8';
const POINT_INK = '#44aaff';
const BACKDROP_INK = '#2b2b2b';
/* eslint-enable no-restricted-syntax */

function drawCurves(
  ctx: CanvasRenderingContext2D,
  points: readonly CurvePoint[],
  bins: Uint32Array,
  dragIndex: number | null,
): void {
  ctx.fillStyle = BACKDROP_INK;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawHistogramBackdrop(ctx, bins);
  drawGrid(ctx);
  drawCurveLine(ctx, points);
  points.forEach((p, i) => {
    ctx.fillStyle = i === dragIndex ? CURVE_INK : POINT_INK;
    ctx.fillRect(PAD + p.x - 3, PAD + (255 - p.y) - 3, 7, 7);
  });
}

function drawHistogramBackdrop(ctx: CanvasRenderingContext2D, bins: Uint32Array): void {
  let max = 0;
  for (const count of bins) max = Math.max(max, count);
  if (max === 0) return;
  ctx.fillStyle = HISTOGRAM_INK;
  for (let i = 0; i < bins.length; i += 1) {
    const h = Math.round(((bins[i] ?? 0) / max) * PLOT);
    if (h > 0) ctx.fillRect(PAD + i, PAD + PLOT - h, 1, h);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = GRID_INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of [0.25, 0.5, 0.75]) {
    ctx.moveTo(PAD + PLOT * t, PAD);
    ctx.lineTo(PAD + PLOT * t, PAD + PLOT);
    ctx.moveTo(PAD, PAD + PLOT * t);
    ctx.lineTo(PAD + PLOT, PAD + PLOT * t);
  }
  ctx.stroke();
  ctx.strokeRect(PAD, PAD, PLOT, PLOT);
}

function drawCurveLine(ctx: CanvasRenderingContext2D, points: readonly CurvePoint[]): void {
  const lut = curveLut(points);
  ctx.strokeStyle = CURVE_INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, PAD + (255 - (lut[0] ?? 0)));
  for (let x = 1; x < 256; x += 1) {
    ctx.lineTo(PAD + x, PAD + (255 - (lut[x] ?? 0)));
  }
  ctx.stroke();
}

const curvesCanvasStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 4,
  touchAction: 'none',
  cursor: 'crosshair',
};
