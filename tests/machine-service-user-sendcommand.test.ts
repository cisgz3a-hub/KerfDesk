/**
 * MachineService.sendCommand: T1-6 service-layer command gating.
 *
 * Before T1-6 the service was a pass-through; gating of user-typed
 * commands was the UI's job alone. The single wall meant any future
 * caller — script panel, MCP tool, automation, dev console misuse —
 * that called `sendCommand(cmd, 'user')` without going through the
 * UI confirm flow would silently execute dangerous commands like
 * `$X` (alarm unlock) or `$RST=*` (firmware reset).
 *
 * After T1-6: the service classifies user-source lines and rejects
 * warn/dangerous lines unless the caller passes a matching
 * `acknowledged` severity in the options bag. Internal LaserForge
 * callers (frame, jog, autofocus) pass `source: 'internal'` and
 * always succeed — the framework owns those calls and their gates
 * live elsewhere.
 *
 * The UI flow is unchanged in user-visible behavior:
 *   1. classifyUserCommand(cmd) → severity
 *   2. if warn/dangerous, show confirm dialog
 *   3. on approval, call sendCommand(cmd, 'user', { acknowledged })
 *   4. on rejection, do not send
 *
 * Run: npx tsx tests/machine-service-user-sendcommand.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { classifyUserCommand } from '../src/controllers/grbl/CommandClassifier';
import { type LaserController } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const sent: Array<{ cmd: string; source: 'internal' | 'user' }> = [];

const mockController: LaserController = {
  protocolName: 'mock',
  state: {
    status: 'idle',
    position: { x: 0, y: 0, z: 0 },
    feedRate: 0,
    spindleSpeed: 0,
    alarmCode: null,
    errorCode: null,
  },
  isJobRunning: false,
  maxSpindle: null,
  connect: async () => {},
  disconnect: async () => {},
  sendJob: () => Promise.resolve(),
  pause: () => {},
  resume: () => {},
  stop: () => {},
  emergencyStop: () => {},
  sendCommand: (cmd, source) => {
    sent.push({ cmd, source: source ?? 'internal' });
  },
  requestStatusReport: () => {},
  onStateChange: () => () => {},
  onProgress: () => () => {},
  onError: () => () => {},
  onRawLine: () => () => {},
  safetyOff: async () => ({ stage: 'm5' as const }),
} as LaserController;

const controllerRef = { current: mockController } as { current: LaserController };
const portRef = { current: null } as { current: SerialPortLike | null };
const svc = new MachineService(controllerRef, portRef);

async function expectBlocked(
  description: string,
  fn: () => Promise<void>,
  expectedSeverity: 'warn' | 'dangerous',
): Promise<void> {
  try {
    await fn();
    failed++;
    console.error(`  ✗ ${description} — expected throw, none thrown`);
  } catch (err: unknown) {
    const e = err as { code?: string; severity?: string; message?: string };
    if (e.code === 'COMMAND_BLOCKED' && e.severity === expectedSeverity) {
      passed++;
      console.log(`  ✓ ${description}`);
    } else {
      failed++;
      console.error(
        `  ✗ ${description} — wrong error: code=${e.code} severity=${e.severity} msg=${e.message}`,
      );
    }
  }
}

async function run(): Promise<void> {
  console.log('\n=== machine-service user sendCommand (T1-6) ===\n');

  // ── Classifier proxy ──────────────────────────────────────────
  {
    const a = svc.classifyUserCommand('$X');
    const b = classifyUserCommand('$X');
    assert(
      a.severity === b.severity && a.command === b.command,
      'classifyUserCommand proxies the shared classifier (dangerous: $X)',
    );
    const c = svc.classifyUserCommand('?');
    const d = classifyUserCommand('?');
    assert(
      c.severity === d.severity,
      'classifyUserCommand proxies the shared classifier (safe: ?)',
    );
  }

  // ── Safe lines from any source: pass through ─────────────────
  sent.length = 0;
  await svc.sendCommand('?', 'user');
  assert(
    sent.length === 1 && sent[0]?.cmd === '?' && sent[0].source === 'user',
    "sendCommand('?', 'user') passes through (safe class)",
  );

  sent.length = 0;
  await svc.sendCommand('$$', 'user');
  assert(
    sent.length === 1 && sent[0]?.cmd === '$$' && sent[0].source === 'user',
    "sendCommand('$$', 'user') passes through (safe class)",
  );

  sent.length = 0;
  await svc.sendCommand('G0 X10', 'user');
  assert(
    sent.length === 1 && sent[0]?.cmd === 'G0 X10' && sent[0].source === 'user',
    "sendCommand('G0 X10', 'user') passes through (safe class)",
  );

  // ── Internal callers: bypass classification entirely ─────────
  sent.length = 0;
  await svc.sendCommand('$X', 'internal');
  assert(
    sent.length === 1 && sent[0]?.cmd === '$X' && sent[0].source === 'internal',
    "sendCommand('$X', 'internal') passes through unchanged (framework owns internal calls)",
  );

  sent.length = 0;
  await svc.sendCommand('$RST=*', 'internal');
  assert(
    sent.length === 1 && sent[0]?.cmd === '$RST=*' && sent[0].source === 'internal',
    "sendCommand('$RST=*', 'internal') passes through (no classifier on internal)",
  );

  sent.length = 0;
  await svc.sendCommand('M3 S1000', 'internal');
  assert(
    sent.length === 1 && sent[0]?.cmd === 'M3 S1000' && sent[0].source === 'internal',
    "sendCommand('M3 S1000', 'internal') passes through (no classifier on internal)",
  );

  // ── User dangerous without acknowledgement: blocked ──────────
  sent.length = 0;
  await expectBlocked(
    "sendCommand('$X', 'user') without acknowledged is blocked",
    () => svc.sendCommand('$X', 'user'),
    'dangerous',
  );
  assert(
    sent.length === 0,
    'controller never received the blocked $X line',
  );

  await expectBlocked(
    "sendCommand('$RST=*', 'user') without acknowledged is blocked",
    () => svc.sendCommand('$RST=*', 'user'),
    'dangerous',
  );

  await expectBlocked(
    "sendCommand('$SLP', 'user') without acknowledged is blocked",
    () => svc.sendCommand('$SLP', 'user'),
    'dangerous',
  );

  // ── User warn without acknowledgement: blocked ───────────────
  sent.length = 0;
  await expectBlocked(
    "sendCommand('$130=400', 'user') without acknowledged is blocked",
    () => svc.sendCommand('$130=400', 'user'),
    'warn',
  );
  assert(
    sent.length === 0,
    'controller never received the blocked $130=400 line',
  );

  await expectBlocked(
    "sendCommand('G10 L2 P1 X0 Y0', 'user') without acknowledged is blocked",
    () => svc.sendCommand('G10 L2 P1 X0 Y0', 'user'),
    'warn',
  );

  await expectBlocked(
    "sendCommand('M3 S500', 'user') without acknowledged is blocked",
    () => svc.sendCommand('M3 S500', 'user'),
    'warn',
  );

  // ── User dangerous WITH matching acknowledgement: allowed ────
  sent.length = 0;
  await svc.sendCommand('$X', 'user', { acknowledged: 'dangerous' });
  assert(
    sent.length === 1 && sent[0]?.cmd === '$X' && sent[0].source === 'user',
    "sendCommand('$X', 'user', { acknowledged: 'dangerous' }) passes through",
  );

  sent.length = 0;
  await svc.sendCommand('$RST=*', 'user', { acknowledged: 'dangerous' });
  assert(
    sent.length === 1 && sent[0]?.cmd === '$RST=*' && sent[0].source === 'user',
    "sendCommand('$RST=*', 'user', { acknowledged: 'dangerous' }) passes through",
  );

  // ── User warn WITH matching acknowledgement: allowed ─────────
  sent.length = 0;
  await svc.sendCommand('$130=400', 'user', { acknowledged: 'warn' });
  assert(
    sent.length === 1 && sent[0]?.cmd === '$130=400' && sent[0].source === 'user',
    "sendCommand('$130=400', 'user', { acknowledged: 'warn' }) passes through",
  );

  sent.length = 0;
  await svc.sendCommand('M3 S500', 'user', { acknowledged: 'warn' });
  assert(
    sent.length === 1 && sent[0]?.cmd === 'M3 S500' && sent[0].source === 'user',
    "sendCommand('M3 S500', 'user', { acknowledged: 'warn' }) passes through",
  );

  // ── Mismatched acknowledgement: blocked ──────────────────────
  // A dangerous command with only 'warn' acknowledged should still be
  // blocked. This catches the case where a caller saw a warn dialog
  // for one command, then tried to reuse the ack for a different
  // (dangerous) command.
  sent.length = 0;
  await expectBlocked(
    "sendCommand('$X', 'user', { acknowledged: 'warn' }) is blocked (mismatch)",
    () => svc.sendCommand('$X', 'user', { acknowledged: 'warn' }),
    'dangerous',
  );
  assert(
    sent.length === 0,
    'controller never received the mismatched-ack $X line',
  );

  // A warn command with 'dangerous' acknowledged should also be
  // blocked. The acknowledgement must match the actual classification
  // exactly — no upcasting "safer" with a "stricter" ack.
  await expectBlocked(
    "sendCommand('$130=400', 'user', { acknowledged: 'dangerous' }) is blocked (mismatch)",
    () => svc.sendCommand('$130=400', 'user', { acknowledged: 'dangerous' }),
    'warn',
  );

  // ── Safe with any acknowledgement: still allowed ─────────────
  sent.length = 0;
  await svc.sendCommand('?', 'user', { acknowledged: 'dangerous' });
  assert(
    sent.length === 1 && sent[0]?.cmd === '?' && sent[0].source === 'user',
    "sendCommand('?', 'user', { acknowledged: 'dangerous' }) passes (safe ignores ack)",
  );

  // ── Error shape ──────────────────────────────────────────────
  // Verify the thrown error carries the structured fields so the UI
  // (and any future programmatic caller) can format messages from
  // the structured data instead of parsing the string.
  try {
    await svc.sendCommand('$X', 'user');
    failed++;
    console.error('  ✗ error shape — expected throw, none thrown');
  } catch (err: unknown) {
    const e = err as {
      code?: string;
      severity?: string;
      reason?: string;
      command?: string;
    };
    assert(e.code === 'COMMAND_BLOCKED', "error has code === 'COMMAND_BLOCKED'");
    assert(e.severity === 'dangerous', "error.severity === 'dangerous' for $X");
    assert(
      typeof e.reason === 'string' && e.reason.length > 0,
      'error.reason is a non-empty string',
    );
    assert(e.command === '$X', "error.command === '$X'");
  }

  // ── Default source remains 'internal' ────────────────────────
  // Existing call sites that omit the source argument must continue
  // to work as before — they're internal calls, not user calls.
  sent.length = 0;
  await svc.sendCommand('M5 S0');
  assert(
    sent.length === 1 && sent[0]?.cmd === 'M5 S0' && sent[0].source === 'internal',
    'sendCommand(cmd) defaults source to internal (no classification)',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
