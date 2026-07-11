import { afterEach, describe, expect, it } from 'vitest';
import { createStreamer, step, type StreamerState } from '../../core/controllers/grbl';
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

  it('keeps the checkpoint on cancel but clears it on done', () => {
    install();
    writeJobCheckpoint(freshCheckpoint());
    const base = baseStreamer(GCODE);
    patchStreamer({ ...base, completed: 30 });
    patchStreamer({ ...base, completed: 30, status: 'cancelled' });
    expect(readJobCheckpoint()?.ackedLines).toBe(30);
    patchStreamer({ ...base, completed: 60, status: 'done' });
    expect(readJobCheckpoint()).toBeNull();
  });

  it('freezes updates while a resume run is in flight, but its done still clears', () => {
    install();
    writeJobCheckpoint(markResumeInFlight(freshCheckpoint(), NOW));
    const base = baseStreamer(GCODE);
    patchStreamer({ ...base, completed: 30 });
    expect(readJobCheckpoint()?.ackedLines).toBe(0);
    patchStreamer({ ...base, completed: 60, status: 'done' });
    expect(readJobCheckpoint()).toBeNull();
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
