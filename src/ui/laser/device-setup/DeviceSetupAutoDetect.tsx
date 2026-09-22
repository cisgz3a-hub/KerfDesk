// The automatic lane on the Machine stage (ADR-347). Connecting already runs
// the controller's read-only settings query, so by the time setup opens the
// values usually exist — they were just buried inside a collapsed disclosure.
// This shows what the machine reported and offers the one explicit action that
// copies it into the draft. Detection still never applies itself (ADR-205), and
// nothing here reaches the project before Save.

import { selectControllerDriver } from '../../../core/controllers';
import { useLaserStore } from '../../state/laser-store';
import { describePatch } from '../DetectedSettingsBanner';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { DeviceSetupDetectedApply } from './DeviceSetupDetectedApply';

export function DeviceSetupAutoDetect({
  state,
  dispatch,
}: DeviceSetupStepProps): JSX.Element | null {
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  const detected = useLaserStore((s) => s.detectedSettings);
  const driver = selectControllerDriver(
    state.draft.controllerKind ?? 'grbl-v1.1',
    state.draft.controllerCommandSet,
  );
  // File-only controllers never answer a read, so there is nothing to automate.
  if (driver.capabilities.transport !== 'serial') return null;
  const rows = detected === null ? [] : describePatch(detected, state.baseline);
  return (
    <section className="lf-setup-auto" aria-label="Automatic setup" data-ready={rows.length > 0}>
      <h4>Set up automatically</h4>
      {rows.length === 0 || detected === null ? (
        <p>{emptyExplanation(connected)}</p>
      ) : (
        <>
          <p>
            {driver.label} reported these values. Using them fills the draft for you; everything
            stays editable, and nothing is saved until the final Save step.
          </p>
          <ul className="lf-setup-auto-values">
            {rows.map((row) => (
              <li key={row.label}>
                {row.label}: <strong>{row.newText}</strong>
              </li>
            ))}
          </ul>
          <DeviceSetupDetectedApply state={state} dispatch={dispatch} detected={detected} />
          {state.detectedApplied ? (
            <p role="status" aria-live="polite" aria-atomic="true" className="lf-setup-auto-done">
              Detected values applied to this setup draft. Nothing is saved until you complete the
              final Save step.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function emptyExplanation(connected: boolean): string {
  if (!connected) {
    return 'Connect the controller in the section below, and KerfDesk reads its work area, feed ceiling and power scale into this draft for you. Setting the machine up offline works too.';
  }
  return 'No mapped values have been read. Run the read-only checks below, or enter the manufacturer values by hand.';
}
