/**
 * === FILE: /src/ui/renderers/SimulationRenderer.ts ===
 *
 * Purpose:    Renders simulation data onto the canvas:
 *             1. Laser path segments (colored by operation, opacity by power)
 *             2. Rapid travel lines (green dashed)
 *             3. Animated laser head (glowing dot at current time)
 *
 *             Supports frustum culling: when visibleBounds is provided,
 *             segments entirely outside the visible area are skipped.
 *
 * Dependencies:
 *   - /src/core/plan/Simulation.ts
 *   - /src/ui/viewport.ts (Transform)
 *   - /src/core/types.ts (AABB)
 * Last updated: Frustum culling — skip off-screen segments
 */

import {
  type SimulationResult,
  type SimulationFrame,
  getFrameAtTime,
} from '../../core/plan/Simulation';
import { type Transform } from '../viewport';
import { type AABB } from '../../core/types';

// ─── SEGMENT VISIBILITY TEST ─────────────────────────────────────

/**
 * Fast test: does the AABB of a line segment intersect the visible bounds?
 * Conservative — may return true for segments just outside, but never
 * returns false for visible segments.
 */
function segmentVisible(
  x1: number, y1: number,
  x2: number, y2: number,
  bounds: AABB
): boolean {
  const minX = x1 < x2 ? x1 : x2;
  const maxX = x1 > x2 ? x1 : x2;
  const minY = y1 < y2 ? y1 : y2;
  const maxY = y1 > y2 ? y1 : y2;
  return maxX >= bounds.minX && minX <= bounds.maxX &&
         maxY >= bounds.minY && minY <= bounds.maxY;
}

// ─── RENDER LASER PATH ───────────────────────────────────────────

/**
 * Draw the full laser path up to `currentTime`.
 * Cut/engrave segments colored by operation.
 * Rapid moves shown as green dashes.
 */
export function renderSimulationPath(
  ctx: CanvasRenderingContext2D,
  result: SimulationResult,
  transform: Transform,
  currentTime: number,
  visibleBounds?: AABB
): void {
  const { frames } = result;
  if (frames.length < 2) return;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];

    if (prev.time > currentTime) break;
    if (curr.moveType !== 'rapid' && curr.moveType !== 'linear') continue;
    if (prev.x === curr.x && prev.y === curr.y) continue;

    // Frustum cull
    if (visibleBounds && !segmentVisible(prev.x, prev.y, curr.x, curr.y, visibleBounds)) {
      continue;
    }

    if (curr.moveType === 'rapid') {
      ctx.strokeStyle = '#2dd4a050';
      ctx.lineWidth = transform.screenPx(0.5);
      ctx.setLineDash([transform.screenPx(3), transform.screenPx(4)]);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (curr.moveType === 'linear' && prev.laserOn) {
      const alpha = Math.max(0.3, curr.power / 100);
      const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.strokeStyle = curr.operationColor + alphaHex;
      ctx.lineWidth = transform.screenPx(1.2);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
    }
  }
}

// ─── RENDER LASER HEAD ───────────────────────────────────────────

/**
 * Draw the laser head as a glowing dot at the current playback time.
 * Red glow when laser is ON, white crosshair when OFF.
 * Always rendered (the head is always relevant regardless of position).
 */
export function renderLaserHead(
  ctx: CanvasRenderingContext2D,
  result: SimulationResult,
  transform: Transform,
  currentTime: number
): void {
  const frame = getFrameAtTime(result, currentTime);
  const x = frame.x;
  const y = frame.y;

  if (frame.laserOn) {
    const glowRadius = transform.screenPx(6);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    gradient.addColorStop(0, '#ff3030ff');
    gradient.addColorStop(0.4, '#ff303080');
    gradient.addColorStop(1, '#ff303000');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff6060';
    ctx.beginPath();
    ctx.arc(x, y, transform.screenPx(1.5), 0, Math.PI * 2);
    ctx.fill();
  } else {
    const s = transform.screenPx(4);
    ctx.strokeStyle = '#ffffff80';
    ctx.lineWidth = transform.screenPx(0.8);
    ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
    ctx.stroke();
  }
}

// ─── RENDER PROGRESS TRAIL ───────────────────────────────────────

/**
 * Draw a fading trail behind the laser head showing recent movement.
 */
export function renderTrail(
  ctx: CanvasRenderingContext2D,
  result: SimulationResult,
  transform: Transform,
  currentTime: number,
  trailDuration: number = 0.5,
  visibleBounds?: AABB
): void {
  const { frames } = result;
  const trailStart = currentTime - trailDuration;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];

    if (curr.time < trailStart) continue;
    if (prev.time > currentTime) break;
    if (curr.moveType !== 'linear' || !prev.laserOn) continue;
    if (prev.x === curr.x && prev.y === curr.y) continue;

    // Frustum cull
    if (visibleBounds && !segmentVisible(prev.x, prev.y, curr.x, curr.y, visibleBounds)) {
      continue;
    }

    const age = currentTime - curr.time;
    const opacity = Math.max(0, 1 - age / trailDuration);
    const alpha = Math.round(opacity * 200).toString(16).padStart(2, '0');

    ctx.strokeStyle = '#ff4040' + alpha;
    ctx.lineWidth = transform.screenPx(2);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }
}
