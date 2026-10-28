// The Console reads a typed line the way the connected board will run it
// (ADR-375 Amendment 6), and the board is not always the profile's firmware. A
// FluidNC board greets as "Grbl 3.x [FluidNC vX]" and often runs under the
// default stock-GRBL profile. FluidNC v4.0.3 hands every line that starts with
// `$` or `[` to settings_execute_line(), so `[13]1` is `$13=1` and `[RST]#` is
// `$RST=#` (ProcessSettings.cpp L1209-L1240). The FluidNC profile reads them so
// (ADR-375 Amendment 7), but the stock driver took them for G-code: `[13]1`
// went out with no confirmation and no `$$` re-read, the board then reported
// inches while KerfDesk read millimetres, and the next point move from X100 to
// X60 drove the head to X156; `[RST]#` wiped the work offsets with the probed
// Work Z kept (rolling audit v5 J7-P1-2). When the session's banner shows
// FluidNC, a GRBL-family profile therefore reads the line as FluidNC does and
// gives its `$` form that profile's own checks, as #1446 keys grblHAL's checks
// on session evidence (ADR-375 Amendment 5).
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1209-L1240

import type { ControllerKind } from '../devices/device-profile';
import type { ControllerDriver } from './controller-driver';
import { fluidncBoardCommandForm } from './fluidnc/driver';
import type { ConsoleCommandResult } from './grbl/console-command';

/** What the session showed of the connected board. */
export type BoardConsoleSession = {
  readonly detectedControllerKind: ControllerKind | null;
};

// The FluidNC driver reads its own lines; other firmware families do not speak
// FluidNC's protocol and keep their profile's reading.
const PROFILES_A_FLUIDNC_BOARD_ANSWERS: ReadonlySet<ControllerKind> = new Set([
  'grbl-v1.1',
  'grblhal',
]);

/** The profile driver's reading of a Console line, once it is in the form the
 *  connected board runs. */
export function prepareBoardConsoleCommand(
  driver: Pick<ControllerDriver, 'kind' | 'prepareConsoleCommand'>,
  input: string,
  session: BoardConsoleSession | null | undefined,
): ConsoleCommandResult {
  if (
    session?.detectedControllerKind !== 'fluidnc' ||
    !PROFILES_A_FLUIDNC_BOARD_ANSWERS.has(driver.kind)
  ) {
    return driver.prepareConsoleCommand(input);
  }
  const board = fluidncBoardCommandForm(input);
  return board.ok ? driver.prepareConsoleCommand(board.line) : board;
}
