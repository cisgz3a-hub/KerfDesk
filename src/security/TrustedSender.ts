/**
 * T2-119: IPC sender verification — `assertTrustedSender` in every
 * handler. Pre-T2-119 cross-check verified zero hits for
 * `senderFrame`, `event.sender`, `assertTrustedSender` in
 * `electron/main.ts` — every IPC handler accepted requests from
 * any frame. If a future bug introduced an iframe, webview,
 * redirect, or any non-app frame, every privileged IPC was
 * reachable.
 *
 * Audit 5D Critical failure 5 + Required Priority 3.
 *
 * T2-119 ships the verification primitive (typed environment +
 * trust evaluator + telemetry-friendly result + decision message)
 * + a guard helper that adopts cleanly into every `ipcMain.handle`.
 * Applying the guard at every handler site is filed as
 * T2-119-followup since it's a per-handler review across ~15 sites.
 *
 * This module is renderer-safe (pure logic, no Electron import) so
 * tests can run under tsx without electron in the dev tree. The
 * actual `ipcMain.handle` wiring lives in electron/security.ts.
 */

export type AppEnvironment =
  | { kind: 'packaged' }
  | { kind: 'dev'; expectedDevOrigin: string }
  | { kind: 'test' };

export type SenderFrame = { readonly url: string };

export type TrustReason =
  | 'packaged-file-url'
  | 'dev-localhost-origin'
  | 'test-environment'
  | 'unknown-scheme'
  | 'untrusted-origin'
  | 'no-frame'
  | 'frame-url-malformed';

export type TrustResult =
  | { trusted: true; reason: TrustReason }
  | { trusted: false; reason: TrustReason; observedUrl: string };

/**
 * Pure trust evaluation. Reusable from main + renderer + tests.
 * Audit-derived rules:
 *   - packaged build: only `file://` URLs trusted
 *   - dev build: only the configured dev-server origin trusted
 *   - test: always trusted (deterministic)
 *
 * Anything else (http/https, devtools, blob:, data:, file:// in
 * dev, etc.) is rejected with a typed reason so the test surface
 * can pin "exactly this configuration is rejected".
 */
export function evaluateSenderTrust(opts: {
  env: AppEnvironment;
  frame: SenderFrame | null | undefined;
}): TrustResult {
  if (opts.env.kind === 'test') {
    return { trusted: true, reason: 'test-environment' };
  }
  if (opts.frame == null) {
    return { trusted: false, reason: 'no-frame', observedUrl: '<no-frame>' };
  }
  const url = opts.frame.url;
  if (typeof url !== 'string' || url.length === 0) {
    return { trusted: false, reason: 'frame-url-malformed', observedUrl: String(url) };
  }
  if (opts.env.kind === 'packaged') {
    if (url.startsWith('file://')) {
      return { trusted: true, reason: 'packaged-file-url' };
    }
    return { trusted: false, reason: 'untrusted-origin', observedUrl: url };
  }
  // dev
  const expected = opts.env.expectedDevOrigin;
  if (url.startsWith(expected)) {
    return { trusted: true, reason: 'dev-localhost-origin' };
  }
  if (!url.startsWith('http://') && !url.startsWith('https://') &&
      !url.startsWith('file://')) {
    return { trusted: false, reason: 'unknown-scheme', observedUrl: url };
  }
  return { trusted: false, reason: 'untrusted-origin', observedUrl: url };
}

/**
 * Throwing guard. The audit's "apply at the top of every handler"
 * pattern. The thrown error contains the observed URL so logs +
 * crash reports can identify the offending frame.
 */
export class UntrustedSenderError extends Error {
  constructor(public readonly result: Extract<TrustResult, { trusted: false }>) {
    super(`Blocked IPC from untrusted sender: ${result.observedUrl} (${result.reason})`);
    this.name = 'UntrustedSenderError';
  }
}

export function assertSenderTrustResult(result: TrustResult): void {
  if (!result.trusted) throw new UntrustedSenderError(result);
}

/** Single-call form: evaluate + throw on untrusted. */
export function assertTrustedSenderFrame(opts: {
  env: AppEnvironment;
  frame: SenderFrame | null | undefined;
}): void {
  assertSenderTrustResult(evaluateSenderTrust(opts));
}

/** User-facing diagnostic message — used by logs, crash reports, telemetry. */
export function describeTrustResult(result: TrustResult): string {
  if (result.trusted) {
    return `Trusted IPC sender (${result.reason}).`;
  }
  switch (result.reason) {
    case 'no-frame':
      return 'IPC blocked — request had no senderFrame (probably a worker or non-frame context).';
    case 'frame-url-malformed':
      return `IPC blocked — sender frame URL is malformed: ${result.observedUrl}`;
    case 'unknown-scheme':
      return `IPC blocked — sender frame uses an unknown URL scheme: ${result.observedUrl}`;
    case 'untrusted-origin':
      return `IPC blocked — sender frame origin is not allowed: ${result.observedUrl}`;
    default:
      return `IPC blocked: ${result.observedUrl}`;
  }
}

/**
 * Audit-recommended grep test contract: every `ipcMain.handle` line
 * in `electron/main.ts` MUST be followed by an `assertTrustedSender`
 * call within `windowLines` lines. Pure helper so tests can drive
 * the contract from a static file read without spawning grep.
 */
export interface HandlerCoverageReport {
  readonly totalHandlers: number;
  readonly guarded: number;
  readonly unguarded: { readonly line: number; readonly snippet: string }[];
}

export function checkHandlerCoverage(opts: {
  source: string;
  guardName?: string;
  windowLines?: number;
}): HandlerCoverageReport {
  const guard = opts.guardName ?? 'assertTrustedSender';
  const window = opts.windowLines ?? 5;
  const lines = opts.source.split('\n');
  const handlers: { line: number; snippet: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('ipcMain.handle')) {
      handlers.push({ line: i + 1, snippet: lines[i].trim() });
    }
  }
  const unguarded: { line: number; snippet: string }[] = [];
  for (const h of handlers) {
    let guarded = false;
    const startIdx = h.line - 1;
    const endIdx = Math.min(lines.length, startIdx + window + 1);
    for (let j = startIdx; j < endIdx; j++) {
      if (lines[j].includes(guard)) { guarded = true; break; }
    }
    if (!guarded) unguarded.push(h);
  }
  return {
    totalHandlers: handlers.length,
    guarded: handlers.length - unguarded.length,
    unguarded,
  };
}
