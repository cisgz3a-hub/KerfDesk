// The desktop support log (ADR-546). A packaged app has no console, so without
// it a customer has nothing to send when something goes wrong. It keeps the
// main process's messages, each window's console warnings and errors, crashes
// and failed loads in <userData>/logs/kerfdesk.log, with one older file beside
// it. It stays on the computer: Help > Save Support Report puts its newest part
// in a file the customer reads and sends themselves. Licence keys and the
// account's home folder are removed before a line is written.

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { formatWithOptions } from 'node:util';
import type { App, WebContents } from 'electron';

export type SupportLogLevel = 'info' | 'warn' | 'error';

export type SupportLog = {
  readonly write: (level: SupportLogLevel, source: string, message: string) => void;
  /** The newest part of the log, oldest line first, starting on a whole line. */
  readonly recent: (maxBytes?: number) => string;
};

export type SupportLogOptions = {
  readonly directory: string;
  /** The account's home folder, written as `~` so the log carries no user name. */
  readonly home: string;
  readonly maxBytes?: number;
  readonly now?: () => number;
};

export const SUPPORT_LOG_FILE = 'kerfdesk.log';
export const PREVIOUS_SUPPORT_LOG_FILE = 'kerfdesk.1.log';
/** How much of the log a support report carries. */
export const SUPPORT_REPORT_LOG_BYTES = 256 * 1024;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_MESSAGE_CHARS = 4000;
// A window caught in an error loop must not push everything else out of the log.
const BURST_LINES = 200;
const BURST_WINDOW_MS = 60_000;
// KD1.<licence id>.<secret>, the key format the licensing service issues.
const LICENCE_KEY = /\bKD\d+\.[\w-]+\.[\w-]+/g;

type Repeat = { key: string; level: SupportLogLevel; source: string; count: number };

export function createSupportLog(options: SupportLogOptions): SupportLog {
  const file = path.join(options.directory, SUPPORT_LOG_FILE);
  const previous = path.join(options.directory, PREVIOUS_SUPPORT_LOG_FILE);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const now = options.now ?? Date.now;
  const redact = supportLogRedactor(options.home);
  let size: number | null = null;
  let burst = { startedAt: Number.NEGATIVE_INFINITY, lines: 0, skipped: 0 };
  let repeat: Repeat | null = null;

  const append = (line: string): void => {
    try {
      if (size === null) {
        mkdirSync(options.directory, { recursive: true });
        size = fileSize(file);
      }
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) size = rotated(file, previous) ? 0 : size;
      // While another program holds the files, rotation fails: keep a bounded log.
      if (size + bytes > maxBytes * 2) return;
      appendFileSync(file, line);
      size += bytes;
    } catch {
      // A full or read-only disk must never break the app; the line is lost.
    }
  };
  const admitted = (at: number): boolean => {
    if (at - burst.startedAt >= BURST_WINDOW_MS) {
      if (burst.skipped > 0)
        append(logLine(at, 'warn', 'log', `${burst.skipped} lines were left out after a burst.`));
      burst = { startedAt: at, lines: 0, skipped: 0 };
    }
    if (burst.lines >= BURST_LINES) {
      burst.skipped += 1;
      return false;
    }
    burst.lines += 1;
    return true;
  };
  const flushRepeat = (at: number): void => {
    if (repeat === null || repeat.count === 0) return;
    const times = repeat.count === 1 ? 'once more' : `${repeat.count} more times`;
    append(logLine(at, repeat.level, repeat.source, `The previous line repeated ${times}.`));
    repeat.count = 0;
  };

  return {
    write: (level, source, message) => {
      const at = now();
      const text = redact(clip(message));
      const key = `${level}\u0000${source}\u0000${text}`;
      if (repeat?.key === key) {
        repeat.count += 1;
        return;
      }
      flushRepeat(at);
      repeat = { key, level, source, count: 0 };
      if (admitted(at)) append(logLine(at, level, source, text));
    },
    recent: (limit = SUPPORT_REPORT_LOG_BYTES) => {
      flushRepeat(now());
      return newestPart(readText(previous) + readText(file), limit);
    },
  };
}

/** Removes licence keys and writes the home folder as `~`, in either slash style. */
export function supportLogRedactor(home: string): (text: string) => string {
  const homes = [...new Set([home, home.replaceAll('\\', '/')])].filter(
    (value) => value.length > 3,
  );
  const escaped = homes.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Windows paths ignore case; the lookahead keeps C:\Users\Jo from matching C:\Users\Joan.
  const homePattern =
    homes.length === 0 ? null : new RegExp(`(?:${escaped.join('|')})(?![\\w-])`, 'gi');
  return (text) => {
    const withoutKeys = text.replace(LICENCE_KEY, 'KD1.[licence key removed]');
    return homePattern === null ? withoutKeys : withoutKeys.replace(homePattern, '~');
  };
}

export type SupportLogStartup = {
  readonly version: string;
  readonly packaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly release: string;
  readonly arch: string;
  readonly versions: Partial<Record<'electron' | 'chrome' | 'node', string>>;
};

const SYSTEM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

export function supportLogStartupLine(startup: SupportLogStartup): string {
  const { electron, chrome, node } = startup.versions;
  return [
    `KerfDesk ${startup.version} started (${startup.packaged ? 'installed' : 'development'} build)`,
    `on ${SYSTEM_NAMES[startup.platform] ?? startup.platform} ${startup.release} ${startup.arch}.`,
    `Electron ${electron ?? '?'}, Chrome ${chrome ?? '?'}, Node ${node ?? '?'}.`,
  ].join(' ');
}

/**
 * Opens the support log in the app's data folder. Only the primary instance
 * records into it; a second launch that hands a file over and quits does not.
 */
export function startDesktopSupportLog(app: App, dataPath: string, primary: boolean): SupportLog {
  const log = createSupportLog({
    directory: path.join(dataPath, 'logs'),
    home: app.getPath('home'),
  });
  if (primary)
    installSupportLogCapture(app, log, {
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      release: process.getSystemVersion(),
      arch: process.arch,
      versions: process.versions,
    });
  return log;
}

type ConsoleMethods = Pick<Console, 'log' | 'info' | 'warn' | 'error'>;
type ProcessEvents = Pick<NodeJS.Process, 'on'>;
type RecordLine = (level: SupportLogLevel, source: string, message: () => string) => void;

/**
 * Records the main process's console, its uncaught exceptions, every window's
 * console warnings and errors, and crashed or unresponsive processes.
 * Observing never changes how the app behaves.
 */
export function installSupportLogCapture(
  app: App,
  log: SupportLog,
  startup: SupportLogStartup,
  host: { readonly console: ConsoleMethods; readonly process: ProcessEvents } = {
    console,
    process,
  },
): void {
  const record = recorder(log);
  record('info', 'app', () => supportLogStartupLine(startup));
  mirrorConsole(host.console, record);
  host.process.on('uncaughtExceptionMonitor', (error, origin) =>
    record('error', 'main', () => `${origin}: ${formatArgs([error])}`),
  );
  app.on('child-process-gone', (_event, details) =>
    record(
      details.reason === 'clean-exit' ? 'info' : 'error',
      'app',
      () =>
        `${details.name ?? details.type} process ended: ${details.reason} (exit code ${details.exitCode}).`,
    ),
  );
  app.on('render-process-gone', (_event, _contents, details) =>
    record(
      'error',
      'window',
      () => `The window's process ended: ${details.reason} (exit code ${details.exitCode}).`,
    ),
  );
  app.on('web-contents-created', (_event, contents) => watchWindow(contents, record));
  app.on('will-quit', () => record('info', 'app', () => 'KerfDesk quit.'));
}

// Formatting an odd value must never break the code that logged it.
function recorder(log: SupportLog): RecordLine {
  return (level, source, message) => {
    try {
      log.write(level, source, message());
    } catch {
      // The line is lost; the caller carries on.
    }
  };
}

function watchWindow(contents: WebContents, record: RecordLine): void {
  contents.on('console-message', (details) => {
    if (details.level !== 'warning' && details.level !== 'error') return;
    const where = details.sourceId === '' ? '' : ` (${details.sourceId}:${details.lineNumber})`;
    record(
      details.level === 'error' ? 'error' : 'warn',
      'window',
      () => `${details.message}${where}`,
    );
  });
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 is an aborted load, which a new navigation causes on purpose.
    if (!isMainFrame || errorCode === -3) return;
    record(
      'error',
      'window',
      () => `Could not load ${validatedURL}: ${errorDescription} (${errorCode}).`,
    );
  });
  contents.on('preload-error', (_event, preloadPath, error) =>
    record('error', 'window', () => `Preload script ${preloadPath} failed: ${formatArgs([error])}`),
  );
  contents.on('unresponsive', () =>
    record('warn', 'window', () => 'The window stopped responding.'),
  );
  contents.on('responsive', () => record('info', 'window', () => 'The window responds again.'));
}

function mirrorConsole(target: ConsoleMethods, record: RecordLine): void {
  const levels = { log: 'info', info: 'info', warn: 'warn', error: 'error' } as const;
  for (const [method, level] of Object.entries(levels) as Array<
    [keyof ConsoleMethods, SupportLogLevel]
  >) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]): void => {
      original(...args);
      record(level, 'main', () => formatArgs(args));
    };
  }
}

function formatArgs(args: ReadonlyArray<unknown>): string {
  return formatWithOptions({ colors: false, depth: 3, breakLength: Infinity }, ...args);
}

function logLine(at: number, level: SupportLogLevel, source: string, message: string): string {
  const text = message.replace(/\r?\n/g, '\n    ');
  return `${new Date(at).toISOString()} ${level.toUpperCase().padEnd(5)} [${source}] ${text}\n`;
}

function clip(message: string): string {
  return message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}…` : message;
}

function newestPart(text: string, limit: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength <= limit) return text;
  const tail = bytes.subarray(bytes.byteLength - limit).toString('utf8');
  const lineStart = tail.indexOf('\n');
  return lineStart === -1 ? tail : tail.slice(lineStart + 1);
}

function rotated(file: string, previous: string): boolean {
  try {
    renameSync(file, previous);
    return true;
  } catch {
    return false;
  }
}

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
