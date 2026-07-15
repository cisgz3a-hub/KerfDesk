import type { SettingsCollectorState } from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';

const FIXED_SETUP_REMOVED_MESSAGE =
  'Fixed GRBL setup batches were removed because machine travel and power values must never be assumed. Use Machine Setup, read/export a backup, and write one verified common setting at a time.';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type WriteLine = (line: string) => Promise<void>;

export type LaserSetupRefs = {
  driver: ControllerDriver;
  settingsCollector: SettingsCollectorState;
  settingsCollectorSessionEpoch: number | null;
};

/**
 * Compatibility action retained for saved fixtures and older call sites. It is
 * intentionally inert: the former hard-coded $30/$32/$130/$131 sequence could
 * overwrite controller-specific travel and power calibration.
 */
export function setupActions(
  set: SetFn,
  get: GetFn,
  _refs: LaserSetupRefs,
  _write: WriteLine,
): Pick<LaserState, 'configureGrblLaserSetup'> {
  return {
    configureGrblLaserSetup: async () => {
      set({
        lastWriteError: FIXED_SETUP_REMOVED_MESSAGE,
        log: pushLog(get(), `[lf2] Setup command blocked: ${FIXED_SETUP_REMOVED_MESSAGE}`),
      });
      throw new Error(FIXED_SETUP_REMOVED_MESSAGE);
    },
  };
}
