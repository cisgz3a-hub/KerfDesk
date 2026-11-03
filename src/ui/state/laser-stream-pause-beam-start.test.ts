// Performance audit S1-P1-1 (ADR-676 Amendment 3): Start reads the program's
// beam facts in slices behind it, one per task, so a Pause finds them read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marlinDriver, type ControllerDriver } from '../../core/controllers';
import { createStreamer, type StreamerState } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { prepareStreamPauseBeamBehindStart } from './laser-stream-pause-beam';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function sliceCounter(slicesToFinish: number) {
  const read: Array<ReadonlyArray<string>> = [];
  const driver = {
    ...marlinDriver,
    prepareStreamPauseBeam: (lines: ReadonlyArray<string>) => {
      read.push(lines);
      return read.length >= slicesToFinish;
    },
  } as ControllerDriver;
  return { driver, read };
}

function stateWith(streamer: StreamerState | null): () => LaserState {
  return () => ({ streamer }) as LaserState;
}

describe('the beam facts read behind Start', () => {
  it('reads one slice per task, never in Start itself, until nothing is left', () => {
    const streamer = { ...createStreamer('M106 S80\nG1 X1\nM107\n'), status: 'streaming' as const };
    const { driver, read } = sliceCounter(3);

    prepareStreamPauseBeamBehindStart(stateWith(streamer), driver);
    expect(read).toHaveLength(0);
    vi.advanceTimersToNextTimer();
    expect(read).toHaveLength(1);
    vi.runAllTimers();
    expect(read).toEqual([streamer.queued, streamer.queued, streamer.queued]);
  });

  it('follows the stream current at each slice, and stops once it has ended', () => {
    let streamer: StreamerState | null = {
      ...createStreamer('M3 I S0\nG1 X1 S20\n'),
      status: 'streaming',
    };
    const first = streamer.queued;
    const { driver, read } = sliceCounter(Infinity);
    prepareStreamPauseBeamBehindStart(() => ({ streamer }) as LaserState, driver);

    vi.advanceTimersToNextTimer();
    // Resume's restated copy.
    streamer = { ...streamer, queued: [...first] };
    vi.advanceTimersToNextTimer();
    expect(read[1]).toBe(streamer.queued);
    streamer = { ...streamer, status: 'cancelled', queued: [] };
    vi.runAllTimers();
    expect(read).toHaveLength(2);
  });

  it('does nothing for a driver whose Pause needs no reading', () => {
    const { prepareStreamPauseBeam: _unused, ...grblLike } = marlinDriver;
    prepareStreamPauseBeamBehindStart(stateWith(null), grblLike as ControllerDriver);
    expect(vi.getTimerCount()).toBe(0);
  });
});
