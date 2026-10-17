// Where FFmpeg is, for network (RTSP) cameras (ADR-551). KerfDesk does not
// ship FFmpeg, so it runs one the customer installed, found only in the
// absolute folders on PATH and started by its full path. A bare `ffmpeg`
// would also run a copy sitting in the current folder on Windows, and that
// folder can be wherever a project was double-clicked, such as Downloads.
// An app opened from the Finder or the Dock gets macOS's short default PATH,
// which leaves out Homebrew and MacPorts, so on a Mac their fixed folders are
// searched after PATH (ADR-607).

import { statSync } from 'node:fs';
import * as path from 'node:path';

const FFMPEG_INSTALL_STEPS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'Install FFmpeg with Homebrew (brew install ffmpeg) or MacPorts, then restart KerfDesk.',
  linux:
    'Install FFmpeg from your distribution (for example sudo apt install ffmpeg), then restart ' +
    'KerfDesk.',
};

/** What the operator reads when no FFmpeg was found, worded for their system. */
export function ffmpegMissingReason(platform: NodeJS.Platform): string {
  const steps =
    FFMPEG_INSTALL_STEPS[platform] ??
    'Install FFmpeg, add its bin folder to PATH, then restart KerfDesk.';
  return `Network cameras need FFmpeg, which is not installed. ${steps}`;
}

export const FFMPEG_MISSING_REASON = ffmpegMissingReason(process.platform);

// Homebrew on Apple silicon, then Homebrew on Intel, then MacPorts.
const MAC_PACKAGE_FOLDERS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];

export type FfmpegSearch = {
  readonly platform: NodeJS.Platform;
  readonly pathVariable: string | undefined;
  readonly isFile: (file: string) => boolean;
};

const NODE_FFMPEG_SEARCH: FfmpegSearch = {
  platform: process.platform,
  pathVariable: process.env.PATH,
  isFile: (file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  },
};

/** The full path of the first FFmpeg in an absolute PATH folder (then, on a Mac, a
 * package manager's folder), or null. */
export function findFfmpeg(search: FfmpegSearch = NODE_FFMPEG_SEARCH): string | null {
  const windows = search.platform === 'win32';
  const pathApi = windows ? path.win32 : path.posix;
  const entries = (search.pathVariable ?? '').split(windows ? ';' : ':');
  if (search.platform === 'darwin') entries.push(...MAC_PACKAGE_FOLDERS);
  for (const entry of entries) {
    // Windows allows quoted PATH entries; a relative entry would search the current folder.
    const folder = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!(windows ? /^(?:[A-Za-z]:[\\/]|\\\\)/.test(folder) : folder.startsWith('/'))) continue;
    const candidate = pathApi.join(folder, windows ? 'ffmpeg.exe' : 'ffmpeg');
    if (search.isFile(candidate)) return candidate;
  }
  return null;
}

let installed: string | null | undefined;

/** FFmpeg's full path, looked up once per run; installing it needs a restart. */
export function installedFfmpeg(): string | null {
  if (installed === undefined) installed = findFfmpeg();
  return installed;
}
