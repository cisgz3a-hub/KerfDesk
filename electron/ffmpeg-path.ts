// Where FFmpeg is, for network (RTSP) cameras (ADR-551). KerfDesk does not
// ship FFmpeg, so it runs one the customer installed, found only in the
// absolute folders on PATH and started by its full path. A bare `ffmpeg`
// would also run a copy sitting in the current folder on Windows, and that
// folder can be wherever a project was double-clicked, such as Downloads.

import { statSync } from 'node:fs';
import * as path from 'node:path';

export const FFMPEG_MISSING_REASON =
  'Network cameras need FFmpeg, which is not installed. Install FFmpeg, add its bin folder to ' +
  'PATH, then restart KerfDesk.';

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

/** The full path of the first FFmpeg in an absolute PATH folder, or null. */
export function findFfmpeg(search: FfmpegSearch = NODE_FFMPEG_SEARCH): string | null {
  const windows = search.platform === 'win32';
  const pathApi = windows ? path.win32 : path.posix;
  for (const entry of (search.pathVariable ?? '').split(windows ? ';' : ':')) {
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
