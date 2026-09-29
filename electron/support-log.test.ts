// @vitest-environment node
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { App } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSupportLog,
  installSupportLogCapture,
  PREVIOUS_SUPPORT_LOG_FILE,
  SUPPORT_LOG_FILE,
  supportLogRedactor,
  supportLogStartupLine,
  type SupportLogStartup,
} from './support-log';

const T0 = Date.UTC(2026, 8, 29, 7, 0, 0);
const STARTUP: SupportLogStartup = {
  version: '0.9.1',
  packaged: true,
  platform: 'win32',
  release: '10.0.26100',
  arch: 'x64',
  versions: { electron: '44.0.0', chrome: '146.0.0.0', node: '24.1.0' },
};

let directory: string;
let clock: number;

beforeEach(async () => {
  directory = path.join(await mkdtemp(path.join(tmpdir(), 'kerfdesk-support-log-')), 'logs');
  clock = T0;
});

afterEach(async () => {
  await rm(path.dirname(directory), { recursive: true, force: true });
});

function logAt(options: { readonly maxBytes?: number; readonly home?: string } = {}) {
  return createSupportLog({
    directory,
    home: options.home ?? 'C:\\Users\\Johann',
    now: () => clock,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

describe('support log', () => {
  it('writes timed lines with their level and source, creating the folder', () => {
    const log = logAt();
    log.write('warn', 'main', 'Desktop update check failed.');
    log.write('error', 'window', 'TypeError: x is undefined\n    at draw (index.js:1)');

    expect(readFileSync(path.join(directory, SUPPORT_LOG_FILE), 'utf8')).toBe(
      '2026-09-29T07:00:00.000Z WARN  [main] Desktop update check failed.\n' +
        '2026-09-29T07:00:00.000Z ERROR [window] TypeError: x is undefined\n' +
        '        at draw (index.js:1)\n',
    );
  });

  it('never keeps a licence key or the account name', () => {
    const log = logAt();
    log.write('error', 'main', 'Activation of KD1.lic_42.s3cr3t-Value failed');
    log.write('info', 'main', 'Opened c:\\users\\johann\\Documents\\sign.lf2');
    log.write('info', 'window', 'Loaded file:///C:/Users/Johann/AppData/x.png');

    const text = log.recent();
    expect(text).not.toMatch(/s3cr3t|lic_42|johann/i);
    expect(text).toContain('Activation of KD1.[licence key removed] failed');
    expect(text).toContain('Opened ~\\Documents\\sign.lf2');
    expect(text).toContain('Loaded file:///~/AppData/x.png');
  });

  it('leaves a longer account name that only starts with the home folder alone', () => {
    const redact = supportLogRedactor('/Users/jo');
    expect(redact('/Users/jo/a.svg and /Users/joan/b.svg')).toBe('~/a.svg and /Users/joan/b.svg');
  });

  it('folds a repeated line into a count', () => {
    const log = logAt();
    for (let index = 0; index < 5; index += 1) log.write('error', 'window', 'Frame failed');
    log.write('info', 'main', 'Next');
    log.write('info', 'main', 'Last');
    log.write('info', 'main', 'Last');

    expect(lines(log.recent()).map((line) => line.slice(25))).toEqual([
      'ERROR [window] Frame failed',
      'ERROR [window] The previous line repeated 4 more times.',
      'INFO  [main] Next',
      'INFO  [main] Last',
      'INFO  [main] The previous line repeated once more.',
    ]);
  });

  it('keeps one older file and reads both, newest last', () => {
    const log = logAt({ maxBytes: 200 });
    for (let index = 1; index <= 6; index += 1)
      log.write('info', 'main', `Line ${index} ${'x'.repeat(40)}`);

    expect(existsSync(path.join(directory, PREVIOUS_SUPPORT_LOG_FILE))).toBe(true);
    const numbers = lines(log.recent()).map((line) => Number(/Line (\d)/.exec(line)?.[1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers.at(-1)).toBe(6);
    expect(readFileSync(path.join(directory, SUPPORT_LOG_FILE), 'utf8').length).toBeLessThanOrEqual(
      200,
    );
  });

  it('returns only the newest part of the log, from a whole line', () => {
    const log = logAt();
    for (let index = 0; index < 50; index += 1) log.write('info', 'main', `Entry ${index}`);

    const recent = log.recent(300);
    expect(Buffer.byteLength(recent)).toBeLessThanOrEqual(300);
    expect(recent.startsWith('2026-09-29T')).toBe(true);
    expect(recent.trimEnd().endsWith('Entry 49')).toBe(true);
  });

  it('leaves out a burst of lines and says how many', () => {
    const log = logAt();
    for (let index = 0; index < 250; index += 1) log.write('error', 'window', `Loop ${index}`);
    clock += 61_000;
    log.write('info', 'main', 'Calm again');

    const recent = lines(log.recent());
    expect(recent).toHaveLength(202);
    expect(recent[199]).toContain('Loop 199');
    expect(recent[200]).toContain('50 lines were left out after a burst.');
    expect(recent[201]).toContain('Calm again');
  });

  it('shortens a very long message', () => {
    const log = logAt();
    log.write('error', 'window', 'y'.repeat(10_000));
    expect(log.recent().length).toBeLessThan(4200);
    expect(log.recent().trimEnd().endsWith('…')).toBe(true);
  });

  it('never throws when the log folder cannot be written', () => {
    writeFileSync(directory, 'not a folder');
    const log = logAt();
    expect(() => log.write('error', 'main', 'Lost')).not.toThrow();
    expect(log.recent()).toBe('');
  });
});

describe('support log capture', () => {
  function captured() {
    const app = new EventEmitter();
    const host = {
      console: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      process: new EventEmitter(),
    };
    const originals = { ...host.console };
    const log = logAt();
    installSupportLogCapture(app as unknown as App, log, STARTUP, {
      console: host.console,
      process: host.process as unknown as NodeJS.Process,
    });
    return { app, host, originals, log };
  }

  it('starts with the version and system, and records the quit', () => {
    const { app, log } = captured();
    app.emit('will-quit');
    const recent = lines(log.recent());
    expect(recent[0]).toContain(
      '[app] KerfDesk 0.9.1 started (installed build) on Windows 10.0.26100 x64. Electron 44.0.0, Chrome 146.0.0.0, Node 24.1.0.',
    );
    expect(recent.at(-1)).toContain('[app] KerfDesk quit.');
  });

  it('mirrors the main console and still prints it', () => {
    const { host, originals, log } = captured();
    host.console.warn('Desktop project route failed:', new Error('disk gone'));
    host.console.log('[serial] select-serial-port fired; 0 port(s) visible to OS.');

    expect(originals.warn).toHaveBeenCalledOnce();
    expect(originals.log).toHaveBeenCalledOnce();
    const recent = log.recent();
    expect(recent).toContain('WARN  [main] Desktop project route failed: Error: disk gone');
    expect(recent).toContain(
      'INFO  [main] [serial] select-serial-port fired; 0 port(s) visible to OS.',
    );
  });

  it('never lets a value that cannot be printed break the code that logged it', () => {
    const { host, originals, log } = captured();
    const hostile = {
      [Symbol.for('nodejs.util.inspect.custom')]: () => {
        throw new Error('cannot print');
      },
    };
    expect(() => host.console.error('Odd value:', hostile)).not.toThrow();
    expect(originals.error).toHaveBeenCalledOnce();
    host.console.warn('Still logging');
    expect(log.recent()).toContain('WARN  [main] Still logging');
  });

  it('records uncaught exceptions and ended processes', () => {
    const { app, host, log } = captured();
    host.process.emit('uncaughtExceptionMonitor', new Error('main broke'), 'uncaughtException');
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 5 });
    app.emit(
      'child-process-gone',
      {},
      { type: 'Utility', name: 'Network Service', reason: 'clean-exit', exitCode: 0 },
    );
    app.emit('render-process-gone', {}, {}, { reason: 'oom', exitCode: -1 });

    const recent = log.recent();
    expect(recent).toContain('ERROR [main] uncaughtException: Error: main broke');
    expect(recent).toContain('ERROR [app] GPU process ended: crashed (exit code 5).');
    expect(recent).toContain(
      'INFO  [app] Network Service process ended: clean-exit (exit code 0).',
    );
    expect(recent).toContain("ERROR [window] The window's process ended: oom (exit code -1).");
  });

  it("records a window's console warnings and errors, failed loads and hangs", () => {
    const { app, log } = captured();
    const contents = new EventEmitter();
    app.emit('web-contents-created', {}, contents);
    const message = (level: string, text: string): void => {
      contents.emit('console-message', {
        level,
        message: text,
        lineNumber: 12,
        sourceId: 'app://app/assets/index.js',
      });
    };
    message('info', 'Loaded');
    message('warning', 'Slow frame');
    message('error', 'Uncaught TypeError: boom');
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'app://app/index.html', true);
    contents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'app://app/frame.html', false);
    contents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'app://app/index.html', true);
    contents.emit('unresponsive');
    contents.emit('responsive');

    expect(
      lines(log.recent())
        .slice(1)
        .map((line) => line.slice(25)),
    ).toEqual([
      'WARN  [window] Slow frame (app://app/assets/index.js:12)',
      'ERROR [window] Uncaught TypeError: boom (app://app/assets/index.js:12)',
      'ERROR [window] Could not load app://app/index.html: ERR_FILE_NOT_FOUND (-6).',
      'WARN  [window] The window stopped responding.',
      'INFO  [window] The window responds again.',
    ]);
  });
});

describe('support log startup line', () => {
  it('names macOS and a development build', () => {
    expect(
      supportLogStartupLine({
        ...STARTUP,
        packaged: false,
        platform: 'darwin',
        release: '24.1.0',
        arch: 'arm64',
      }),
    ).toBe(
      'KerfDesk 0.9.1 started (development build) on macOS 24.1.0 arm64. Electron 44.0.0, Chrome 146.0.0.0, Node 24.1.0.',
    );
  });
});
