import { describe, expect, it } from 'vitest';
import {
  advance,
  clampSeconds,
  initialTransport,
  restart,
  scrubTo,
  stepBy,
  togglePlay,
} from './playback-transport';

const TOTAL = 12;

describe('togglePlay', () => {
  // Regression: pressing Play parked at the end used to do nothing at all.
  it('restarts from zero when pressed at the end', () => {
    const parked = initialTransport(TOTAL);
    expect(parked.seconds).toBe(TOTAL);
    const played = togglePlay(parked, TOTAL);
    expect(played).toEqual({ seconds: 0, playing: true });
  });

  it('resumes in place when pressed mid-program', () => {
    expect(togglePlay({ seconds: 5, playing: false }, TOTAL)).toEqual({
      seconds: 5,
      playing: true,
    });
  });

  it('pauses without moving the playhead', () => {
    expect(togglePlay({ seconds: 5, playing: true }, TOTAL)).toEqual({
      seconds: 5,
      playing: false,
    });
  });

  it('plays an empty program without restarting forever', () => {
    expect(togglePlay({ seconds: 0, playing: false }, 0)).toEqual({ seconds: 0, playing: true });
  });
});

describe('scrubTo and stepBy', () => {
  it('clamp to the program and always pause', () => {
    expect(scrubTo(-5, TOTAL)).toEqual({ seconds: 0, playing: false });
    expect(scrubTo(999, TOTAL)).toEqual({ seconds: TOTAL, playing: false });
    expect(scrubTo(4, TOTAL)).toEqual({ seconds: 4, playing: false });
  });

  it('step relative to the current position', () => {
    const state = { seconds: 5, playing: true };
    expect(stepBy(state, 1, TOTAL).seconds).toBeCloseTo(6, 6);
    expect(stepBy(state, -1, TOTAL).seconds).toBeCloseTo(4, 6);
    expect(stepBy(state, 999, TOTAL).seconds).toBe(TOTAL);
    expect(stepBy(state, -999, TOTAL).seconds).toBe(0);
    expect(stepBy(state, 1, TOTAL).playing).toBe(false);
  });
});

describe('advance', () => {
  it('moves by elapsed time times speed', () => {
    const next = advance({ seconds: 2, playing: true }, 0.5, 2, TOTAL);
    expect(next.seconds).toBeCloseTo(3, 6);
    expect(next.playing).toBe(true);
  });

  it('stops exactly at the end rather than overshooting', () => {
    const next = advance({ seconds: 11.9, playing: true }, 1, 4, TOTAL);
    expect(next).toEqual({ seconds: TOTAL, playing: false });
  });
});

describe('clampSeconds and restart', () => {
  it('handle degenerate input', () => {
    expect(clampSeconds(Number.NaN, TOTAL)).toBe(0);
    expect(clampSeconds(5, -1)).toBe(0);
    expect(restart()).toEqual({ seconds: 0, playing: false });
    expect(initialTransport(-3).seconds).toBe(0);
  });
});
