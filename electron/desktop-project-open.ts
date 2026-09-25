// Opening a project from the operating system (ADR-378): a double-clicked
// .lf2, a project dropped on the app icon, or one named on the command line.
//
// One process owns the Chromium profile and the serial-capable window, so a
// second launch only raises that window and hands its project paths over.
// They travel in the single-instance lock's additionalData, because Chromium
// may reorder or add switches in the argv the running app sees. Main queues
// the paths and signals the renderer with a fixed script that carries no
// data; the renderer then collects them through the exact routes in
// desktop-project-routes.ts. There is still no preload and no IPC.

import { BrowserWindow, type App } from 'electron';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { checkDesktopProjectPath, type DesktopProjectFile } from './desktop-project-file-check.js';
import { createDesktopProjectOpenQueue } from './desktop-project-open-queue.js';
import {
  projectPathsFromArgv,
  projectPathsFromLaunchData,
  singleInstanceLaunchData,
} from './desktop-project-paths.js';
import {
  DESKTOP_PROJECT_FILE_HEADERS,
  withDesktopProjectRoutes,
  type AppProtocolHandler,
} from './desktop-project-routes.js';
import {
  createDesktopProjectTokens,
  loadDesktopProjectKey,
  type DesktopProjectTokens,
} from './desktop-project-token.js';
import { revealPrimaryWindow } from './single-instance-policy.js';

/** Fixed, data-free signal; the renderer fetches the queue itself. */
export const DESKTOP_PROJECT_OPEN_SIGNAL =
  "window.dispatchEvent(new CustomEvent('kerfdesk:desktop-project-open')); undefined";

export type DesktopProjectOpens = {
  readonly hasSingleInstanceLock: boolean;
  /** Wrap the app:// handler with the project-file routes. */
  readonly routes: (fallback: AppProtocolHandler) => AppProtocolHandler;
};

export type DesktopProjectOpenOptions = {
  readonly isTrustedRenderer: (url: string) => boolean;
};

export function installDesktopProjectOpens(
  app: App,
  options: DesktopProjectOpenOptions,
): DesktopProjectOpens {
  const launchPaths = projectPathsFromArgv(process.argv, {
    defaultApp: process.defaultApp === true,
    workingDirectory: process.cwd(),
  });
  if (!app.requestSingleInstanceLock(singleInstanceLaunchData(launchPaths))) {
    return { hasSingleInstanceLock: false, routes: (fallback) => fallback };
  }
  const queue = createDesktopProjectOpenQueue();
  queue.add(launchPaths);
  const signal = (): void => signalRenderer(BrowserWindow.getAllWindows()[0], options);
  app.on('second-instance', (_event, argv, workingDirectory, additionalData) => {
    const primary = BrowserWindow.getAllWindows()[0];
    if (primary !== undefined) revealPrimaryWindow(primary);
    queue.add(
      projectPathsFromLaunchData(additionalData) ??
        projectPathsFromArgv(argv, { defaultApp: process.defaultApp === true, workingDirectory }),
    );
    signal();
  });
  // macOS delivers Finder opens as events, before ready on a cold launch.
  app.on('open-file', (event, file) => {
    event.preventDefault();
    queue.add([file]);
    signal();
  });
  const tokens = memoize(() =>
    loadDesktopProjectKey(app.getPath('userData')).then(createDesktopProjectTokens),
  );
  return {
    hasSingleInstanceLock: true,
    routes: (fallback) =>
      withDesktopProjectRoutes(fallback, {
        tokens,
        check: (file) => checkDesktopProjectPath(file),
        read: readProjectFile,
        drainOpens: async () =>
          queue.drain(await tokens(), (file) => checkDesktopProjectPath(file)),
      }),
  };
}

function signalRenderer(
  window: BrowserWindow | undefined,
  options: DesktopProjectOpenOptions,
): void {
  if (window === undefined || window.isDestroyed()) return;
  const contents = window.webContents;
  // A renderer that is still loading drains the queue when it subscribes.
  if (!options.isTrustedRenderer(contents.getURL())) return;
  contents.executeJavaScript(DESKTOP_PROJECT_OPEN_SIGNAL).catch((error: unknown) => {
    console.warn('Could not signal a project open to the window:', error);
  });
}

function readProjectFile(file: DesktopProjectFile): Response {
  const body = Readable.toWeb(createReadStream(file.realPath)) as ReadableStream<Uint8Array>;
  return new Response(body, { status: 200, headers: DESKTOP_PROJECT_FILE_HEADERS });
}

function memoize(load: () => Promise<DesktopProjectTokens>): () => Promise<DesktopProjectTokens> {
  let pending: Promise<DesktopProjectTokens> | undefined;
  return () => {
    pending ??= load();
    return pending;
  };
}
