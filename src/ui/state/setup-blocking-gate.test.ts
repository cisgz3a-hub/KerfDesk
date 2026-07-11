// CNC-03 — the setup-motion gate. During a tool-change hold the operator must
// jog/probe/Zero-Z to touch off the new bit, but ONLY once the machine drains
// the pre-M0 retract/park and reports Idle. Start / Home / Setup keep the
// strict block, so Start never unblocks at a tool change.
import { describe, expect, it } from 'vitest';
import { createStreamer, onAck, step, type StatusReport } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  TOOL_CHANGE_NOT_IDLE_MESSAGE,
  activeJobCommandBlockMessage,
  jogFrameCommandBlockMessage,
  setupBlockingJobCommandBlockMessage,
  setupCommandBlockMessage,
} from './laser-store-helpers';

const MULTI_TOOL = ['G1 X10 Y10 F800', 'G0 Z5', 'M5', 'G0 X0 Y0', 'M0', 'M3 S12000'].join('\n');

function toolChangeStreamer(): LaserState['streamer'] {
  const s = step(createStreamer(MULTI_TOOL, { toolChangePause: true })).state;
  if (s.status !== 'tool-change') throw new Error(`expected tool-change, got ${s.status}`);
  return s;
}
// Tool-change hold with the pre-M0 retract/park tail fully drained (acked).
function drainedToolChangeStreamer(): LaserState['streamer'] {
  let s = step(createStreamer(MULTI_TOOL, { toolChangePause: true })).state;
  while (s !== null && s.inFlight.length > 0) s = onAck(s, 'ok').state;
  if (s?.status !== 'tool-change')
    throw new Error(`expected drained tool-change, got ${s?.status}`);
  return s;
}
function streamingStreamer(): LaserState['streamer'] {
  return step(createStreamer('G1 X1 S100')).state;
}
function statusReport(state: StatusReport['state']): StatusReport {
  return {
    state,
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    feed: 0,
    spindle: 0,
    wco: null,
  };
}
// The gates read only these fields; a partial cast keeps the test focused.
function gateState(partial: Partial<LaserState>): LaserState {
  return { motionOperation: null, controllerOperation: null, ...partial } as LaserState;
}

describe('setupBlockingJobCommandBlockMessage (CNC-03)', () => {
  it('blocks setup motion during a normal streaming job', () => {
    const s = gateState({ streamer: streamingStreamer(), statusReport: null });
    expect(setupBlockingJobCommandBlockMessage(s)).toBe(ACTIVE_JOB_COMMAND_MESSAGE);
  });

  it('permits setup motion during a tool-change hold once the tail drains and a fresh Idle is seen', () => {
    const s = gateState({ streamer: drainedToolChangeStreamer(), toolChangeIdleSeen: true });
    expect(setupBlockingJobCommandBlockMessage(s)).toBeNull();
  });

  it('blocks setup motion until the pre-M0 tail drains AND a FRESH Idle is observed', () => {
    // Running: not Idle at all.
    const running = gateState({
      streamer: drainedToolChangeStreamer(),
      statusReport: statusReport('Run'),
    });
    expect(setupBlockingJobCommandBlockMessage(running)).toBe(TOOL_CHANGE_NOT_IDLE_MESSAGE);
    // Tail still in-flight (retract not drained), even with the fresh-Idle flag.
    const notDrained = gateState({ streamer: toolChangeStreamer(), toolChangeIdleSeen: true });
    expect(setupBlockingJobCommandBlockMessage(notDrained)).toBe(TOOL_CHANGE_NOT_IDLE_MESSAGE);
    // STALE Idle: statusReport says Idle but no fresh Idle observed since the
    // boundary (toolChangeIdleSeen false). This is the exact defect — a pre-Start
    // Idle must NOT unlock setup (Codex audit P1).
    const staleIdle = gateState({
      streamer: drainedToolChangeStreamer(),
      toolChangeIdleSeen: false,
      statusReport: statusReport('Idle'),
    });
    expect(setupBlockingJobCommandBlockMessage(staleIdle)).toBe(TOOL_CHANGE_NOT_IDLE_MESSAGE);
  });

  it('does not block when there is no active job', () => {
    expect(
      setupBlockingJobCommandBlockMessage(gateState({ streamer: null, statusReport: null })),
    ).toBeNull();
  });

  it('lets jog fall through to allowed during a drained, fresh-Idle tool change', () => {
    // A ready tool change (drained + fresh Idle) necessarily has an Idle report —
    // that report is what set toolChangeIdleSeen — so the jog Idle check passes.
    const s = gateState({
      streamer: drainedToolChangeStreamer(),
      toolChangeIdleSeen: true,
      statusReport: statusReport('Idle'),
    });
    expect(jogFrameCommandBlockMessage(s)).toBeNull();
  });

  it('KEEPS Start blocked during a tool change — Start must never unblock', () => {
    // setupCommandBlockMessage backs assertStartAllowed, and it uses the STRICT
    // activeJobCommandBlockMessage, so even a ready tool-change still blocks Start.
    const s = gateState({ streamer: drainedToolChangeStreamer(), toolChangeIdleSeen: true });
    expect(activeJobCommandBlockMessage(s)).toBe(ACTIVE_JOB_COMMAND_MESSAGE);
    expect(setupCommandBlockMessage(s)).toBe(ACTIVE_JOB_COMMAND_MESSAGE);
  });
});
