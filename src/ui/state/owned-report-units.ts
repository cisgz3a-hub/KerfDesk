// Report units after a units line KerfDesk sends itself, on a controller whose
// position reports follow its G-code units (Smoothieware, the driver's
// `reportUnitsSelectedBy`). Since ADR-375 Amendment 7, KerfDesk reads a board
// left in G20, or put there from the Console, in inches. Its own origin writes
// (Restore saved origin, Place Board's corner origin, Continue from where the
// head stopped) and Auto-focus's setup still sent a plain G21 outside
// M120/M121, which clears inch mode (Robot.cpp L601-L602 @ 91fe4286). The
// board then reported millimetres while KerfDesk read inches, so the next
// point move from X100 to X60 sent `G0 X-2480` (rolling audit v5 J7-P1-1).
// Frame records the millimetres its own G21 selects (frame-report-units.ts),
// and these lines now do the same: positions are hidden while the line is in
// flight, and its acknowledgement records the units it selected. A line that
// fails leaves them hidden until `$G` or Frame names them, as a Console line
// that cannot be read back does (console-report-units.ts).
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.cpp#L601-L602

import type { ControllerDriver } from '../../core/controllers';
import { lineLeavesOtherReportUnits } from './console-report-units';
import { beginReportUnitsWrite, refreshedReportUnitsPatch } from './controller-report-units';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

type UnitsDriver = Pick<ControllerDriver, 'reportUnitsSelectedBy'>;

/** Before KerfDesk writes `line` for `label`. The step it returns records the
 *  units the line selected; call it once the controller has acknowledged it. */
export function beginOwnedReportUnitsLine(
  set: SetFn,
  get: GetFn,
  driver: UnitsDriver,
  line: string,
  label: string,
): () => void {
  const before = get();
  if (!lineLeavesOtherReportUnits(driver, line, before)) return () => undefined;
  const epoch = before.controllerSessionEpoch;
  set(beginReportUnitsWrite());
  return () => {
    const selection = driver.reportUnitsSelectedBy?.(line) ?? null;
    if (get().controllerSessionEpoch !== epoch) return;
    if (selection !== 'inches' && selection !== 'millimetres') return;
    const reportInches = selection === 'inches';
    const changed = (get().controllerSettings?.reportInches === true) !== reportInches;
    set((state) => ({
      controllerSettings: { ...state.controllerSettings, reportInches },
      ...refreshedReportUnitsPatch(state, { reportInches }),
    }));
    if (!changed) return;
    // The Console shows the transcript: an operator who chose G20 there sees
    // that the controller is back in millimetres.
    get().pushSystemNotice(
      `[lf2] ${label} selected ${selection} (${reportInches ? 'G20' : 'G21'}), so the controller now reports positions in ${selection}. KerfDesk reads them in ${selection}.`,
    );
  };
}

/** The store as KerfDesk's own program starts streaming. A Frame selects G21
 *  first, so an ordinary Start changes nothing here, but a recovery frames
 *  nothing and its program's G21 can leave other units than KerfDesk reads in:
 *  positions are hidden until `$G` or the next Frame names them, as for an
 *  opened program (external-program-controller-state.ts). */
export function ownedProgramReportUnitsPatch(
  state: LaserState,
  gcode: string,
  driver: UnitsDriver,
): Partial<LaserState> {
  // One pass over the text: a program whose units words all select the units
  // KerfDesk reads in has no line that leaves other ones.
  if (!lineLeavesOtherReportUnits(driver, gcode, state)) return {};
  return {
    reportUnitsUnconfirmed: true,
    wcoCache: null,
    log: pushLog(
      state,
      '[lf2] The job program selects other units than KerfDesk reads positions in, so the machine position stays hidden until $G or the next Frame names them.',
    ),
  };
}
