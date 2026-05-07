/**
 * MachineService.sendCommand: T1-19 service-layer approval-token gating.
 *
 * History:
 *   - Before T1-6 the service was a pass-through; gating of user-typed
 *     commands was the UI's job alone. Any future caller — script
 *     panel, MCP tool, automation, dev console misuse — could call
 *     sendCommand(cmd, 'user') and silently execute $X or $RST=*.
 *   - T1-6 added a service-layer gate keyed on a per-call
 *     `acknowledged: severity` flag in the options bag. Defense in
 *     depth, but the flag itself was just a string the caller
 *     supplied — once a flow knew the right severity, it could send
 *     any number of dangerous commands.
 *   - T1-19 (this test) replaces the flag with a single-use,
 *     command-bound, time-limited approval token. The service is the
 *     issuer: callers must call `requestApproval(cmd)` to get a token
 *     and the service ties the token to that exact command, that
 *     exact severity classification, and a 30 s expiry. Every
 *     successful send consumes the nonce; replays fail.
 *
 * The UI flow:
 *   1. classifyUserCommand(cmd) → severity
 *   2. if warn/dangerous, show confirm dialog
 *   3. on approval, token = requestApproval(cmd); call
 *      sendCommand(cmd, 'user', token)
 *   4. on rejection, do not send
 *
 * Run: npx tsx tests/machine-service-user-sendcommand.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { type ApprovalToken } from '../src/app/MachineCommandGateway';
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
  sendCommand: (cmd: string, source?: "internal" | "user") => {
    sent.push({ cmd, source: source ?? 'internal' });
  },
  requestStatusReport: () => {},
  onStateChange: () => () => {},
  onProgress: () => () => {},
  onError: () => () => {},
  onRawLine: () => () => {},
  safetyOff: async () => ({ stage: 'm5' as const }),
} as unknown as LaserController;

const controllerRef = { current: mockController } as { current: LaserController };
const portRef = { current: null } as { current: SerialPortLike | null };

// Each section creates its own service so consumed-nonce state from
// earlier tests doesn't leak. The set is small per-section.
function makeService(): MachineService {
  return new MachineService(controllerRef, portRef);
}

async function expectBlocked(
  description: string,
  fn: () => Promise<void>,
  expectedSeverity: 'warn' | 'dangerous',
  expectedBlockReason: 'no-token' | 'token-mismatch' | 'token-expired' | 'token-replayed',
): Promise<void> {
  try {
    await fn();
    failed++;
    console.error(`  ✗ ${description} — expected throw, none thrown`);
  } catch (err: unknown) {
    const e = err as {
      code?: string;
      severity?: string;
      blockReason?: string;
      message?: string;
    };
    if (
      e.code === 'COMMAND_BLOCKED'
      && e.severity === expectedSeverity
      && e.blockReason === expectedBlockReason
    ) {
      passed++;
      console.log(`  ✓ ${description}`);
    } else {
      failed++;
      console.error(
        `  ✗ ${description} — wrong error: code=${e.code} severity=${e.severity} blockReason=${e.blockReason} msg=${e.message}`,
      );
    }
  }
}

async function run(): Promise<void> {
  console.log('\n=== machine-service approval tokens (T1-19) ===\n');

  // ── classifier proxy unchanged ────────────────────────────────
  {
    const svc = makeService();
    const a = svc.classifyUserCommand('$X');
    const b = classifyUserCommand('$X');
    assert(
      a.severity === b.severity && a.command === b.command,
      'classifyUserCommand still proxies the shared classifier',
    );
  }

  // ── requestApproval shape ─────────────────────────────────────
  {
    const svc = makeService();

    const safe = svc.requestApproval('?');
    assert(safe === null, 'requestApproval(safe command) returns null');

    const safe2 = svc.requestApproval('G0 X10');
    assert(safe2 === null, 'requestApproval("G0 X10") returns null (safe)');

    const dangerous = svc.requestApproval('$X');
    assert(dangerous !== null, 'requestApproval("$X") returns a token');
    if (dangerous) {
      assert(dangerous.command === '$X', 'token.command === "$X"');
      assert(typeof dangerous.nonce === 'string' && dangerous.nonce.length > 0, 'token.nonce is non-empty string');
      assert(typeof dangerous.expiresAt === 'number' && dangerous.expiresAt > Date.now(), 'token.expiresAt is in the future');
      // 30 s TTL: the issued token expires within 31 s of now (allows for clock jitter).
      assert(dangerous.expiresAt - Date.now() <= 31_000, 'token.expiresAt is within 31s of now (~30s TTL)');
    }

    const warn = svc.requestApproval('$130=400');
    assert(warn !== null, 'requestApproval("$130=400") returns a token');
    if (warn) {
      assert(warn.command === '$130=400', 'warn token.command matches');
    }

    // Two tokens for the same command have different nonces
    const dangerousAgain = svc.requestApproval('$X');
    if (dangerous && dangerousAgain) {
      assert(dangerous.nonce !== dangerousAgain.nonce, 'two tokens for the same command have different nonces');
    }

    // requestApproval normalises the command (whitespace strip, case rules per the classifier)
    const trimmed = svc.requestApproval('   $X   ');
    if (trimmed) {
      assert(trimmed.command === '$X', 'requestApproval trims whitespace via the classifier');
    }
  }

  // ── safe lines bypass tokens entirely ─────────────────────────
  {
    const svc = makeService();
    sent.length = 0;
    await svc.sendCommand('?', 'user');
    assert(
      sent.length === 1 && sent[0]?.cmd === '?' && sent[0].source === 'user',
      "sendCommand('?', 'user') passes through (safe class, no token needed)",
    );
    await svc.sendCommand('G0 X10', 'user');
    await svc.sendCommand('$$', 'user');
    assert(sent.length === 3, '3 safe lines all reached the controller');
  }

  // ── internal source bypasses the gate entirely ────────────────
  {
    const svc = makeService();
    sent.length = 0;
    await svc.sendCommand('$X', 'internal');
    await svc.sendCommand('$RST=*', 'internal');
    await svc.sendCommand('M3 S1000', 'internal');
    assert(
      sent.length === 3
        && sent[0]?.cmd === '$X' && sent[0].source === 'internal'
        && sent[1]?.cmd === '$RST=*' && sent[1].source === 'internal'
        && sent[2]?.cmd === 'M3 S1000' && sent[2].source === 'internal',
      'internal source: dangerous/warn lines all pass through (framework owns these gates)',
    );
  }

  // ── user dangerous WITHOUT token: blocked ─────────────────────
  {
    const svc = makeService();
    sent.length = 0;
    await expectBlocked(
      "sendCommand('$X', 'user') without token → no-token",
      () => svc.sendCommand('$X', 'user'),
      'dangerous',
      'no-token',
    );
    await expectBlocked(
      "sendCommand('$RST=*', 'user') without token → no-token",
      () => svc.sendCommand('$RST=*', 'user'),
      'dangerous',
      'no-token',
    );
    await expectBlocked(
      "sendCommand('$SLP', 'user') without token → no-token",
      () => svc.sendCommand('$SLP', 'user'),
      'dangerous',
      'no-token',
    );
    assert(sent.length === 0, 'controller never received any blocked-no-token line');
  }

  // ── user warn WITHOUT token: blocked ──────────────────────────
  {
    const svc = makeService();
    sent.length = 0;
    await expectBlocked(
      "sendCommand('$130=400', 'user') without token → no-token",
      () => svc.sendCommand('$130=400', 'user'),
      'warn',
      'no-token',
    );
    await expectBlocked(
      "sendCommand('M3 S500', 'user') without token → no-token",
      () => svc.sendCommand('M3 S500', 'user'),
      'warn',
      'no-token',
    );
    assert(sent.length === 0, 'controller never received any blocked warn line');
  }

  // ── user dangerous WITH valid token: passes ───────────────────
  {
    const svc = makeService();
    sent.length = 0;
    const token = svc.requestApproval('$X')!;
    await svc.sendCommand('$X', 'user', token);
    assert(
      sent.length === 1 && sent[0]?.cmd === '$X' && sent[0].source === 'user',
      "sendCommand('$X', 'user', validToken) passes through",
    );
  }

  // ── user warn WITH valid token: passes ────────────────────────
  {
    const svc = makeService();
    sent.length = 0;
    const token = svc.requestApproval('$130=400')!;
    await svc.sendCommand('$130=400', 'user', token);
    assert(
      sent.length === 1 && sent[0]?.cmd === '$130=400' && sent[0].source === 'user',
      "sendCommand('$130=400', 'user', validToken) passes through",
    );
  }

  // ── token bound to one command can't authorize another ────────
  {
    const svc = makeService();
    sent.length = 0;
    const tokenForX = svc.requestApproval('$X')!;
    await expectBlocked(
      "token for $X used to send $RST=* → token-mismatch",
      () => svc.sendCommand('$RST=*', 'user', tokenForX),
      'dangerous',
      'token-mismatch',
    );
    await expectBlocked(
      "token for $X used to send $130=400 → token-mismatch",
      () => svc.sendCommand('$130=400', 'user', tokenForX),
      'warn',
      'token-mismatch',
    );
    assert(sent.length === 0, 'controller never received the mismatched-token lines');

    // The token is still valid for its own command
    await svc.sendCommand('$X', 'user', tokenForX);
    assert(
      sent.length === 1 && sent[0]?.cmd === '$X',
      "token still works for its bound command after rejected mismatched uses",
    );
  }

  // ── single-use: same nonce can't be replayed ─────────────────
  {
    const svc = makeService();
    sent.length = 0;
    const token = svc.requestApproval('$X')!;
    await svc.sendCommand('$X', 'user', token);
    assert(sent.length === 1, 'first use of token consumes the nonce');

    await expectBlocked(
      "second use of same token → token-replayed",
      () => svc.sendCommand('$X', 'user', token),
      'dangerous',
      'token-replayed',
    );
    assert(sent.length === 1, 'controller did not receive the replayed second send');

    // Even a fabricated token with the same nonce but otherwise valid
    // shape is rejected — the consumed-nonce set is the source of
    // truth, not the token contents.
    const fabricated: ApprovalToken = {
      command: '$X',
      expiresAt: Date.now() + 30_000,
      nonce: token.nonce,
    };
    await expectBlocked(
      "fabricated token reusing a consumed nonce → token-replayed",
      () => svc.sendCommand('$X', 'user', fabricated),
      'dangerous',
      'token-replayed',
    );
  }

  // ── expired token blocked ────────────────────────────────────
  {
    const svc = makeService();
    sent.length = 0;
    // Construct a token that's already past its expiresAt. requestApproval
    // mints fresh ones; for this test we forge one with a past expiry.
    // The service trusts the issued shape but checks the expiresAt clock,
    // so an old token (or one tampered to look old) is rejected.
    const expired: ApprovalToken = {
      command: '$X',
      expiresAt: Date.now() - 1, // 1 ms in the past
      nonce: 'expired-test-nonce-not-used',
    };
    await expectBlocked(
      "token with expiresAt in the past → token-expired",
      () => svc.sendCommand('$X', 'user', expired),
      'dangerous',
      'token-expired',
    );
    assert(sent.length === 0, 'controller did not receive the expired-token line');
  }

  // ── error shape: structured fields populated ─────────────────
  {
    const svc = makeService();
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
        blockReason?: string;
      };
      assert(e.code === 'COMMAND_BLOCKED', "error.code === 'COMMAND_BLOCKED'");
      assert(e.severity === 'dangerous', "error.severity === 'dangerous' for $X");
      assert(typeof e.reason === 'string' && e.reason.length > 0, 'error.reason is a non-empty string');
      assert(e.command === '$X', "error.command === '$X'");
      assert(e.blockReason === 'no-token', "error.blockReason === 'no-token' for missing token");
    }
  }

  // ── default source remains 'internal' ────────────────────────
  {
    const svc = makeService();
    sent.length = 0;
    await svc.sendCommand('M5 S0');
    assert(
      sent.length === 1 && sent[0]?.cmd === 'M5 S0' && sent[0].source === 'internal',
      'sendCommand(cmd) defaults source to internal (no classification)',
    );
  }

  // ── two tokens at once: first consumed, second still valid ──
  {
    const svc = makeService();
    sent.length = 0;
    const t1 = svc.requestApproval('$X')!;
    const t2 = svc.requestApproval('$X')!;
    assert(t1.nonce !== t2.nonce, 'two tokens for the same command have distinct nonces');

    await svc.sendCommand('$X', 'user', t1);
    assert(sent.length === 1, 'first token consumed → command sent');

    await svc.sendCommand('$X', 'user', t2);
    assert(sent.length === 2, 'second token still works (independent nonce)');

    // Re-using t1 still fails
    await expectBlocked(
      "after both consumed, t1 replay → token-replayed",
      () => svc.sendCommand('$X', 'user', t1),
      'dangerous',
      'token-replayed',
    );
  }

  // ── no-token bypass via empty object ────────────────────────
  // Catches a regression class where someone replaces `undefined` with
  // an empty `{}` thinking that's the no-token state, and the type
  // erodes silently.
  {
    const svc = makeService();
    sent.length = 0;
    // @ts-expect-error: intentionally malformed token
    const malformed: ApprovalToken = {};
    await expectBlocked(
      'malformed token (missing command/nonce/expiresAt) → token-mismatch',
      () => svc.sendCommand('$X', 'user', malformed),
      'dangerous',
      'token-mismatch',
    );
    assert(sent.length === 0, 'controller did not receive the malformed-token line');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
