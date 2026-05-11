/**
 * T1-170 (audit F-016): `_notifySimulatorChunked` must emit a
 * rate-limited console.warn when a simulator listener throws, so
 * support bundles capture the existence of a broken listener.
 *
 * Pre-T1-170:
 *   for (; idx < end; idx++) {
 *     try { notify(lines[idx]); }
 *     catch { /\* ignore — broken listener must not break the chunked loop *\/ }
 *   }
 * Every error was silently swallowed. A broken simulator listener
 * could fail every line of a million-line job without an operator-
 * visible signal — preventing any chance of diagnosing it from logs.
 *
 * Post-T1-170:
 *  1. The first listener throw inside an invocation triggers a
 *     `console.warn` carrying the line index AND the error itself,
 *     so the error TYPE is recoverable from a support bundle.
 *  2. If failures > 1 over the chunked invocation, a final summary
 *     `console.warn` reports "failed on N of M lines" once the loop
 *     completes.
 *  3. The hard contract — broken listener MUST NOT break the chunked
 *     loop — is preserved. Every line still reaches the notify call,
 *     and the listener throw is still caught.
 *
 * Run: npx tsx tests/notify-simulator-chunked-warns-on-broken-listener.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MachineService } from '../src/app/MachineService';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeMinimalController(): LaserController {
  return {
    protocolName: 'mock',
    state: { ...idle },
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    operations: {
      jog: async () => ({ ok: true }),
      home: async () => ({ ok: true }),
      unlockAlarm: async () => ({ ok: true }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true }),
      resetWcsToMachineOrigin: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => ({ ok: true }),
    },
  } as unknown as LaserController;
}

/** Build a service and reach into its private `_notifySimulatorChunked`. */
function buildService(): MachineService {
  const portRef: { current: SerialPortLike | null } = { current: null };
  return new MachineService({ current: makeMinimalController() }, portRef);
}

function callChunked(svc: MachineService, lines: string[], notify: (line: string) => void): void {
  (svc as unknown as { _notifySimulatorChunked: (lines: string[], notify: (line: string) => void) => void })
    ._notifySimulatorChunked(lines, notify);
}

/** Capture console.warn calls. Resets between scenarios. */
class WarnCapture {
  private original: typeof console.warn;
  calls: Array<{ args: unknown[] }> = [];
  constructor() {
    this.original = console.warn;
    console.warn = (...args: unknown[]) => {
      this.calls.push({ args });
    };
  }
  restore(): void {
    console.warn = this.original;
  }
}

/** Drain pending setTimeout callbacks. */
async function drain(ms: number = 100): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

console.log('\n=== T1-170 _notifySimulatorChunked rate-limited warn on broken listener ===\n');

void (async () => {
  // -------- 1. No failures: no warn calls --------
  {
    const svc = buildService();
    const cap = new WarnCapture();
    let delivered = 0;
    callChunked(svc, ['G1 X10', 'G1 X20', 'G1 X30'], () => { delivered++; });
    await drain();
    cap.restore();
    assert(delivered === 3, `no-failure: all 3 lines delivered (got ${delivered})`);
    assert(
      cap.calls.length === 0,
      `no-failure: no console.warn calls (got ${cap.calls.length})`,
    );
  }

  // -------- 2. Single failure: ONE warn, hard contract preserved --------
  {
    const svc = buildService();
    const cap = new WarnCapture();
    let delivered = 0;
    let attempts = 0;
    callChunked(svc, ['ok', 'BAD', 'ok'], line => {
      attempts++;
      if (line === 'BAD') throw new Error('listener exploded');
      delivered++;
    });
    await drain();
    cap.restore();
    assert(attempts === 3, 'single-failure: notify called for every line (hard contract preserved)');
    assert(delivered === 2, 'single-failure: 2 lines delivered, 1 threw');
    assert(
      cap.calls.length === 1,
      `single-failure: exactly one console.warn (the first-failure log; no summary since count===1) — got ${cap.calls.length}`,
    );
    if (cap.calls.length >= 1) {
      const args = cap.calls[0].args;
      const formatString = String(args[0] ?? '');
      assert(
        /simulator listener threw/i.test(formatString),
        'single-failure: first-failure warn message identifies the listener',
      );
      // The error itself must be among the args so support bundles
      // can capture its type / stack.
      const errArg = args.find(a => a instanceof Error) as Error | undefined;
      assert(
        errArg !== undefined && /listener exploded/.test(errArg.message),
        'single-failure: the thrown Error is attached to the warn for diagnosis',
      );
    }
  }

  // -------- 3. Multiple failures: first-failure warn + final-summary warn --------
  {
    const svc = buildService();
    const cap = new WarnCapture();
    let delivered = 0;
    let attempts = 0;
    const lines = ['ok', 'BAD', 'ok', 'BAD', 'ok', 'BAD'];
    callChunked(svc, lines, line => {
      attempts++;
      if (line === 'BAD') throw new Error('listener exploded');
      delivered++;
    });
    await drain();
    cap.restore();
    assert(attempts === 6, 'multi-failure: notify called for every line (hard contract preserved)');
    assert(delivered === 3, 'multi-failure: 3 lines delivered, 3 threw');
    assert(
      cap.calls.length === 2,
      `multi-failure: exactly two console.warns (first-failure + final summary) — got ${cap.calls.length}`,
    );
    if (cap.calls.length === 2) {
      const summary = String(cap.calls[1].args[0] ?? '');
      // The summary uses `%d` placeholders (Node's console.warn util.format
      // substitutes at print time; the format string itself contains the
      // `%d` tokens, not the substituted digits).
      assert(
        /failed on %d of %d lines/i.test(summary),
        'multi-failure: summary warn reports "failed on %d of %d lines"',
      );
      // The summary's count must match the actual failure count.
      const countArg = cap.calls[1].args[1];
      const totalArg = cap.calls[1].args[2];
      assert(countArg === 3, `multi-failure: summary count === 3 (got ${countArg})`);
      assert(totalArg === 6, `multi-failure: summary total === 6 (got ${totalArg})`);
    }
  }

  // -------- 4. Every line fails: still ONE first-failure warn + ONE summary warn --------
  {
    const svc = buildService();
    const cap = new WarnCapture();
    callChunked(svc, ['a', 'b', 'c', 'd', 'e'], () => {
      throw new Error('every line broken');
    });
    await drain();
    cap.restore();
    assert(
      cap.calls.length === 2,
      `all-fail: exactly two warns (first-failure + summary) regardless of failure count — got ${cap.calls.length}`,
    );
    if (cap.calls.length === 2) {
      const countArg = cap.calls[1].args[1];
      assert(countArg === 5, `all-fail: summary count === 5 (got ${countArg})`);
    }
  }

  // -------- 5. Source pins on the implementation --------
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');
    assert(/T1-170/.test(src), 'MachineService.ts carries T1-170 marker');
    assert(/audit F-016/.test(src), 'MachineService.ts cross-references audit F-016');
    assert(
      /failureCount\s*=\s*0/.test(src),
      'failureCount accumulator declared',
    );
    assert(
      /failureCount === 0/.test(src),
      'first-failure gate present',
    );
    assert(
      /failureCount > 1/.test(src),
      'final-summary gate present (count > 1 → emit summary)',
    );
    // The empty `/* ignore — broken listener... */` comment must be
    // replaced by the observability path.
    assert(
      !/\/\* ignore — broken listener must not break the chunked loop \*\//.test(src),
      'pre-T1-170 silent-swallow comment removed',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
