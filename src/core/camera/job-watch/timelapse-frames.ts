// A job's timelapse frames (ADR-490): one frame every interval while the job
// runs, and never more than a fixed number of them. When a long job reaches
// the limit, every other frame is dropped and the interval doubles, so the
// frames kept stay evenly spaced over the whole job at any length. Pure core:
// the frames themselves are opaque (the UI keeps encoded pictures).

export const TIMELAPSE_MAX_FRAMES = 480;
export const TIMELAPSE_VIDEO_FPS = 15;

export type Timelapse<T> = {
  readonly frames: ReadonlyArray<T>;
  readonly intervalMs: number;
  /** When the most recent frame was kept, ms; null before the first. */
  readonly lastAtMs: number | null;
};

export function emptyTimelapse<T>(intervalMs: number): Timelapse<T> {
  return { frames: [], intervalMs, lastAtMs: null };
}

/** Whether a frame taken at `nowMs` would be kept. */
export function timelapseFrameDue<T>(timelapse: Timelapse<T>, nowMs: number): boolean {
  return timelapse.lastAtMs === null || nowMs - timelapse.lastAtMs >= timelapse.intervalMs;
}

/** `timelapse` with `frame` kept, thinned to half with a doubled interval at the limit. */
export function addTimelapseFrame<T>(
  timelapse: Timelapse<T>,
  frame: T,
  atMs: number,
  maxFrames: number = TIMELAPSE_MAX_FRAMES,
): Timelapse<T> {
  const frames = [...timelapse.frames, frame];
  if (frames.length <= maxFrames) {
    return { frames, intervalMs: timelapse.intervalMs, lastAtMs: atMs };
  }
  return {
    frames: frames.filter((_, index) => index % 2 === 0),
    intervalMs: timelapse.intervalMs * 2,
    lastAtMs: atMs,
  };
}

/** Frames dropped by the last thinning, for the UI to release. */
export function droppedFrames<T>(before: Timelapse<T>, after: Timelapse<T>): ReadonlyArray<T> {
  const kept = new Set(after.frames);
  return before.frames.filter((frame) => !kept.has(frame));
}

/** Seconds of video `frameCount` frames make at `fps`. */
export function timelapseVideoSeconds(
  frameCount: number,
  fps: number = TIMELAPSE_VIDEO_FPS,
): number {
  return fps > 0 ? frameCount / fps : 0;
}
