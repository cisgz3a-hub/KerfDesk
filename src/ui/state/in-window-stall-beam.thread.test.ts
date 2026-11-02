// @vitest-environment node
// Rolling audit v6 K1 (ADR-676), by the refuter's method: the controller model
// runs on its own node:worker_threads thread with the real clock; the real
// store runs on this thread, which a synchronous busy loop blocks mid-burn,
// as a large edit, Undo or import blocks the app window
// (__fixtures__/controllers/stall-thread-harness.ts).
//
// On the window transport nothing refills the controller during the block, so
// it drains and stops the head with the beam lit: the Marlin fan output, the
// Marlin inline cutter (until its 1 s safety timeout) and GRBL under M3. Those
// runs are the controls, and Job Review's warning must name each of them.
// With the fix, a worker refills Marlin USB and network GRBL-family sessions,
// and the head never stops lit while this thread is blocked.
//
// Rolling audit v8 N1 found two ways the Marlin worker path still lost that
// protection (ADR-676 Amendment 1): an Unknown-command echo of a corrupted
// line moved the rest of the job back to the window, and an Abort right after
// a stall wrote its stop lines only once this thread had worked through the
// lines the worker forwarded meanwhile.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import {
  buildStallThread,
  containsRun,
  GRBL_COMPATIBLE,
  GRBLHAL_COMPATIBLE,
  litMsDuring,
  MARLIN_FAN,
  MARLIN_INLINE,
  runStall,
  terminateStallThreads,
  until,
} from '../../__fixtures__/controllers/stall-thread-harness';
import { resetStore } from './test-helpers';

beforeAll(buildStallThread, 60_000);

afterEach(async () => {
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  await terminateStallThreads();
  useLaserStore.setState(initialLaserState());
  resetStore();
  vi.restoreAllMocks();
});

const LIT_TOLERANCE_MS = 25;

const JOB_MOVE = /^G[0-3]\b/;

describe('a blocked window during a burn (rolling audit v6 K1)', () => {
  describe('controls: the window transport stops the head with the beam lit', () => {
    it('Marlin fan output stays on for the rest of the stall, and Job Review says E-stop', async () => {
      const run = await runStall(MARLIN_FAN, 'window', { hostedStreaming: false });
      expect(run.litDuringStall).toBeGreaterThan(MARLIN_FAN.stallMs - 400);
      expect(run.warnings).toEqual([expect.stringContaining('until you press the E-stop')]);
    }, 40_000);

    it('Marlin inline stays lit until the 1 s safety timeout, and Job Review names it', async () => {
      const run = await runStall(MARLIN_INLINE, 'window', { hostedStreaming: false });
      expect(run.litDuringStall).toBeGreaterThan(800);
      // Sampled each millisecond on a shared clock, so allow some jitter.
      expect(run.litDuringStall).toBeLessThan(1_100);
      expect(run.warnings).toEqual([expect.stringContaining('LASER_SAFETY_TIMEOUT_MS')]);
    }, 40_000);

    it('GRBL under M3 stays lit for the rest of the stall, and Job Review names it', async () => {
      const run = await runStall(GRBL_COMPATIBLE, 'window', { hostedStreaming: false });
      expect(run.litDuringStall).toBeGreaterThan(GRBL_COMPATIBLE.stallMs - 400);
      expect(run.warnings).toEqual([expect.stringContaining('constant power (M3')]);
    }, 40_000);
  });

  describe('fixed: a worker refills the controller while the window is blocked', () => {
    it('Marlin inline over a worker-owned USB port never stops lit', async () => {
      const run = await runStall(MARLIN_INLINE, 'usb-worker');
      expect(useLaserStore.getState().jobStreamHost).toBe('worker');
      // The store armed the worker with Marlin's reply grammar.
      expect(run.armAcks).toEqual(['marlin']);
      expect(run.litDuringStall).toBeLessThan(LIT_TOLERANCE_MS);
      expect(run.warnings).toEqual([]);
      // Every line reached the controller once, in order.
      const queued = createStreamer(run.program).queued.map((line) => line.trimEnd());
      expect(containsRun(run.received, queued)).toBe(true);
    }, 40_000);

    it('Marlin fan output over a worker-owned USB port never stops lit, and Abort stops clean', async () => {
      const run = await runStall(MARLIN_FAN, 'usb-worker', { abortAfterStall: true });
      expect(run.armAcks).toEqual(['marlin']);
      expect(run.litDuringStall).toBeLessThan(LIT_TOLERANCE_MS);
      expect(run.warnings).toEqual([]);
      // Abort's quickstop (M107, M410, M5 I) follows the refill's release, so
      // no job move follows it on the wire.
      const quickstop = run.received.indexOf('M410');
      expect(run.received[quickstop - 1]).toBe('M107');
      expect(run.received.slice(quickstop).filter((line) => JOB_MOVE.test(line))).toEqual([]);
      await until(() => useLaserStore.getState().pendingUntrackedAcks === 0, 5_000);
    }, 40_000);

    it('grblHAL under M3 over a desktop network session never stops lit', async () => {
      const run = await runStall(GRBLHAL_COMPATIBLE, 'network-worker');
      expect(run.armAcks).toEqual(['grbl']);
      expect(useLaserStore.getState().jobStreamHost).toBe('worker');
      expect(run.litDuringStall).toBeLessThan(LIT_TOLERANCE_MS);
      expect(run.warnings).toEqual([]);
    }, 40_000);
  });

  describe('rolling audit v8 N1: the Marlin worker keeps the protection to the end', () => {
    it('keeps the refill through the echo of a corrupted line, so a later stall never stops lit', async () => {
      // The refuter's trigger: the 20th G1 reaches Marlin without its G, so it
      // echoes `Unknown command: "1 X…"`, skips the move and answers ok.
      const corrupted = 20;
      const run = await runStall(MARLIN_FAN, 'usb-worker', { dropCommandLetterOfMove: corrupted });
      expect(run.echoes).toEqual([expect.stringMatching(/^echo:Unknown command: "1 X/)]);
      expect(useLaserStore.getState().jobStreamHost).toBe('worker');
      expect(run.litDuringStall).toBeLessThan(LIT_TOLERANCE_MS);
      // Every refill stayed in the worker: this thread wrote no job line.
      expect(run.windowWrites.filter((data) => JOB_MOVE.test(data))).toEqual([]);
      // Every line reached the controller once, in order, the corrupted one
      // as Marlin read it.
      let moves = 0;
      const expected = createStreamer(run.program).queued.map((queuedLine) => {
        const line = queuedLine.trimEnd();
        if (!/^G1\b/.test(line)) return line;
        moves += 1;
        return moves === corrupted ? line.slice(1) : line;
      });
      expect(containsRun(run.received, expected)).toBe(true);
    }, 40_000);

    it('sends Abort’s stop lines before this thread works through the stall’s backlog', async () => {
      // Each forwarded line costs this thread 4 ms, as a renderer's would: the
      // audit's model, under which the fan stayed lit 226 ms after the stall.
      const settleMs = 1_500;
      const run = await runStall(MARLIN_FAN, 'usb-worker', {
        abortAfterStall: true,
        lineCostMs: 4,
        settleMs,
      });
      // The program opens with its own M107; Abort's comes after the block.
      const fanOff = run.arrivals.find(
        (arrival) => arrival.line === 'M107' && arrival.at >= run.stall.to,
      );
      expect(fanOff).toBeDefined();
      expect((fanOff?.at ?? Infinity) - run.stall.to).toBeLessThan(100);
      const afterStall = { from: run.stall.to, to: run.stall.to + settleMs };
      expect(litMsDuring(run.litStops, afterStall)).toBeLessThan(LIT_TOLERANCE_MS);
      // ADR-676's guarantee still holds: the worker sent no job line after the
      // stop lines, and every stop line's reply settles the ledger.
      const quickstop = run.received.indexOf('M410');
      expect(run.received[quickstop - 1]).toBe('M107');
      expect(run.received.slice(quickstop).filter((line) => JOB_MOVE.test(line))).toEqual([]);
      const t0 = Date.now();
      let settled = -1;
      const samples: number[] = [];
      while (Date.now() - t0 < 30_000) {
        const pending = useLaserStore.getState().pendingUntrackedAcks;
        if (samples.at(-1) !== pending) samples.push(pending);
        if (pending === 0) {
          settled = Date.now() - t0;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const s = useLaserStore.getState();
      process.stderr.write(
        'STALLDIAG ' +
          JSON.stringify({
            settled,
            samples,
            pending: s.pendingUntrackedAcks,
            streamer: s.streamer?.status ?? null,
            host: s.jobStreamHost,
            op: s.controllerOperation?.kind ?? null,
            notice: s.safetyNotice?.kind ?? null,
            status: s.statusReport?.state ?? null,
            received: run.received.length,
            tail: run.received.slice(-8),
            arrivalsTail: run.arrivals.slice(-5).map((a) => [a.line, a.at - run.stall.to]),
            logTail: s.log.slice(-14),
          }) +
          String.fromCharCode(10),
      );
      expect(settled).toBeGreaterThanOrEqual(0);
    }, 90_000);
  });
});
