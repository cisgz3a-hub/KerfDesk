// Project files the operating system hands to KerfDesk (ADR-378): a project
// double-clicked in Explorer or Finder, dropped on the app icon, or named on
// the command line. Main reads only paths that arrived this way, and checks
// each one again before every read: an absolute, canonical path to a regular
// file with a project extension.

import * as path from 'node:path';

export const DESKTOP_PROJECT_EXTENSIONS: ReadonlySet<string> = new Set(['.lf2', '.lbrn', '.lbrn2']);
/** Longest Windows path; nothing longer can name a file. */
export const MAX_DESKTOP_PROJECT_PATH_LENGTH = 32_767;
/** Explorer starts one process per file for a multi-file Open; keep a sane cap. */
export const MAX_LAUNCH_PROJECT_PATHS = 16;

const LAUNCH_DATA_KEY = 'kerfdeskProjectPaths';

export type PathApi = Pick<
  path.PlatformPath,
  'basename' | 'extname' | 'isAbsolute' | 'parse' | 'resolve' | 'sep'
>;

export type LaunchArguments = {
  /** `electron .` puts the app path before any file arguments. */
  readonly defaultApp: boolean;
  /** Relative file arguments resolve against the directory the launch came from. */
  readonly workingDirectory: string;
  readonly pathApi?: PathApi;
};

export function hasProjectExtension(file: string, pathApi: PathApi = path): boolean {
  return DESKTOP_PROJECT_EXTENSIONS.has(pathApi.extname(file).toLowerCase());
}

/** Project paths named on a launch command line. Switches (Chromium's own,
 * macOS's -psn_ and KerfDesk's native smoke flags) and other files are skipped. */
export function projectPathsFromArgv(
  argv: ReadonlyArray<string>,
  options: LaunchArguments,
): string[] {
  const pathApi = options.pathApi ?? path;
  const paths: string[] = [];
  for (const arg of argv.slice(options.defaultApp ? 2 : 1)) {
    if (!isProjectArgument(arg, pathApi)) continue;
    const resolved = pathApi.resolve(options.workingDirectory, arg);
    if (!paths.includes(resolved)) paths.push(resolved);
    if (paths.length === MAX_LAUNCH_PROJECT_PATHS) break;
  }
  return paths;
}

/** What a second launch sends the running app. Chromium may reorder or add
 * switches in the argv the first instance sees, so the paths travel resolved. */
export function singleInstanceLaunchData(paths: ReadonlyArray<string>): Record<string, string[]> {
  return { [LAUNCH_DATA_KEY]: [...paths] };
}

/** The paths a second launch sent, or null when it sent none in this shape
 * (an older KerfDesk), so the caller falls back to that launch's argv. */
export function projectPathsFromLaunchData(
  data: unknown,
  pathApi: PathApi = path,
): string[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const value: unknown = (data as Record<string, unknown>)[LAUNCH_DATA_KEY];
  if (!Array.isArray(value)) return null;
  return value
    .filter((item): item is string => typeof item === 'string')
    .filter((item) => isProjectArgument(item, pathApi) && isCanonicalPath(item, pathApi))
    .slice(0, MAX_LAUNCH_PROJECT_PATHS);
}

/** Absolute and already resolved: no `..`, no relative segment, and on
 * Windows no alternate data stream after the drive or share. */
export function isCanonicalPath(candidate: string, pathApi: PathApi = path): boolean {
  if (!isBoundedText(candidate) || !pathApi.isAbsolute(candidate)) return false;
  if (pathApi.resolve(candidate) !== candidate) return false;
  if (pathApi.sep !== '\\') return true;
  return !candidate.slice(pathApi.parse(candidate).root.length).includes(':');
}

function isProjectArgument(arg: string, pathApi: PathApi): boolean {
  return isBoundedText(arg) && !arg.startsWith('-') && hasProjectExtension(arg, pathApi);
}

function isBoundedText(value: string): boolean {
  return (
    value.length > 0 && value.length <= MAX_DESKTOP_PROJECT_PATH_LENGTH && !value.includes('\0')
  );
}
