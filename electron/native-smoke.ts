import type { App, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { createNativeSmokeTerminalClaim } from './native-smoke-terminal-claim.js';
import { RENDERER_SMOKE_SOURCE } from './native-smoke-renderer.js';

const USER_DATA_ARG = '--kerfdesk-native-smoke-user-data=';
const RESULT_ARG = '--kerfdesk-native-smoke-result=';
const SMOKE_TIMEOUT_MS = 45_000;

export type NativeSmokeConfig = {
  readonly userDataPath: string;
  readonly resultPath: string;
};

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
  input.window.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 3) failures.push(`console ${source}:${line}: ${message}`);
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
  input: { readonly app: App; readonly config: NativeSmokeConfig | null },
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
  const result = {
    ok: rendererOk && windowVisible && input.app.isPackaged && isolated && failures.length === 0,
    isPackaged: input.app.isPackaged,
    isolated,
    windowVisible,
    userData: input.app.getPath('userData'),
    sessionData: input.app.getPath('sessionData'),
    failures,
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

function argumentValue(argv: ReadonlyArray<string>, prefix: string): string | null {
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}
