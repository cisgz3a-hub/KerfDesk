import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  nativeSmokeSupportLogRecordedLaunch,
  probeNativeSmokeDevTools,
  readNativeSmokeConfig,
  readNativeSmokeWebPreferences,
} from './native-smoke.js';

describe('packaged native smoke configuration', () => {
  it('requires both isolated paths for interactive observation and refuses automated qualification', () => {
    const profile = resolve('tmp', 'interactive-profile');
    const result = resolve('tmp', 'interactive-result.json');
    const paths = [
      `--kerfdesk-native-smoke-user-data=${profile}`,
      `--kerfdesk-native-smoke-result=${result}`,
    ];
    expect(() => readNativeSmokeConfig(['--kerfdesk-native-smoke-interactive'])).toThrow(/both/);
    expect(() => readNativeSmokeConfig(['--kerfdesk-native-smoke-interactive', paths[0]!])).toThrow(
      /both/,
    );
    expect(readNativeSmokeConfig([...paths, '--kerfdesk-native-smoke-interactive'])).toEqual({
      userDataPath: profile,
      resultPath: result,
      interactive: true,
    });
    expect(() =>
      readNativeSmokeConfig([
        ...paths,
        '--kerfdesk-native-smoke-interactive',
        '--kerfdesk-native-smoke-licence-phase=offline',
      ]),
    ).toThrow(/cannot run automated/);
  });
  it('leaves ordinary launches on the legacy profile contract', () => {
    expect(readNativeSmokeConfig(['KerfDesk.exe'])).toBeNull();
  });

  it('requires two absolute disposable paths', () => {
    const userData = resolve('tmp', 'native-smoke-user-data');
    const result = resolve('tmp', 'native-smoke-result.json');
    expect(
      readNativeSmokeConfig([
        `--kerfdesk-native-smoke-user-data=${userData}`,
        `--kerfdesk-native-smoke-result=${result}`,
      ]),
    ).toEqual({ userDataPath: userData, resultPath: result });
    expect(() =>
      readNativeSmokeConfig(['--kerfdesk-native-smoke-user-data=relative-path']),
    ).toThrow(/both user-data and result paths/);
  });
});

describe('native smoke runtime preferences', () => {
  it('records the actual runtime values without substituting secure defaults', () => {
    const contents = {
      getLastWebPreferences: vi.fn(function (this: unknown) {
        expect(this).toBe(contents);
        return {
          sandbox: false,
          contextIsolation: false,
          nodeIntegration: true,
          webSecurity: false,
        };
      }),
    };
    expect(readNativeSmokeWebPreferences(contents)).toEqual({
      available: true,
      sandbox: false,
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
      preload: 'not-reported',
    });
    expect(contents.getLastWebPreferences).toHaveBeenCalledOnce();
  });

  it('keeps unavailable methods and missing preference fields unknown', () => {
    expect(readNativeSmokeWebPreferences({})).toEqual({
      available: false,
      sandbox: null,
      contextIsolation: null,
      nodeIntegration: null,
      webSecurity: null,
      preload: 'not-reported',
    });
    expect(readNativeSmokeWebPreferences({ getLastWebPreferences: () => ({}) })).toMatchObject({
      available: true,
      sandbox: null,
      contextIsolation: null,
      nodeIntegration: null,
      webSecurity: null,
    });
  });

  it('records a preload if a future runtime reports one, without assuming omission means absent', () => {
    expect(
      readNativeSmokeWebPreferences({
        getLastWebPreferences: () => ({ preload: '/unexpected-preload.js' }),
      }),
    ).toMatchObject({
      preload: '/unexpected-preload.js',
    });
  });
});

describe('native smoke DevTools runtime probe', () => {
  it('removes the observer and closes DevTools if the open attempt throws', async () => {
    const events = new EventEmitter();
    const contents = Object.assign(events, {
      openDevTools: () => {
        throw new Error('probe failed');
      },
      isDevToolsOpened: () => false,
      closeDevTools: vi.fn(),
    });
    await expect(probeNativeSmokeDevTools(contents)).rejects.toThrow('probe failed');
    expect(contents.closeDevTools).toHaveBeenCalledOnce();
    expect(events.listenerCount('devtools-opened')).toBe(0);
  });

  for (const allowed of [true, false]) {
    it(`records whether opening is ${allowed ? 'allowed' : 'disabled'} and cleans up`, async () => {
      vi.useFakeTimers();
      try {
        const events = new EventEmitter();
        const contents = Object.assign(events, {
          openDevTools: vi.fn(() => {
            if (allowed) events.emit('devtools-opened');
          }),
          // The event remains evidence even if the window closed itself.
          isDevToolsOpened: () => false,
          closeDevTools: vi.fn(),
        });
        const result = probeNativeSmokeDevTools(contents);
        await vi.advanceTimersByTimeAsync(200);
        await expect(result).resolves.toBe(allowed);
        expect(contents.openDevTools).toHaveBeenCalledWith({ mode: 'detach', activate: false });
        expect(contents.closeDevTools).toHaveBeenCalledOnce();
        expect(events.listenerCount('devtools-opened')).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  }
});

describe('native smoke support log evidence', () => {
  it('needs the installed launch recorded in the smoke profile', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'kerfdesk-smoke-log-'));
    try {
      await expect(nativeSmokeSupportLogRecordedLaunch(userData)).resolves.toBe(false);
      await mkdir(join(userData, 'logs'));
      const log = join(userData, 'logs', 'kerfdesk.log');
      await writeFile(
        log,
        '2026-09-29T07:00:00.000Z INFO  [app] KerfDesk 0.9.1 started (development build) on Linux.\n',
      );
      await expect(nativeSmokeSupportLogRecordedLaunch(userData)).resolves.toBe(false);
      await writeFile(
        log,
        '2026-09-29T07:00:00.000Z INFO  [app] KerfDesk 0.9.1 started (installed build) on Linux.\n',
      );
      await expect(nativeSmokeSupportLogRecordedLaunch(userData)).resolves.toBe(true);
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });
});
