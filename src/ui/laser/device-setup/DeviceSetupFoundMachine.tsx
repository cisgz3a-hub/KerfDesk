// What the found controller reported, and what happened with it (ADR-420).
// A new machine's setup is filled in by itself and lists each change with one
// Undo; a machine already set up keeps its values and offers the explicit
// Use detected values (ADR-347), so opening setup never rewrites a finished one.

import { selectControllerDriver } from '../../../core/controllers';
import type { DeviceProfile } from '../../../core/devices';
import { useLaserStore } from '../../state/laser-store';
import { Button } from '../../kit';
import { acceptDetectedPatch, setupChangeRows } from './device-setup-accept-detected';
import type { DeviceSetupAutoFillSummary } from './device-setup-auto-fill';
import type { DeviceSetupState, DeviceSetupStepProps } from './device-setup-flow';
import { DeviceSetupDetectedApply } from './DeviceSetupDetectedApply';
import type { DeviceSetupAutomatic } from './use-controller-auto-fill';

export function DeviceSetupFoundMachine(
  props: DeviceSetupStepProps & { readonly automatic?: DeviceSetupAutomatic | undefined },
): JSX.Element {
  const detected = useLaserStore((s) => s.detectedSettings);
  const record = props.automatic?.record ?? null;
  const facts = reportedFacts(detected ?? {});
  return (
    <div className="lf-setup-found">
      {facts.length > 0 ? (
        <ul className="lf-setup-found-facts" aria-label="What the controller reported">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      ) : (
        <p className="lf-setup-muted">
          The controller answered but reported no settings KerfDesk maps. Enter the manufacturer
          values in the next step.
        </p>
      )}
      {record?.status === 'applied' ? (
        <AutoFilled
          summary={record.summary}
          before={record.undo}
          after={props.state}
          onUndo={props.automatic?.undo}
        />
      ) : (
        <ExplicitApply {...props} detected={detected} undone={record?.status === 'undone'} />
      )}
    </div>
  );
}

function AutoFilled(props: {
  readonly summary: DeviceSetupAutoFillSummary;
  readonly before: DeviceSetupState;
  readonly after: DeviceSetupState;
  readonly onUndo: (() => void) | undefined;
}): JSX.Element {
  const rows = setupChangeRows(props.before, props.after);
  const { summary } = props;
  return (
    <div className="lf-setup-found-filled" role="status" aria-live="polite">
      <strong>Filled in from your controller</strong>
      <ul>
        {summary.controllerKind !== null ? (
          <li>
            Controller set to {selectControllerDriver(props.after.draft.controllerKind).label}
          </li>
        ) : null}
        {summary.baudRate !== null ? <li>Baud rate set to {summary.baudRate}</li> : null}
        {summary.machineKind !== null ? (
          <li>
            Machine type set to {summary.machineKind === 'cnc' ? 'CNC' : 'Laser'}: laser mode is{' '}
            {summary.machineKind === 'cnc' ? 'off ($32=0)' : 'on ($32=1)'}
          </li>
        ) : null}
        {rows.map((row) => (
          <li key={row.label}>
            {row.label}: {row.oldText} → <strong>{row.newText}</strong>
          </li>
        ))}
      </ul>
      <p className="lf-setup-muted">
        Everything stays editable, and nothing is saved until the last step. Configured travel is
        the controller&apos;s limit, not a measured work area.
      </p>
      {props.onUndo === undefined ? null : (
        <Button variant="ghost" onClick={props.onUndo}>
          Undo
        </Button>
      )}
    </div>
  );
}

function ExplicitApply(
  props: DeviceSetupStepProps & {
    readonly detected: Partial<DeviceProfile> | null;
    readonly undone: boolean;
  },
): JSX.Element | null {
  const { detected } = props;
  if (detected === null) return null;
  const { state } = props;
  const rows = setupChangeRows(state, { ...state, ...acceptDetectedPatch(state, detected, false) });
  if (rows.length === 0) {
    return props.state.detectedApplied ? (
      <AppliedNote />
    ) : (
      <p className="lf-setup-muted">This setup already matches what the controller reports.</p>
    );
  }
  return (
    <div className="lf-setup-found-differs">
      <strong>
        {props.undone
          ? 'Your setup is back as it was. These values differ from the controller:'
          : 'Your controller reports values that differ from this setup:'}
      </strong>
      <ul className="lf-setup-auto-values">
        {rows.map((row) => (
          <li key={row.label}>
            {row.label}: {row.oldText} → <strong>{row.newText}</strong>
          </li>
        ))}
      </ul>
      <DeviceSetupDetectedApply state={props.state} dispatch={props.dispatch} detected={detected} />
      {props.state.detectedApplied ? <AppliedNote /> : null}
    </div>
  );
}

function AppliedNote(): JSX.Element {
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="lf-setup-auto-done">
      Detected values applied to this setup draft. Nothing is saved until you complete the final
      Save step.
    </p>
  );
}

function reportedFacts(detected: Partial<DeviceProfile>): ReadonlyArray<string> {
  const facts: string[] = [];
  if (detected.bedWidth !== undefined && detected.bedHeight !== undefined) {
    facts.push(`Travel ${detected.bedWidth} × ${detected.bedHeight} mm`);
  }
  if (detected.maxFeed !== undefined) facts.push(`Max speed ${detected.maxFeed} mm/min`);
  if (detected.maxPowerS !== undefined) {
    facts.push(`Power S ${detected.minPowerS ?? 0}–${detected.maxPowerS}`);
  }
  if (detected.laserModeEnabled !== undefined) {
    facts.push(detected.laserModeEnabled ? 'Laser mode on' : 'Laser mode off');
  }
  if (detected.zTravelMm !== undefined) facts.push(`Z travel ${detected.zTravelMm} mm`);
  return facts;
}
