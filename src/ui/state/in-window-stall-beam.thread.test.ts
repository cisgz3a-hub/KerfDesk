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
//
// Rolling audit v9 R1 found the same order in Pause, and that the corrupted line
// was skipped with the job running on to `done`. A lost beam-off burned the next
// travel across the workpiece (ADR-676 Amendment 2).

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import {
  GRBL_COMPATIBLE,
  GRBLHAL_COMPATIBLE,
  MARLIN_FAN,
  MARLIN_FAN_TWO_CUTS,
  MARLIN_INLINE,
  MARLIN_INLINE_TWO_CUTS,
} from '../../__fixtures__/controllers/stall-thread-cases';
import {
  buildStallThread,
  containsRun,
  litMsDuring,
  measureAgain,
  runStall,
  runToJobEnd,
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
      // Up to the end of the stall: Abort's own residue has its measure below.
      expect(litMsDuring(run.litStops, run.stall)).toBeLessThan(LIT_TOLERANCE_MS);
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
      await until(() => useLaserStore.getState().pendingUntrackedAcks === 0, 5_000);
    }, 40_000);
  });

  describe('rolling audit v9 R1-P1-1: a line Marlin skipped ends the job with a notice', () => {
    const TRANSPORTS = ['usb-worker', 'window'] as const;
    // Each loses its first byte on Marlin's UART, so Marlin echoes the rest as
    // an unknown command, skips the whole line and answers ok. The fan program
    // opens with an M107 of its own, and the inline one reaches its first cut
    // with a G0: the second of each ends the first cut.
    const CASES = [
      ['fan beam-off', MARLIN_FAN_TWO_CUTS, { pattern: '^M107$', nth: 2 }, '107'],
      ['inline beam-off', MARLIN_INLINE_TWO_CUTS, { pattern: '^G0\\b', nth: 2 }, '0 X10'],
      ['fan move, every one', MARLIN_FAN_TWO_CUTS, { pattern: '^G1\\b' }, '1 X'],
      ['inline move, every one', MARLIN_INLINE_TWO_CUTS, { pattern: '^G1\\b' }, '1 X'],
    ] as const;

    describe.each(TRANSPORTS)('%s', (transport) => {
      it.each(CASES)(
        '%s',
        async (_label, testCase, loseFirstByte, echoed) => {
          const run = await runToJobEnd(testCase, transport, { loseFirstByte });

          expect(run.echoes).toEqual([expect.stringContaining(`echo:Unknown command: "${echoed}`)]);
          const state = useLaserStore.getState();
          expect(state.streamer?.status).toBe('errored');
          expect(state.safetyNotice?.kind).toBe('controller-error');
          expect(state.safetyNotice?.message).toContain(`"Unknown command" to ${echoed}`);
          expect(state.safetyNotice?.message).toContain('KerfDesk sent');
          // The stop went out, and no job move followed the skipped line.
          const skipped = run.received.findIndex((line) => line.startsWith(echoed));
          const after = run.received.slice(skipped + 1);
          expect(after).toEqual(expect.arrayContaining(['M410']));
          expect(after.filter((line) => JOB_MOVE.test(line))).toEqual([]);
          // The head is not left lit: the job's beam is off once the stop has run.
          await until(() => useLaserStore.getState().pendingUntrackedAcks === 0, 5_000);
          const settled = await measureAgain(run);
          expect(settled.litStops.at(-1)?.to ?? 0).toBeLessThan(Date.now() - 5);
        },
        40_000,
      );
    });

    it('a clean job on the same programs still ends done, with no notice', async () => {
      const run = await runToJobEnd(MARLIN_FAN_TWO_CUTS, 'usb-worker');
      expect(run.echoes).toEqual([]);
      expect(useLaserStore.getState().streamer?.status).toBe('done');
      expect(useLaserStore.getState().safetyNotice).toBeNull();
    }, 40_000);
  });

  describe('rolling audit v9 R1-P2-1: Pause after a stall stops ahead of the backlog', () => {
    it.each([
      ['fan output', MARLIN_FAN, 'M107'],
      ['inline', MARLIN_INLINE, 'M5 I'],
    ] as const)(
      '%s: the beam-off leads, Pause freezes where the worker stopped, and Resume finishes',
      async (_label, testCase, beamOff) => {
        // Each forwarded line costs this thread 4 ms, as a renderer's would.
        const settleMs = 1_500;
        const run = await runStall(testCase, 'usb-worker', {
          pauseAfterStall: true,
          lineCostMs: 4,
          settleMs,
        });
        const arrived = run.arrivals.find(
          (arrival) => arrival.line === beamOff && arrival.at >= run.stall.to,
        );
        expect(arrived).toBeDefined();
        expect((arrived?.at ?? Infinity) - run.stall.to).toBeLessThan(100);

        // The worker wrote no job line after the beam-off.
        const beamOffAt = run.received.lastIndexOf(beamOff);
        expect(run.received.slice(beamOffAt).filter((line) => JOB_MOVE.test(line))).toEqual([]);
        // This side froze at exactly the line where the worker stopped, so
        // nothing is sent twice or skipped when the job goes on.
        const paused = useLaserStore.getState().streamer;
        expect(paused?.status).toBe('paused');
        const queued = paused?.queued ?? [];
        const queueIndex = paused?.queueIndex ?? 0;
        const sentLines = queued.slice(0, queueIndex).map((line) => line.trimEnd());
        expect(containsRun(run.received, sentLines)).toBe(true);
        expect(run.received[beamOffAt - 1]).toBe(sentLines.at(-1));
        // Every reply settled its own ledger, the beam-off's too, so Resume can run.
        await until(() => useLaserStore.getState().pendingUntrackedAcks === 0, 5_000);

        await useLaserStore.getState().resumeJob();
        await until(() => useLaserStore.getState().streamer?.status === 'done', 20_000);
        const finished = await measureAgain(run);
        const restOfJob = (useLaserStore.getState().streamer?.queued ?? [])
          .slice(queueIndex)
          .map((line) => line.trimEnd());
        expect(containsRun(finished.received.slice(beamOffAt), restOfJob)).toBe(true);
      },
      60_000,
    );
  });
});
