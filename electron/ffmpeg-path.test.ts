import { describe, expect, it } from 'vitest';
import { ffmpegMissingReason, findFfmpeg } from './ffmpeg-path';

function search(platform: NodeJS.Platform, pathVariable: string, files: ReadonlyArray<string>) {
  return { platform, pathVariable, isFile: (file: string) => files.includes(file) };
}

describe('finding FFmpeg for network cameras (ADR-551)', () => {
  it('uses the first FFmpeg in an absolute PATH folder, by its full path', () => {
    const found = findFfmpeg(
      search('win32', 'C:\\Windows;"C:\\Tools\\ffmpeg\\bin";D:\\ffmpeg\\bin', [
        'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe',
        'D:\\ffmpeg\\bin\\ffmpeg.exe',
      ]),
    );
    expect(found).toBe('C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe');
  });

  it('never runs a copy from the current folder or another relative folder', () => {
    const planted = ['ffmpeg.exe', '.\\ffmpeg.exe', 'tools\\ffmpeg.exe', '\\ffmpeg.exe'];
    expect(findFfmpeg(search('win32', ';.;tools;\\', planted))).toBeNull();
    expect(findFfmpeg(search('linux', ':.:bin', ['ffmpeg', './ffmpeg', 'bin/ffmpeg']))).toBeNull();
  });

  it('accepts a network share on Windows and absolute folders elsewhere', () => {
    expect(
      findFfmpeg(search('win32', '\\\\server\\tools', ['\\\\server\\tools\\ffmpeg.exe'])),
    ).toBe('\\\\server\\tools\\ffmpeg.exe');
    expect(findFfmpeg(search('darwin', '/usr/bin:/usr/local/bin', ['/usr/local/bin/ffmpeg']))).toBe(
      '/usr/local/bin/ffmpeg',
    );
  });

  it('reports none when PATH has no FFmpeg', () => {
    expect(findFfmpeg(search('win32', 'C:\\Windows', []))).toBeNull();
    expect(
      findFfmpeg({ platform: 'linux', pathVariable: undefined, isFile: () => true }),
    ).toBeNull();
  });

  it('finds Homebrew or MacPorts FFmpeg on a Mac opened from the Finder (ADR-606)', () => {
    const finderPath = '/usr/bin:/bin:/usr/sbin:/sbin';
    expect(findFfmpeg(search('darwin', finderPath, ['/opt/homebrew/bin/ffmpeg']))).toBe(
      '/opt/homebrew/bin/ffmpeg',
    );
    expect(findFfmpeg(search('darwin', finderPath, ['/opt/local/bin/ffmpeg']))).toBe(
      '/opt/local/bin/ffmpeg',
    );
    // PATH still comes first, and other systems keep PATH alone.
    expect(
      findFfmpeg(
        search('darwin', '/Users/me/bin', ['/Users/me/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg']),
      ),
    ).toBe('/Users/me/bin/ffmpeg');
    expect(findFfmpeg(search('linux', '/usr/bin', ['/opt/homebrew/bin/ffmpeg']))).toBeNull();
  });

  it('tells each system how to install FFmpeg', () => {
    expect(ffmpegMissingReason('darwin')).toContain('brew install ffmpeg');
    expect(ffmpegMissingReason('linux')).toContain('sudo apt install ffmpeg');
    expect(ffmpegMissingReason('win32')).toContain('add its bin folder to PATH');
  });
});
