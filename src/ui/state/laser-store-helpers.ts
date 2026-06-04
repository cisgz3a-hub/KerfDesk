// laser-store-helpers — pure factories and patch builders extracted from
// laser-store.ts to keep that file under the ADR-015 size cap. There is no
// runtime import cycle: the LaserState import below is type-only (erased at
// build), so this module depends only on the controller + safety-notice modules
// at runtime.

import {
  RT_JOG_CANCEL,
  RT_SOFT_RESET,
  disconnect as disconnectStreamer,
  type StreamerState,
} from '../../core/controllers/grbl';
import { disconnectDuringJobNotice } from './laser-safety-notice';
import type { LaserState } from './laser-store';

const LOG_MAX = 200;
const AUTOFOCUS_BUSY_MESSAGE =
  'Auto-focus is running. Wait for it to finish before sending other motion commands.';

export function serialWriteErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function pushLog(state: LaserState, line: string): ReadonlyArray<string> {
  return [...state.log, line].slice(-LOG_MAX);
}

export function isActiveJob(streamer: StreamerState | null): boolean {
  return streamer !== null && ['streaming', 'paused', 'errored'].includes(streamer.status);
}

export function disconnectStopCommand(state: LaserState): string | null {
  if (isActiveJob(state.streamer)) return RT_SOFT_RESET;
  return state.motionOperation !== null ? RT_JOG_CANCEL : null;
}

export function assertAutofocusIdle(state: LaserState): void {
  if (state.autofocusBusy) throw new Error(AUTOFOCUS_BUSY_MESSAGE);
}

export function initialLaserState(): Pick<
  LaserState,
  | 'connection'
  | 'statusReport'
  | 'alarmCode'
  | 'lastError'
  | 'lastWriteError'
  | 'safetyNotice'
  | 'autofocusBusy'
  | 'motionOperation'
  | 'streamer'
  | 'log'
  | 'detectedSettings'
  | 'controllerSettings'
  | 'wcoCache'
  | 'workOriginActive'
> {
  return {
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    autofocusBusy: false,
    motionOperation: null,
    streamer: null,
    log: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
  };
}

// Patch applied when the serial port closes (the onClose handler). Marks
// everything disconnected and, if a job was streaming or paused, raises the
// disconnect-during-job safety notice — GRBL may still be executing the
// commands already in its 127-byte buffer (P0-B).
export function buildPortClosePatch(state: LaserState): Partial<LaserState> {
  const wasActiveJob =
    state.streamer !== null &&
    (state.streamer.status === 'streaming' || state.streamer.status === 'paused');
  const wasUnsafeActive = wasActiveJob || state.motionOperation !== null;
  const stream: StreamerState | null =
    wasActiveJob && state.streamer !== null ? disconnectStreamer(state.streamer) : state.streamer;
  return {
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerSettings: null,
    // GRBL clears G92 on the reset that fires when the port closes; our cache
    // must match or the next connect shows "custom origin" against a zeroed machine.
    wcoCache: null,
    workOriginActive: false,
    motionOperation: null,
    streamer: stream,
    ...(wasUnsafeActive ? { safetyNotice: disconnectDuringJobNotice() } : {}),
  };
}
