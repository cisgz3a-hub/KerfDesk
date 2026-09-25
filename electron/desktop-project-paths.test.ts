import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isCanonicalPath,
  MAX_LAUNCH_PROJECT_PATHS,
  projectPathsFromArgv,
  projectPathsFromLaunchData,
  singleInstanceLaunchData,
} from './desktop-project-paths.js';

const win = path.win32;
const posix = path.posix;

describe('projectPathsFromArgv', () => {
  it('takes the project Explorer passes to a packaged Windows launch', () => {
    const argv = ['C:\\Program Files\\KerfDesk\\KerfDesk.exe', 'D:\\Jobs\\Coasters.lf2'];

    expect(
      projectPathsFromArgv(argv, {
        defaultApp: false,
        workingDirectory: 'C:\\Windows\\System32',
        pathApi: win,
      }),
    ).toEqual(['D:\\Jobs\\Coasters.lf2']);
  });

  it('skips Chromium, macOS and native smoke switches and files that are not projects', () => {
    const argv = [
      '/Applications/KerfDesk.app/Contents/MacOS/KerfDesk',
      '--allow-file-access-from-files',
      '-psn_0_12345',
      '--kerfdesk-native-smoke-result=/tmp/result.lf2',
      '/Users/ann/art.svg',
      '/Users/ann/Sign.LBRN2',
    ];

    expect(
      projectPathsFromArgv(argv, { defaultApp: false, workingDirectory: '/', pathApi: posix }),
    ).toEqual(['/Users/ann/Sign.LBRN2']);
  });

  it('skips the app path that `electron .` puts first in development', () => {
    const argv = ['/usr/bin/electron', '.', 'part.lf2'];

    expect(
      projectPathsFromArgv(argv, { defaultApp: true, workingDirectory: '/work', pathApi: posix }),
    ).toEqual(['/work/part.lf2']);
  });

  it('resolves a relative command-line path against the launching directory', () => {
    const argv = ['KerfDesk.exe', '..\\shared\\sign.lf2', 'sign.lf2'];

    expect(
      projectPathsFromArgv(argv, {
        defaultApp: false,
        workingDirectory: 'C:\\Jobs\\today',
        pathApi: win,
      }),
    ).toEqual(['C:\\Jobs\\shared\\sign.lf2', 'C:\\Jobs\\today\\sign.lf2']);
  });

  it('lists a path named twice once and caps a large batch', () => {
    const many = Array.from({ length: MAX_LAUNCH_PROJECT_PATHS + 5 }, (_, i) => `/p/${i}.lf2`);
    const argv = ['kerfdesk', '/p/0.lf2', ...many];

    const paths = projectPathsFromArgv(argv, {
      defaultApp: false,
      workingDirectory: '/',
      pathApi: posix,
    });

    expect(paths).toHaveLength(MAX_LAUNCH_PROJECT_PATHS);
    expect(paths.filter((file) => file === '/p/0.lf2')).toHaveLength(1);
  });

  it('refuses arguments carrying a NUL byte', () => {
    expect(
      projectPathsFromArgv(['kerfdesk', '/tmp/a\0.lf2'], {
        defaultApp: false,
        workingDirectory: '/',
        pathApi: posix,
      }),
    ).toEqual([]);
  });
});

describe('single-instance launch data', () => {
  it('round-trips the resolved paths a second launch sends', () => {
    const data = singleInstanceLaunchData(['C:\\Jobs\\a.lf2', 'C:\\Jobs\\b.lbrn']);

    expect(projectPathsFromLaunchData(data, win)).toEqual(['C:\\Jobs\\a.lf2', 'C:\\Jobs\\b.lbrn']);
  });

  it('returns null for data from a launch that sent none, so argv is used instead', () => {
    expect(projectPathsFromLaunchData(undefined, win)).toBeNull();
    expect(projectPathsFromLaunchData({}, win)).toBeNull();
    expect(projectPathsFromLaunchData({ kerfdeskProjectPaths: 'C:\\a.lf2' }, win)).toBeNull();
  });

  it('drops entries that are not absolute, canonical project paths', () => {
    const data = {
      kerfdeskProjectPaths: [
        'relative.lf2',
        'C:\\Jobs\\..\\Windows\\x.lf2',
        'C:\\Jobs\\notes.txt',
        42,
        'C:\\Jobs\\ok.lf2',
      ],
    };

    expect(projectPathsFromLaunchData(data, win)).toEqual(['C:\\Jobs\\ok.lf2']);
  });
});

describe('isCanonicalPath', () => {
  it('accepts drive, UNC and POSIX absolute paths', () => {
    expect(isCanonicalPath('C:\\Jobs\\sign.lf2', win)).toBe(true);
    expect(isCanonicalPath('\\\\nas\\projects\\sign.lf2', win)).toBe(true);
    expect(isCanonicalPath('/home/ann/sign.lf2', posix)).toBe(true);
  });

  it('refuses relative, dotted, alternate-stream and oversized paths', () => {
    expect(isCanonicalPath('Jobs\\sign.lf2', win)).toBe(false);
    expect(isCanonicalPath('C:\\Jobs\\..\\sign.lf2', win)).toBe(false);
    expect(isCanonicalPath('C:\\Jobs\\notes.txt:hidden.lf2', win)).toBe(false);
    expect(isCanonicalPath('/home/../etc/sign.lf2', posix)).toBe(false);
    expect(isCanonicalPath(`/${'a'.repeat(40_000)}.lf2`, posix)).toBe(false);
  });

  it('allows a colon in a POSIX file name', () => {
    expect(isCanonicalPath('/home/ann/10:30 sign.lf2', posix)).toBe(true);
  });
});
