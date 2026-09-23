import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';

// Raw status/WCO numbers keep their reporting-unit contract while a new $$
// dump is being collected. Clearing settings must not turn old inches into mm.
export function retainControllerReportUnits(
  settings: ControllerSettingsSnapshot | null,
): ControllerSettingsSnapshot | null {
  return settings?.reportInches === undefined ? null : { reportInches: settings.reportInches };
}

export function beginReportUnitsWrite(): Partial<LaserState> {
  return { reportUnitsUnconfirmed: true, ...clearReportedCoordinateEvidence() };
}

export function unqualifiedControllerSettingsPatch(state: LaserState): Partial<LaserState> {
  return {
    detectedSettings: null,
    controllerSettings: retainControllerReportUnits(state.controllerSettings),
    controllerSettingsObservation: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  };
}

export function refreshedReportUnitsPatch(
  state: LaserState,
  settings: ControllerSettingsSnapshot,
): Partial<LaserState> {
  if (settings.reportInches === undefined) return {};
  const changed = (state.controllerSettings?.reportInches === true) !== settings.reportInches;
  return {
    reportUnitsUnconfirmed: false,
    ...(changed || state.reportUnitsUnconfirmed === true ? clearReportedCoordinateEvidence() : {}),
  };
}

function clearReportedCoordinateEvidence(): Partial<LaserState> {
  return {
    statusReport: null,
    statusObservation: null,
    wcoCache: null,
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
  };
}
