import type { App, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NativeSmokeConfig } from './native-smoke.js';

/** An observation launch, never a successful automated smoke result. */
export function installInteractiveNativeObservation(
  input: {
    readonly app: Pick<App, 'getPath' | 'isPackaged'>;
    readonly window: Pick<BrowserWindow, 'once' | 'isVisible' | 'webContents'>;
    readonly config: NativeSmokeConfig;
  },
  preferences: (contents: object) => unknown,
): void {
  input.window.once('ready-to-show', () => {
    const result = {
      mode: 'interactive-observation',
      automatedSmoke: 'not-run',
      readyToShow: true,
      isPackaged: input.app.isPackaged,
      isolated:
        input.app.getPath('userData') === input.config.userDataPath &&
        input.app.getPath('sessionData') === input.config.userDataPath,
      userData: input.app.getPath('userData'),
      sessionData: input.app.getPath('sessionData'),
      webPreferences: preferences(input.window.webContents),
    };
    // No renderer script, import, save, DevTools probe, timer, or automatic exit.
    // Actual UI observations must be recorded separately by the operator.
    void mkdir(dirname(input.config.resultPath), { recursive: true })
      .then(() =>
        writeFile(input.config.resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8'),
      )
      .catch(() => console.warn('Interactive observation evidence could not be written.'));
  });
}
