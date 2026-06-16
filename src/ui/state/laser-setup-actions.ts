import {
  CMD_SETTINGS,
  startCollecting,
  type SettingsCollectorState,
} from '../../core/controllers/grbl';
import { assertAutofocusIdle, pushLog, setupCommandBlockMessage } from './laser-store-helpers';
import type { LaserState } from './laser-store';

const GRBL_LASER_SETUP_LINES = ['$32=1', '$30=1000', '$130=400', '$131=400'];

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type WriteLine = (line: string) => Promise<void>;

export type LaserSetupRefs = {
  settingsCollector: SettingsCollectorState;
};

export function setupActions(
  set: SetFn,
  get: GetFn,
  refs: LaserSetupRefs,
  write: WriteLine,
): Pick<LaserState, 'configureGrblLaserSetup'> {
  return {
    configureGrblLaserSetup: async () => {
      assertAutofocusIdle(get());
      const blockedMessage = setupCommandBlockMessage(get());
      if (blockedMessage !== null) {
        set({
          lastWriteError: blockedMessage,
          log: pushLog(get(), `[lf2] Setup command blocked: ${blockedMessage}`),
        });
        throw new Error(blockedMessage);
      }
      const settingsBlock = settingsBackupBlockMessage(get());
      if (settingsBlock !== null) {
        set({
          lastWriteError: settingsBlock,
          log: pushLog(get(), `[lf2] Setup command blocked: ${settingsBlock}`),
        });
        throw new Error(settingsBlock);
      }
      for (const line of GRBL_LASER_SETUP_LINES) {
        await write(`${line}\n`);
      }
      refs.settingsCollector = startCollecting();
      await write(`${CMD_SETTINGS}\n`);
      set({
        log: pushLog(get(), '[lf2] Sent GRBL laser setup ($32=1, $30=1000, $130=400, $131=400).'),
      });
    },
  };
}

function settingsBackupBlockMessage(state: LaserState): string | null {
  if (state.grblSettingsRows.length === 0 || state.lastSettingsReadAt === null) {
    return 'Read machine settings ($$) and export a backup before changing GRBL setup.';
  }
  return null;
}
