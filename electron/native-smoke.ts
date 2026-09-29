import type { App, BrowserWindow, WebPreferences } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createNativeSmokeTerminalClaim } from './native-smoke-terminal-claim.js';
import { RENDERER_SMOKE_SOURCE } from './native-smoke-renderer.js';

const USER_DATA_ARG = '--kerfdesk-native-smoke-user-data=';
const RESULT_ARG = '--kerfdesk-native-smoke-result=';
const SMOKE_TIMEOUT_MS = 45_000;

export type NativeSmokeConfig = {
  readonly userDataPath: string;
  readonly resultPath: string;
};

type NativeSmokeInspection = {
  readonly getLastWebPreferences?: () => WebPreferences | null;
};

type NativeSmokeDevToolsTarget = {
  on(event: 'devtools-opened', listener: () => void): unknown;
  removeListener(event: 'devtools-opened', listener: () => void): unknown;
  openDevTools(options: { mode: 'detach'; activate: false }): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
};

export async function probeNativeSmokeDevTools(contents: NativeSmokeDevToolsTarget) {
  let opened = false;
  const onOpened = () => {
    opened = true;
  };
  contents.on('devtools-opened', onOpened);
  try {
    contents.openDevTools({ mode: 'detach', activate: false });
    await new Promise((resolve) => setTimeout(resolve, 200));
    return opened || contents.isDevToolsOpened();
  } finally {
    contents.removeListener('devtools-opened', onOpened);
    contents.closeDevTools();
  }
}

// These runtime inspection methods are internal to the pinned Electron build.
// Missing methods/values stay unknown, so a future API change fails the smoke
// instead of silently replacing actual values with the intended configuration.
export function readNativeSmokeWebPreferences(contents: object) {
  const inspection = contents as NativeSmokeInspection;
  const preferences = inspection.getLastWebPreferences?.call(contents) ?? null;
  const reported = preferences ?? {};
  return {
    available: preferences !== null,
    sandbox: reported.sandbox ?? null,
    contextIsolation: reported.contextIsolation ?? null,
    nodeIntegration: reported.nodeIntegration ?? null,
    webSecurity: reported.webSecurity ?? null,
    // Electron 44 does not report preload or devTools in this API. Do not
    // turn an omitted field into evidence that no preload was installed.
    preload: reported.preload ?? 'not-reported',
  };
}

export function readNativeSmokeConfig(argv: ReadonlyArray<string>): NativeSmokeConfig | null {
  const userDataPath = argumentValue(argv, USER_DATA_ARG);
  const resultPath = argumentValue(argv, RESULT_ARG);
  if (userDataPath === null && resultPath === null) return null;
  if (userDataPath === null || resultPath === null) {
    throw new Error('native smoke requires both user-data and result paths');
  }
  if (!isAbsolute(userDataPath) || !isAbsolute(resultPath)) {
    throw new Error('native smoke paths must be absolute');
  }
  return { userDataPath: resolve(userDataPath), resultPath: resolve(resultPath) };
}

export function installPackagedNativeSmoke(input: {
  readonly app: App;
  readonly window: BrowserWindow;
  readonly config: NativeSmokeConfig | null;
}): void {
  if (input.config === null) return;
  const failures: string[] = [];
  const claimTerminal = createNativeSmokeTerminalClaim();
  const timeout = setTimeout(() => {
    if (!claimTerminal()) return;
    void finishNativeSmoke(input, failures, { readyToShow: false }, false, false, 'ready timeout');
  }, SMOKE_TIMEOUT_MS);

  input.window.webContents.on('did-fail-load', (_event, code, description, url) => {
    failures.push(`load ${code}: ${description} (${url})`);
  });
  input.window.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level === 'error') failures.push(`console ${sourceId}:${lineNumber}: ${message}`);
  });
  input.window.once('ready-to-show', () => {
    void runRendererSmoke(input.window)
      .then((renderer) => {
        if (!claimTerminal()) return;
        clearTimeout(timeout);
        return finishNativeSmoke(input, failures, renderer, true, input.window.isVisible());
      })
      .catch((error: unknown) => {
        if (!claimTerminal()) return;
        clearTimeout(timeout);
        return finishNativeSmoke(
          input,
          failures,
          { readyToShow: true },
          false,
          input.window.isVisible(),
          error instanceof Error ? error.message : String(error),
        );
      });
  });
}

async function runRendererSmoke(window: BrowserWindow): Promise<unknown> {
  return window.webContents.executeJavaScript(RENDERER_SMOKE_SOURCE, true);
}

async function finishNativeSmoke(
  input: {
    readonly app: App;
    readonly window: BrowserWindow;
    readonly config: NativeSmokeConfig | null;
  },
  failures: ReadonlyArray<string>,
  renderer: unknown,
  rendererOk: boolean,
  windowVisible: boolean,
  error?: string,
): Promise<void> {
  const config = input.config;
  if (config === null) return;
  const isolated =
    input.app.getPath('userData') === config.userDataPath &&
    input.app.getPath('sessionData') === config.userDataPath;
  const devToolsOpened = rendererOk
    ? await probeNativeSmokeDevTools(input.window.webContents)
    : 'not-probed';
  const supportLogRecordedLaunch = await nativeSmokeSupportLogRecordedLaunch(config.userDataPath);
  const result = {
    ok:
      rendererOk &&
      windowVisible &&
      input.app.isPackaged &&
      isolated &&
      failures.length === 0 &&
      devToolsOpened === false &&
      supportLogRecordedLaunch,
    isPackaged: input.app.isPackaged,
    isolated,
    windowVisible,
    userData: input.app.getPath('userData'),
    sessionData: input.app.getPath('sessionData'),
    failures,
    webPreferences: readNativeSmokeWebPreferences(input.window.webContents),
    devToolsProbe: { method: 'openDevTools', opened: devToolsOpened },
    supportLog: { recordedLaunch: supportLogRecordedLaunch },
    renderer,
    ...(error === undefined ? {} : { error }),
  };
  await mkdir(dirname(config.resultPath), { recursive: true });
  await writeFile(config.resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`NATIVE_SMOKE_OK=${result.ok}\n`);
  process.stdout.write(`IS_PACKAGED=${result.isPackaged}\n`);
  process.stdout.write(`USER_DATA=${result.userData}\n`);
  if (result.ok) input.app.quit();
  else input.app.exit(1);
}

/** The packaged app records its own launch in the support log (ADR-546). */
export async function nativeSmokeSupportLogRecordedLaunch(userDataPath: string): Promise<boolean> {
  try {
    const log = await readFile(join(userDataPath, 'logs', 'kerfdesk.log'), 'utf8');
    return /\[app\] KerfDesk \S+ started \(installed build\)/.test(log);
  } catch {
    return false;
  }
}

function argumentValue(argv: ReadonlyArray<string>, prefix: string): string | null {
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}
