// Project files the operating system asked the running app to open, held in
// main until the renderer collects them (ADR-378). The renderer may still be
// loading when a double-click arrives, so nothing is pushed to it: main only
// signals, and the renderer drains this queue when it subscribes and whenever
// it is signalled.

import * as path from 'node:path';
import type { DesktopProjectFileCheck } from './desktop-project-file-check.js';
import { MAX_LAUNCH_PROJECT_PATHS } from './desktop-project-paths.js';
import type { DesktopProjectTokens } from './desktop-project-token.js';

export type DesktopProjectOpenRequest =
  | {
      readonly kind: 'file';
      readonly name: string;
      readonly path: string;
      readonly token: string;
      readonly size: number;
    }
  | {
      readonly kind: 'unavailable';
      readonly name: string;
      readonly reason: 'missing' | 'invalid' | 'unreadable';
    };

export type DesktopProjectOpenQueue = {
  readonly add: (paths: ReadonlyArray<string>) => void;
  readonly drain: (
    tokens: DesktopProjectTokens,
    check: (file: string) => Promise<DesktopProjectFileCheck>,
  ) => Promise<ReadonlyArray<DesktopProjectOpenRequest>>;
};

export function createDesktopProjectOpenQueue(
  limit: number = MAX_LAUNCH_PROJECT_PATHS,
): DesktopProjectOpenQueue {
  let pending: string[] = [];
  return {
    add: (paths) => {
      if (paths.length === 0) return;
      // The newest requests win when a burst overflows the queue.
      pending = [...pending, ...paths].slice(-limit);
    },
    drain: async (tokens, check) => {
      const paths = pending;
      pending = [];
      return Promise.all(paths.map(async (file) => openRequest(file, await check(file), tokens)));
    },
  };
}

function openRequest(
  file: string,
  checked: DesktopProjectFileCheck,
  tokens: DesktopProjectTokens,
): DesktopProjectOpenRequest {
  if (checked.kind !== 'file') {
    return { kind: 'unavailable', name: path.basename(file), reason: checked.kind };
  }
  return {
    kind: 'file',
    name: checked.name,
    path: checked.path,
    token: tokens.mint(checked.path),
    size: checked.size,
  };
}
