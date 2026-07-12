import { afterEach, describe, expect, it } from 'vitest';
import {
  createStreamer,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { createJobCheckpoint, markResumeInFlight } from '../../core/recovery';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import type { LaserState } from '../state/laser-store';
import { useLaserStore } from '../state/laser-store';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';
import { installJobCheckpointTracking } from './use-job-checkpoint';

// 60 sendable lines wrapped in comments/blanks, like real emitted G-code.
const GCODE = ['; layer test', ...Array.from({ length: 60 }, (_, i) => `G1 X${i} S100`), ''].join(
  '\n',
);
const OTHER_GCODE = Array.from({ length: 10 }, (_, i) => `G1 Y${i} S50`).join('\n');
const NOW = '2026-07-07T03:00:00.000Z';
const LATER = '2026-07-07T04:00:00.000Z';
const IDLE_STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

function baseStreamer(gcode: string): StreamerState {
  return step(createStreamer(gcode)).state;
}

function patchStreamer(streamer: LaserState['streamer']): void {
  useLaserStore.setState({ streamer });
}

function freshCheckpoint(): ReturnType<typeof createJobCheckpoint> {
  return createJobCheckpoint({
    gcode: GCODE,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: NOW,
  });
}

let uninstall: (() => void) | null = null;

function install(): void {
  uninstall = installJobCheckpointTracking(() => LATER);
}

afterEach(() => {
  uninstall?.();
  uninstall = null;
  patchStreamer(null);
  localStorage.clear();
});

describe('installJobCheckpointTracking', () => {
  it('advances ackedLines once the ack interval is reached, not before', () => {
    install();
    writeJobCheckpoint(freshCheckpoint());
    const base = baseStreamer(GCODE);
    patchStreamer(base);
    patchStreamer({ ...base, completed: 10 });
    expect(readJobCheckpoint()?.ackedLines).toBe(0);
    patchStreamer({ ...base, completed: 25 });
    expect(readJobCheckpoint()?.ackedLines).toBe(25);
    // Next interval measures from the last WRITE.
    patchStreamer({ ...base, completed: 40 });
    expect(readJobCheckpoint()?.ackedLines).toBe(25);
    patchStreamer({ ...base, completed: 50 });
    expect(readJobCheckpoint()?.ackedLines).toBe(50);
  });

  it('writes immediately on a status transition even below the interval', () => {
    install();
    writeJobCheckpoint(freshCheckpoint());
    const base = baseStreamer(GCODE);
    patchStreamer(base);
    patchStreamer({ ...base, completed: 3 });
    expect(readJobCheckpoint()?.ackedLines).toBe(0);
    patchStreamer({ ...base, completed: 3, status: 'errored' });
    expect(readJobCheckpoint()?.ackedLines).toBe(3);
  });

  it('keeps the checkpoint through the final ack and clears only after physical Idle', () => {
    install();
    writeJobCheckpoint(freshCheckpoint());
    const base = baseStreamer(GCODE);
    patchStreamer({ ...base, completed: 30 });
    patchStreamer({ ...base, completed: 30, status: 'cancelled' });
    expect(readJobCheckpoint()?.ackedLines).toBe(30);
    patchStreamer({ ...base, completed: 60, status: 'done' });
    expect(readJobCheckpoint()).not.toBeNull();
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: IDLE_STATUS,
      streamer: null,
    });
    expect(readJobCheckpoint()).toBeNull();
  });

  it('freezes updates while a resume run is in flight, then clears after settled Idle', () => {
    install();
    writeJobCheckpoint(markResumeInFlight(freshCheckpoint(), NOW));
    const base = baseStreamer(GCODE);
    patchStreamer({ ...base, completed: 30 });
    expect(readJobCheckpoint()?.ackedLines).toBe(0);
    patchStreamer({ ...base, completed: 60, status: 'done' });
    expect(readJobCheckpoint()).not.toBeNull();
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: IDLE_STATUS,
      streamer: null,
    });
    expect(readJobCheckpoint()).toBeNull();
  });

  it('persists the disconnect reason with the interrupted checkpoint', () => {
    install();
    writeJobCheckpoint(freshCheckpoint());
    const base = baseStreamer(GCODE);
    patchStreamer({ ...base, completed: 12 });
    useLaserStore.setState({
      safetyNotice: {
        kind: 'disconnect-during-job',
        message: 'USB connection was lost during an active job.',
      },
      streamer: { ...base, completed: 12, status: 'disconnected' },
    });

    expect(readJobCheckpoint()?.interruption).toEqual({
      kind: 'disconnect',
      message: 'USB connection was lost during an active job.',
    });
  });

  it('normalizes a Fire disconnect as a connection-loss interruption', () => {
    install();
    writeJobCheckpoint(freshCheckpoint());
    const base = baseStreamer(GCODE);
    patchStreamer({ ...base, completed: 12 });
    useLaserStore.setState({
      safetyNotice: {
        kind: 'disconnect-during-fire',
        message: 'USB connection was lost while low-power Fire was active.',
      },
      streamer: { ...base, completed: 12, status: 'disconnected' },
    });

    expect(readJobCheckpoint()?.interruption).toEqual({
      kind: 'disconnect',
      message: 'USB connection was lost while low-power Fire was active.',
    });
  });

  it('freezes updates for a run with a foreign sendable total', () => {
    install();
    writeJobCheckpoint(freshCheckpoint());
    const foreign = baseStreamer(OTHER_GCODE);
    patchStreamer({ ...foreign, completed: 9 });
    expect(readJobCheckpoint()?.ackedLines).toBe(0);
  });

  it('does nothing when no checkpoint is stored', () => {
    install();
    const base = baseStreamer(GCODE);
    patchStreamer({ ...base, completed: 30 });
    expect(readJobCheckpoint()).toBeNull();
  });
});
