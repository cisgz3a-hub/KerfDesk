// Report units on a controller whose position reports follow its G-code units
// (Smoothieware, `reportUnitsSelectedBy` on the driver). A Console line that
// may leave other units than KerfDesk reads in hides every reported position
// before it is written, and once the controller has answered it the Console
// reads the units back with `$G`, whose `[GC:]` report names G20 or G21
// (SimpleShell.cpp L879-L892). The line handler records that report, so any
// `$G` the operator sends confirms the units too. An opened program does the
// same as its stream is installed (external-program-controller-state.ts) and
// is read back by the operator's `$G` or the next Frame. Until then no point
// move, Go to work zero or recovery move takes a target or a delta from a
// report in units KerfDesk does not know (rolling audit v3 G4-P1-2). The `$13`
// write is the GRBL-family twin, read back with `$$`
// (laser-console-settings-write.ts); Frame selects G21 itself
// (frame-report-units.ts), and KerfDesk's other own units lines record what
// they select (owned-report-units.ts).
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/utils/simpleshell/SimpleShell.cpp#L879-L892

import type { ControllerDriver } from '../../core/controllers';
import type { ReportUnitsSelection } from '../../core/controllers/controller-driver';
import type { PreparedConsoleCommand } from '../../core/controllers/grbl';
import { parseModalUnitsFromModalResponses } from '../../core/controllers/grbl/work-offset-readback';
import { refreshedReportUnitsPatch } from './controller-report-units';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';

type GetFn = () => LaserState;

type ReportUnitsState = Pick<LaserState, 'controllerSettings' | 'reportUnitsUnconfirmed'>;

/** Whether a line may leave the reports in other units than KerfDesk reads them
 *  in. A line that selects those same units changes nothing. */
export function lineLeavesOtherReportUnits(
  driver: Pick<ControllerDriver, 'reportUnitsSelectedBy'>,
  line: string,
  state: ReportUnitsState,
): boolean {
  const selection = driver.reportUnitsSelectedBy?.(line) ?? null;
  return selection !== null && leavesOtherUnits(selection, state);
}

function leavesOtherUnits(selection: ReportUnitsSelection, state: ReportUnitsState): boolean {
  if (selection === 'unknown' || state.reportUnitsUnconfirmed === true) return true;
  return (selection === 'inches') !== (state.controllerSettings?.reportInches === true);
}

/** Read the units back after the line was answered. A failed read, or one that
 *  names no units, leaves positions hidden and says how to show them again. */
export async function rereadReportUnitsAfterConsoleLine(
  get: GetFn,
  driver: ControllerDriver,
  written: string,
  dispatchRead: (command: PreparedConsoleCommand) => Promise<void>,
): Promise<void> {
  const query = driver.commands.modalStateQuery;
  try {
    if (query === null) throw new Error('the controller has no modal-state report');
    const read = driver.prepareConsoleCommand(query);
    if (!read.ok) throw new Error(read.reason);
    const epoch = get().controllerSessionEpoch;
    await dispatchRead(read.command);
    if (get().controllerSessionEpoch !== epoch || get().reportUnitsUnconfirmed !== true) return;
    throw new Error(`${query} named neither G20 nor G21`);
  } catch (error) {
    gcodeReportUnitsStayUnconfirmed(get, written, error);
  }
}

/** The notice for a units line whose units are still unknown. The Console shows
 *  the transcript, which a plain log line never reaches. */
export function gcodeReportUnitsStayUnconfirmed(get: GetFn, written: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  get().pushSystemNotice(
    `[lf2] ${written} may have changed the units the controller reports positions in, and KerfDesk could not read them back (${reason}). The machine position stays hidden until it can: send $G from the Console, or Frame, which selects G21.`,
  );
}

/** Why no position can be read while the report units are unconfirmed, or null. */
export function unconfirmedReportUnitsMessage(
  state: Pick<LaserState, 'reportUnitsUnconfirmed'>,
  driver: Pick<ControllerDriver, 'reportUnitsSelectedBy'>,
): string | null {
  if (state.reportUnitsUnconfirmed !== true) return null;
  const read =
    driver.reportUnitsSelectedBy === undefined
      ? 'Read the controller settings ($$)'
      : 'Send $G from the Console, or Frame,';
  return `KerfDesk does not know which units the controller reports positions in, so it hides the machine position. ${read} to confirm them.`;
}

/** The store after a `[GC:]` modal report, on a controller whose position
 *  reports follow the units it names. Nothing changes when the report names no
 *  units or the units KerfDesk already reads in. */
export function modalReportUnitsPatch(state: LaserState, line: string): Partial<LaserState> {
  const units = parseModalUnitsFromModalResponses([line]);
  if (units === null) return {};
  const reportInches = units === 'inches';
  const changed = (state.controllerSettings?.reportInches === true) !== reportInches;
  if (!changed && state.reportUnitsUnconfirmed !== true) return {};
  return {
    controllerSettings: { ...state.controllerSettings, reportInches },
    ...refreshedReportUnitsPatch(state, { reportInches }),
    ...(changed
      ? {
          log: pushLog(
            state,
            `[lf2] The controller reports positions in ${units} (${reportInches ? 'G20' : 'G21'}); KerfDesk reads them in ${units}.`,
          ),
        }
      : {}),
  };
}
