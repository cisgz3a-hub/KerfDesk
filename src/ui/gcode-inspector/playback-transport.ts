// Pure transport logic for Inspector playback (ADR-255 stage 9c).
//
// Extracted from the React hook so the rules are testable without a DOM:
// the original "press Play at the end and nothing happens" bug lived in
// this logic, and there was no way to pin it while it was tangled up in
// setState updaters.
//
// Position is PLANNER SECONDS (stage 8b).

export type TransportState = {
  /** Playhead position in planner seconds. */
  readonly seconds: number;
  readonly playing: boolean;
};

export function clampSeconds(value: number, totalSeconds: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), Math.max(totalSeconds, 0));
}

/** A new program opens fully drawn and paused, so the whole job is visible. */
export function initialTransport(totalSeconds: number): TransportState {
  return { seconds: Math.max(totalSeconds, 0), playing: false };
}

/**
 * Play/pause. Pressing Play while parked at the end restarts from zero
 * rather than sticking at 100% — otherwise the button looks broken.
 */
export function togglePlay(state: TransportState, totalSeconds: number): TransportState {
  if (state.playing) return { ...state, playing: false };
  if (isAtEnd(state.seconds, totalSeconds)) return { seconds: 0, playing: true };
  return { ...state, playing: true };
}

/** Scrubbing and stepping take manual control, so they always pause. */
export function scrubTo(value: number, totalSeconds: number): TransportState {
  return { seconds: clampSeconds(value, totalSeconds), playing: false };
}

export function stepBy(
  state: TransportState,
  deltaSeconds: number,
  totalSeconds: number,
): TransportState {
  return scrubTo(state.seconds + deltaSeconds, totalSeconds);
}

export function restart(): TransportState {
  return { seconds: 0, playing: false };
}

/** One animation frame: advance by real elapsed time × speed, stopping at
 * the end of the program. */
export function advance(
  state: TransportState,
  elapsedSeconds: number,
  speed: number,
  totalSeconds: number,
): TransportState {
  const next = state.seconds + elapsedSeconds * speed;
  if (next >= totalSeconds) return { seconds: Math.max(totalSeconds, 0), playing: false };
  return { seconds: clampSeconds(next, totalSeconds), playing: true };
}

function isAtEnd(seconds: number, totalSeconds: number): boolean {
  return totalSeconds > 0 && seconds >= totalSeconds;
}
