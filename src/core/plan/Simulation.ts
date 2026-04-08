/**
 * === FILE: /src/core/plan/Simulation.ts ===
 *
 * Purpose:    Simulates execution of a Plan by stepping through every
 *             Move and producing a timeline of SimulationFrames.
 *
 *             Each frame is a snapshot: time, position, laser state,
 *             power, speed, and which operation is active. The UI can
 *             render these for path preview or animate the laser head.
 *
 *             Two output modes:
 *             - Event frames: one per move boundary (compact, for path drawing)
 *             - Interpolated frames: sampled at fixed time intervals (for animation)
 *
 * Dependencies:
 *   - /src/core/types.ts
 *   - /src/core/plan/Plan.ts
 * Last updated: Phase 6, Step 23 — Simulation engine
 */

import { type Point } from '../types';
import { type Plan, type Move, type PlannedOperation } from './Plan';

// ─── PUBLIC TYPES ────────────────────────────────────────────────

export interface SimulationFrame {
  time: number;              // Seconds since job start
  x: number;                 // mm
  y: number;                 // mm
  z: number;                 // mm
  laserOn: boolean;
  power: number;             // 0–100%
  speed: number;             // mm/min (current move speed, 0 if stationary)
  moveType: 'rapid' | 'linear' | 'laserOn' | 'laserOff' | 'dwell' | 'setAir' | 'setZ';
  operationIndex: number;    // Which PlannedOperation is active
  operationName: string;     // Layer name for display
  operationColor: string;    // Layer color for rendering
  progress: number;          // 0–1, fraction of total job time
}

export interface SimulationConfig {
  maxAcceleration: number;   // mm/s² (default: 500)
  maxRapidSpeed: number;     // mm/min (default: 6000)
}

export interface SimulationResult {
  frames: SimulationFrame[];
  totalTime: number;         // Seconds
  totalDistance: number;      // mm
  rapidDistance: number;      // mm
  cutDistance: number;        // mm
  operationCount: number;
}

// ─── DEFAULT CONFIG ──────────────────────────────────────────────

const DEFAULT_CONFIG: SimulationConfig = {
  maxAcceleration: 500,
  maxRapidSpeed: 6000,
};

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Simulate a Plan and produce event-based frames.
 * One frame per move boundary — compact and sufficient for path rendering.
 */
export function simulatePlan(
  plan: Plan,
  config: Partial<SimulationConfig> = {}
): SimulationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const frames: SimulationFrame[] = [];

  // Simulation state
  let time = 0;
  let x = 0, y = 0, z = 0;
  let laserOn = false;
  let power = 0;
  let speed = 0;
  let totalDist = 0;
  let rapidDist = 0;
  let cutDist = 0;

  // Emit initial frame at origin
  frames.push(makeFrame(0, x, y, z, false, 0, 0, 'rapid', 0, '', '', 0));

  for (let opIdx = 0; opIdx < plan.operations.length; opIdx++) {
    const op = plan.operations[opIdx];

    for (const move of op.moves) {
      switch (move.type) {
        case 'rapid': {
          const dist = distance(x, y, move.to.x, move.to.y);
          const dt = estimateMoveTime(dist, cfg.maxRapidSpeed, cfg.maxAcceleration);
          time += dt;
          x = move.to.x;
          y = move.to.y;
          totalDist += dist;
          rapidDist += dist;
          speed = cfg.maxRapidSpeed;

          frames.push(makeFrame(
            time, x, y, z, laserOn, power, speed,
            'rapid', opIdx, op.layerName, op.layerColor, 0
          ));
          break;
        }
        case 'linear': {
          const dist = distance(x, y, move.to.x, move.to.y);
          const dt = estimateMoveTime(dist, move.speed, cfg.maxAcceleration);
          time += dt;
          x = move.to.x;
          y = move.to.y;
          power = move.power;
          speed = move.speed;
          totalDist += dist;
          cutDist += dist;

          frames.push(makeFrame(
            time, x, y, z, laserOn, power, speed,
            'linear', opIdx, op.layerName, op.layerColor, 0
          ));
          break;
        }
        case 'laserOn': {
          laserOn = true;
          power = move.power;
          frames.push(makeFrame(
            time, x, y, z, true, power, 0,
            'laserOn', opIdx, op.layerName, op.layerColor, 0
          ));
          break;
        }
        case 'laserOff': {
          laserOn = false;
          power = 0;
          frames.push(makeFrame(
            time, x, y, z, false, 0, 0,
            'laserOff', opIdx, op.layerName, op.layerColor, 0
          ));
          break;
        }
        case 'dwell': {
          time += move.ms / 1000;
          frames.push(makeFrame(
            time, x, y, z, laserOn, power, 0,
            'dwell', opIdx, op.layerName, op.layerColor, 0
          ));
          break;
        }
        case 'setAir': {
          frames.push(makeFrame(
            time, x, y, z, laserOn, power, 0,
            'setAir', opIdx, op.layerName, op.layerColor, 0
          ));
          break;
        }
        case 'setZ': {
          z = move.z;
          frames.push(makeFrame(
            time, x, y, z, laserOn, power, 0,
            'setZ', opIdx, op.layerName, op.layerColor, 0
          ));
          break;
        }
      }
    }
  }

  // Fill in progress values (requires knowing total time)
  const totalTime = time;
  for (const frame of frames) {
    frame.progress = totalTime > 0 ? frame.time / totalTime : 0;
  }

  return {
    frames,
    totalTime,
    totalDistance: totalDist,
    rapidDistance: rapidDist,
    cutDistance: cutDist,
    operationCount: plan.operations.length,
  };
}

/**
 * Generate interpolated frames at a fixed time interval.
 * Used for smooth animation — the UI steps through these at playback speed.
 *
 * @param intervalMs Time between frames in milliseconds (default: 16 ≈ 60fps)
 */
export function interpolateFrames(
  result: SimulationResult,
  intervalMs: number = 16
): SimulationFrame[] {
  const { frames, totalTime } = result;
  if (frames.length < 2 || totalTime <= 0) return [...frames];

  const intervalSec = intervalMs / 1000;
  const output: SimulationFrame[] = [];

  let frameIdx = 0;

  for (let t = 0; t <= totalTime; t += intervalSec) {
    // Advance to the frame pair that brackets time t
    while (frameIdx < frames.length - 1 && frames[frameIdx + 1].time <= t) {
      frameIdx++;
    }

    const a = frames[frameIdx];
    const b = frameIdx < frames.length - 1 ? frames[frameIdx + 1] : a;

    if (a.time === b.time || a === b) {
      // No interpolation needed
      output.push({ ...a, time: t, progress: t / totalTime });
    } else {
      // Linear interpolation between a and b
      const frac = (t - a.time) / (b.time - a.time);
      output.push({
        time: t,
        x: a.x + (b.x - a.x) * frac,
        y: a.y + (b.y - a.y) * frac,
        z: a.z + (b.z - a.z) * frac,
        laserOn: a.laserOn,          // State doesn't interpolate
        power: a.power,
        speed: a.speed,
        moveType: a.moveType,
        operationIndex: a.operationIndex,
        operationName: a.operationName,
        operationColor: a.operationColor,
        progress: t / totalTime,
      });
    }
  }

  return output;
}

/**
 * Extract only the frames where the laser is ON.
 * Used for drawing the cut/engrave path preview on canvas.
 */
export function extractLaserPath(
  result: SimulationResult
): { from: Point; to: Point; power: number; color: string }[] {
  const segments: { from: Point; to: Point; power: number; color: string }[] = [];
  const { frames } = result;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];

    // Only include segments where laser was on and there was movement
    if (prev.laserOn && curr.moveType === 'linear') {
      segments.push({
        from: { x: prev.x, y: prev.y },
        to: { x: curr.x, y: curr.y },
        power: curr.power,
        color: curr.operationColor,
      });
    }
  }

  return segments;
}

/**
 * Get the simulation frame at a specific time.
 * Uses binary search for O(log n) lookup.
 */
export function getFrameAtTime(
  result: SimulationResult,
  time: number
): SimulationFrame {
  const { frames } = result;
  if (frames.length === 0) {
    return makeFrame(0, 0, 0, 0, false, 0, 0, 'rapid', 0, '', '', 0);
  }
  if (time <= 0) return frames[0];
  if (time >= result.totalTime) return frames[frames.length - 1];

  // Binary search for the frame just before `time`
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }

  const a = frames[lo];
  const b = lo < frames.length - 1 ? frames[lo + 1] : a;

  if (a === b || a.time === b.time) return { ...a };

  // Interpolate
  const frac = (time - a.time) / (b.time - a.time);
  return {
    time,
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
    z: a.z + (b.z - a.z) * frac,
    laserOn: a.laserOn,
    power: a.power,
    speed: a.speed,
    moveType: a.moveType,
    operationIndex: a.operationIndex,
    operationName: a.operationName,
    operationColor: a.operationColor,
    progress: time / result.totalTime,
  };
}

// ─── INTERNAL HELPERS ────────────────────────────────────────────

function makeFrame(
  time: number, x: number, y: number, z: number,
  laserOn: boolean, power: number, speed: number,
  moveType: SimulationFrame['moveType'],
  operationIndex: number, operationName: string,
  operationColor: string, progress: number
): SimulationFrame {
  return {
    time, x, y, z, laserOn, power, speed,
    moveType, operationIndex, operationName,
    operationColor, progress,
  };
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * Trapezoidal velocity model (duplicated from Plan.ts for independence).
 */
function estimateMoveTime(
  distanceMm: number,
  requestedSpeedMmMin: number,
  accelerationMmS2: number
): number {
  if (distanceMm <= 0) return 0;
  const v = requestedSpeedMmMin / 60;
  const a = accelerationMmS2;
  const accelDist = (v * v) / (2 * a);
  if (2 * accelDist >= distanceMm) {
    return 2 * Math.sqrt(distanceMm / a);
  }
  const accelTime = v / a;
  const cruiseDist = distanceMm - 2 * accelDist;
  const cruiseTime = cruiseDist / v;
  return 2 * accelTime + cruiseTime;
}
