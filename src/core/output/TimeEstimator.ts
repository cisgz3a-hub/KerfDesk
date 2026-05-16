/**
 * Estimate job time from G-code.
 * Parses movement commands and calculates time based on feed rates and distances.
 */
import type { GcodeChunk } from './GcodeStreaming';

export interface JobTimeEstimate {
  totalSeconds: number;
  cutTime: number;
  travelTime: number;
  totalDistance: number;
  cutDistance: number;
  formatted: string;
}

interface TimeEstimatorState {
  x: number;
  y: number;
  feedRate: number;
  cutTime: number;
  travelTime: number;
  cutDistance: number;
  travelDistance: number;
}

function createTimeEstimatorState(): TimeEstimatorState {
  return {
    x: 0,
    y: 0,
    feedRate: 1000,
    cutTime: 0,
    travelTime: 0,
    cutDistance: 0,
    travelDistance: 0,
  };
}

function estimateLine(state: TimeEstimatorState, line: string): void {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(';')) return;

  const fMatch = trimmed.match(/F([\d.]+)/);
  if (fMatch) state.feedRate = parseFloat(fMatch[1]);

  const xMatch = trimmed.match(/X([-\d.]+)/);
  const yMatch = trimmed.match(/Y([-\d.]+)/);

  if (xMatch || yMatch) {
    const nx = xMatch ? parseFloat(xMatch[1]) : state.x;
    const ny = yMatch ? parseFloat(yMatch[1]) : state.y;
    const dx = nx - state.x;
    const dy = ny - state.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (trimmed.startsWith('G0')) {
      const rapidRate = 5000;
      state.travelTime += (dist / rapidRate) * 60;
      state.travelDistance += dist;
    } else if (trimmed.startsWith('G1')) {
      const rate = state.feedRate || 1000;
      state.cutTime += (dist / rate) * 60;
      state.cutDistance += dist;
    }

    state.x = nx;
    state.y = ny;
  }
}

function finishEstimate(state: TimeEstimatorState): JobTimeEstimate {
  const totalSeconds = state.cutTime + state.travelTime;
  const totalDistance = state.cutDistance + state.travelDistance;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  const formatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return {
    totalSeconds,
    cutTime: state.cutTime,
    travelTime: state.travelTime,
    totalDistance,
    cutDistance: state.cutDistance,
    formatted,
  };
}

export function estimateJobTime(gcode: string): JobTimeEstimate {
  const state = createTimeEstimatorState();
  for (const line of gcode.split('\n')) {
    estimateLine(state, line);
  }
  return finishEstimate(state);
}

export async function estimateJobTimeFromChunks(
  source: AsyncIterable<GcodeChunk>,
): Promise<JobTimeEstimate> {
  const state = createTimeEstimatorState();
  for await (const chunk of source) {
    for (const line of chunk.lines) {
      estimateLine(state, line);
    }
    if (chunk.isLast) break;
  }
  return finishEstimate(state);
}
