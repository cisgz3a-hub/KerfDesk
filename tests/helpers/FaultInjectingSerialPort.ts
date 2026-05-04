/**
 * T2-13: fault-injecting test transport.
 *
 * Pre-T2-13 the only test transport was `MockSerialPort`, which is the
 * happy-path simulator: writes succeed synchronously, oks come back, the
 * status query returns the live position. None of the failure modes that
 * the safety paths (`safetyOff`, autofocus timeout, reconnect handshake,
 * USB-pull mid-burn) are supposed to handle could be exercised — tests
 * could only verify "M5 was written," not "M5 failure was handled."
 *
 * `FaultInjectingSerialPort` composes `MockSerialPort` and intercepts the
 * write / read paths so each safety test can deterministically simulate
 * the audited failure modes:
 *
 *   1. `reject-write-after-return` — the write API returns success, but
 *       `onError` fires asynchronously after `afterMs`. Models a USB
 *       suspend or browser-serial fault that surfaces after the caller
 *       has moved on.
 *   2. `drop-write` — write resolves but the data never reaches the
 *       simulated controller. No record in `received`, no `ok`. Models a
 *       silently-discarded write under buffer pressure or shoddy drivers.
 *   3. `partial-write` — only the first N bytes of the line are
 *       delivered. The mock processes the truncated line. Models a torn
 *       write at the OS / browser-serial boundary.
 *   4. `close-mid-write` — write delivers the first N bytes then closes
 *       the port. Models a cable yank during a critical write.
 *   5. `omit-ok` — write reaches the mock; the mock's `ok` response is
 *       intercepted and dropped before reaching the user callback.
 *       Models a controller crash after accepting a line.
 *   6. `delay-ok` — `ok` is delayed by `ms` before delivery. Models a
 *       controller under load (buffer drain). Used by safetyOff timeout
 *       tests.
 *   7. `fake-ok` — line is NOT delivered to the mock; an `ok` is
 *       fabricated and pushed to the user callback. Models a friendly
 *       proxy that lies about command execution.
 *   8. `stale-status` — the FIRST `<...>` status line is cached; on
 *       subsequent `?` queries the cached line is replayed instead of
 *       the mock's live status. Models a controller / proxy that hasn't
 *       re-polled since a state change.
 *   9. `buffer-full` — `writeByte` / `writeByteCritical` throw. Models
 *       backpressure during stop / soft-reset.
 *
 * Each fault decision is appended to `injectionLog` for test assertions.
 * Patterns can be scoped via `matching: RegExp` on most modes so a test
 * can target one specific line (e.g. `omit-ok` for `M5`) while letting
 * the rest pass through normally.
 *
 * Lives under `tests/helpers/` so the auto-discovery runner's
 * EXCLUDED_DIRS sentinel (T2-22) skips it as a non-test file.
 *
 * Out of scope: subclassing or replacing MockSerialPort. The harness
 * delegates to a private MockSerialPort instance and intercepts the
 * narrow surface that the audited fault modes touch.
 */

import { MockSerialPort, type SerialPortLike } from '../../src/communication/SerialPort';

export type FaultMode =
  | { kind: 'normal' }
  | { kind: 'reject-write-after-return'; afterMs: number; matching?: RegExp }
  | { kind: 'drop-write'; matching?: RegExp }
  | { kind: 'partial-write'; bytesToWrite: number; matching?: RegExp }
  | { kind: 'close-mid-write'; afterBytes: number; matching?: RegExp }
  | { kind: 'omit-ok'; matching?: RegExp }
  | { kind: 'delay-ok'; ms: number; matching?: RegExp }
  | { kind: 'fake-ok'; matching: RegExp }
  | { kind: 'stale-status' }
  | { kind: 'buffer-full' };

export interface InjectionLogEntry {
  kind: FaultMode['kind'];
  data?: string;
  byte?: number;
  t: number;
}

export class FaultInjectingSerialPort implements SerialPortLike {
  private readonly _mock: MockSerialPort;
  private _fault: FaultMode = { kind: 'normal' };
  private _userDataCallback: ((line: string) => void) | null = null;
  private _userErrorCallback: ((error: Error) => void) | null = null;
  private _userCloseCallback: (() => void) | null = null;

  /** Per-line state for omit-ok / delay-ok across the async hop. */
  private _omitNextOk = false;
  private _delayNextOkMs = 0;

  /** Cached status reply for the stale-status fault mode. */
  private _staleStatusReply: string | null = null;

  /** Test-observable audit trail of injection decisions. */
  readonly injectionLog: InjectionLogEntry[] = [];

  constructor(
    responseGenerator?: (line: string) => string[],
    bed?: { width: number; height: number },
  ) {
    this._mock = new MockSerialPort(responseGenerator, bed);
    this._mock.onData((line) => this._handleIncoming(line));
    this._mock.onError((err) => this._userErrorCallback?.(err));
    this._mock.onClose(() => this._userCloseCallback?.());
  }

  setFault(mode: FaultMode): void {
    this._fault = mode;
    if (mode.kind !== 'stale-status') {
      this._staleStatusReply = null;
    }
  }
  getFault(): FaultMode { return this._fault; }

  /** Underlying mock, exposed so tests can use the legacy ad-hoc fault tools (failNextCriticalWrite, simulateDisconnect, etc.) without duplication. */
  get mock(): MockSerialPort { return this._mock; }

  open(): void { this._mock.open(); }
  get isOpen(): boolean { return this._mock.isOpen; }
  get received(): string[] { return this._mock.received; }
  get sent(): string[] { return this._mock.sent; }
  get realtimeBytes(): number[] { return this._mock.realtimeBytes; }

  write(data: string): void {
    if (this._handleSyncWriteFault(data)) return;
    this._mock.write(data);
  }

  async writeCritical(data: string): Promise<void> {
    if (this._handleSyncWriteFault(data)) return;
    const f = this._fault;
    const line = stripEol(data);
    if (
      f.kind === 'reject-write-after-return' &&
      (!f.matching || f.matching.test(line))
    ) {
      await this._mock.writeCritical(data);
      const afterMs = f.afterMs;
      setTimeout(() => {
        this.injectionLog.push({ kind: 'reject-write-after-return', data: line, t: Date.now() });
        this._userErrorCallback?.(new Error('Simulated async transport failure (after return)'));
      }, afterMs);
      return;
    }
    return this._mock.writeCritical(data);
  }

  writeByte(byte: number): void {
    if (this._fault.kind === 'buffer-full') {
      this.injectionLog.push({ kind: 'buffer-full', byte, t: Date.now() });
      throw new Error('Simulated buffer-full backpressure');
    }
    this._mock.writeByte(byte);
  }

  async writeByteCritical(byte: number): Promise<void> {
    if (this._fault.kind === 'buffer-full') {
      this.injectionLog.push({ kind: 'buffer-full', byte, t: Date.now() });
      throw new Error('Simulated buffer-full backpressure');
    }
    return this._mock.writeByteCritical(byte);
  }

  onData(cb: (line: string) => void): void { this._userDataCallback = cb; }
  onError(cb: (error: Error) => void): void { this._userErrorCallback = cb; }
  onClose(cb: () => void): void { this._userCloseCallback = cb; }

  async close(): Promise<void> { return this._mock.close(); }

  /** Test helper for stale-status: pre-seed the cached reply if the test
   *  wants a deterministic stale value rather than capturing the first
   *  live reply. */
  setStaleStatusReply(reply: string): void {
    this._staleStatusReply = reply;
  }

  /** Returns true if the fault was fully handled and the caller should
   *  NOT pass the data through to the underlying mock. */
  private _handleSyncWriteFault(data: string): boolean {
    const f = this._fault;
    const line = stripEol(data);
    switch (f.kind) {
      case 'normal':
        return false;
      case 'drop-write': {
        if (matchOrAll(f.matching, line)) {
          this.injectionLog.push({ kind: 'drop-write', data: line, t: Date.now() });
          return true;
        }
        return false;
      }
      case 'partial-write': {
        if (matchOrAll(f.matching, line)) {
          const truncated = data.slice(0, f.bytesToWrite);
          this.injectionLog.push({ kind: 'partial-write', data: truncated, t: Date.now() });
          this._mock.write(truncated);
          return true;
        }
        return false;
      }
      case 'close-mid-write': {
        if (matchOrAll(f.matching, line)) {
          const truncated = data.slice(0, f.afterBytes);
          this.injectionLog.push({ kind: 'close-mid-write', data: truncated, t: Date.now() });
          this._mock.write(truncated);
          Promise.resolve().then(() => { void this.close(); });
          return true;
        }
        return false;
      }
      case 'omit-ok': {
        if (matchOrAll(f.matching, line)) {
          this._omitNextOk = true;
        }
        return false;
      }
      case 'delay-ok': {
        if (matchOrAll(f.matching, line)) {
          this._delayNextOkMs = f.ms;
        }
        return false;
      }
      case 'fake-ok': {
        if (f.matching.test(line)) {
          this.injectionLog.push({ kind: 'fake-ok', data: line, t: Date.now() });
          Promise.resolve().then(() => this._userDataCallback?.('ok'));
          return true;
        }
        return false;
      }
      case 'reject-write-after-return': {
        if (matchOrAll(f.matching, line)) {
          this._mock.write(data);
          const afterMs = f.afterMs;
          setTimeout(() => {
            this.injectionLog.push({ kind: 'reject-write-after-return', data: line, t: Date.now() });
            this._userErrorCallback?.(new Error('Simulated async transport failure (after return)'));
          }, afterMs);
          return true;
        }
        return false;
      }
      case 'stale-status':
      case 'buffer-full':
        return false;
    }
  }

  private _handleIncoming(line: string): void {
    if (line === 'ok' && this._omitNextOk) {
      this._omitNextOk = false;
      this.injectionLog.push({ kind: 'omit-ok', data: line, t: Date.now() });
      return;
    }
    if (line === 'ok' && this._delayNextOkMs > 0) {
      const ms = this._delayNextOkMs;
      this._delayNextOkMs = 0;
      this.injectionLog.push({ kind: 'delay-ok', data: `ok (delayed ${ms}ms)`, t: Date.now() });
      setTimeout(() => this._userDataCallback?.(line), ms);
      return;
    }
    if (this._fault.kind === 'stale-status' && line.startsWith('<')) {
      if (this._staleStatusReply === null) {
        // Cache the first status line; deliver it normally so callers see live data once.
        this._staleStatusReply = line;
      } else {
        // Subsequent ?-queries get the cached reply, not the live mock state.
        this.injectionLog.push({ kind: 'stale-status', data: this._staleStatusReply, t: Date.now() });
        this._userDataCallback?.(this._staleStatusReply);
        return;
      }
    }
    this._userDataCallback?.(line);
  }
}

function stripEol(s: string): string {
  return s.replace(/[\r\n]+$/, '');
}

function matchOrAll(re: RegExp | undefined, line: string): boolean {
  return re == null || re.test(line);
}
