// Saving confirms the software draft, never the physical machine's readiness.
import { useEffect, useState } from 'react';
import { Icon } from '../../kit/icons';
import { useLaserStore } from '../../state/laser-store';
import {
  liveDriverMismatch,
  reviewDriverSwitchText,
  reviewStatusText,
} from '../live-driver-mismatch';
import type { CncStartupOperationDraft } from '../../state/cnc-startup-setup';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { machineSetupValidationIssues } from './device-setup-flow';
import { computeFirmwareDiffs } from './device-setup-firmware-diff';
import { DeviceSetupCncReview } from './DeviceSetupCncReview';
import { DeviceSetupFirmwareStep } from './DeviceSetupFirmwareStep';
import { DeviceSetupReviewSections } from './DeviceSetupReviewSections';
import './device-setup-review.css';

export function DeviceSetupReviewStep({
  state,
  dispatch,
  operationDrafts,
}: DeviceSetupStepProps & {
  readonly operationDrafts: ReadonlyArray<CncStartupOperationDraft>;
}): JSX.Element {
  const issues = machineSetupValidationIssues(state);
  const driverSwitch = useDraftDriverSwitch(state.draft);
  const rows = useLaserStore((store) => store.grblSettingsRows);
  const queuedFirmwareWrites = computeFirmwareDiffs(state.draft, rows, {
    machine: state.draftMachine,
    machineKinds: state.machineKinds,
  }).filter(
    (diff) => diff.differs && diff.writable && state.queuedFirmwareWriteIds.includes(diff.id),
  );
  return (
    <section className="lf-setup-review">
      <SoftwareStatus issues={issues} driverSwitch={driverSwitch} />
      {state.machineKind === 'cnc' ? (
        <p>
          Machining setup: <strong>{state.cncSetupDraft.name}</strong> · G54 · stock top Z0 ·{' '}
          {state.cncSetupDraft.fixtures.length} fixture envelopes
        </p>
      ) : null}
      <div className="lf-setup-review-grid">
        <DeviceSetupReviewSections
          state={state}
          dispatch={dispatch}
          firmwareWrites={queuedFirmwareWrites}
        />
        {state.machineKind === 'cnc' ? (
          <DeviceSetupCncReview
            machine={state.cncDraft}
            operationDrafts={operationDrafts}
            onEdit={() => dispatch({ kind: 'go', step: 'cnc-setup' })}
          />
        ) : null}
      </div>
      <HardwareHandoff machineKinds={state.machineKinds} />
      <ControllerSettings
        state={state}
        dispatch={dispatch}
        queuedWriteCount={queuedFirmwareWrites.length}
      />
    </section>
  );
}

// The live connection's driver, when Save has to switch it (U2-P2-1).
function useDraftDriverSwitch(draft: DeviceSetupStepProps['state']['draft']): string | null {
  const connected = useLaserStore((store) => store.connection.kind === 'connected');
  const activeControllerKind = useLaserStore((store) => store.activeControllerKind);
  const activeControllerCommandSet = useLaserStore((store) => store.activeControllerCommandSet);
  const mismatch = liveDriverMismatch(draft, {
    connected,
    activeControllerKind,
    activeControllerCommandSet,
  });
  return mismatch === null ? null : reviewDriverSwitchText(mismatch);
}

function SoftwareStatus({
  issues,
  driverSwitch,
}: {
  readonly issues: ReadonlyArray<string>;
  readonly driverSwitch: string | null;
}): JSX.Element {
  const ready = issues.length === 0;
  const settled = ready && driverSwitch === null;
  return (
    <div className={`lf-setup-review-status ${settled ? 'is-ready' : 'has-issues'}`} role="status">
      <span className="lf-setup-review-status-mark" aria-hidden="true">
        <Icon name={settled ? 'check' : 'warning'} size={20} />
      </span>
      <div>
        <strong>
          {!ready
            ? 'A few settings need attention'
            : settled
              ? 'Ready to save'
              : 'Ready to save: Save reconnects'}
        </strong>
        <p>{reviewStatusText(issues, driverSwitch)}</p>
        {!ready ? (
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function ControllerSettings({
  state,
  dispatch,
  queuedWriteCount,
}: DeviceSetupStepProps & { readonly queuedWriteCount: number }): JSX.Element {
  const [expanded, setExpanded] = useState(queuedWriteCount > 0);
  useEffect(() => {
    if (queuedWriteCount > 0) setExpanded(true);
  }, [queuedWriteCount]);
  return (
    <details
      className="lf-setup-review-disclosure"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary title="Compare controller settings with this draft and review optional writes for Save.">
        <span className="lf-setup-review-disclosure-title">
          Controller settings <span className="lf-setup-review-optional">Optional</span>
        </span>
        <span className="lf-setup-review-disclosure-status">
          {queuedWriteCount === 0
            ? 'No writes queued'
            : `${queuedWriteCount} setting${queuedWriteCount === 1 ? '' : 's'} queued for Save`}
        </span>
      </summary>
      <div className="lf-setup-review-disclosure-body">
        <DeviceSetupFirmwareStep state={state} dispatch={dispatch} />
      </div>
    </details>
  );
}

function HardwareHandoff({
  machineKinds,
}: {
  readonly machineKinds: ReadonlyArray<'laser' | 'cnc'>;
}): JSX.Element {
  return (
    <aside className="lf-setup-review-handoff">
      <strong>Before your first run</strong>
      <p>Check the physical machine after saving. Software setup does not verify the hardware.</p>
      <details className="lf-setup-review-hardware-details">
        <summary title="Review the physical checks to perform before your first machine run.">
          Hardware commissioning checklist
        </summary>
        <ul className="lf-setup-review-checklist">
          {hardwareChecklist(machineKinds).map((item) => (
            <li key={item}>
              <Icon name="square" size={15} /> {item}
            </li>
          ))}
        </ul>
        <p>
          Keep the emergency stop accessible. Start with outputs disabled and motion clear of
          clamps, then verify one item at a time. KerfDesk does not store these as complete
          automatically.
        </p>
      </details>
    </aside>
  );
}

function hardwareChecklist(machineKinds: ReadonlyArray<'laser' | 'cnc'>): ReadonlyArray<string> {
  const common = [
    'Emergency stop and disconnect path work',
    'Axis labels, positive directions, and travel limits match the machine',
    'Limit switches and homing direction are correct before running Home',
    'Origin and displayed position match a measured point',
    'Frame / dry-run path clears clamps, fixtures, and no-go zones',
  ];
  const cnc = machineKinds.includes('cnc')
    ? [
        'Z-positive retracts away from stock and Safe Z clears clamps',
        'Spindle S value, spin-up time, coolant relay, and park point are correct',
        'Probe plate thickness, electrical contact, and plate removal are verified',
      ]
    : [];
  const laser = machineKinds.includes('laser')
    ? [
        'Beam remains off during travel and at S0',
        'Lowest-power pulse and maximum S scale are verified on scrap',
        'Air-assist relay, focus method, enclosure, interlocks, and exhaust are verified',
      ]
    : [];
  const swap =
    machineKinds.length === 2
      ? [
          'Only one toolhead is installed and powered for the selected active mode',
          'Toolhead swap wiring, firmware mode, and interlocks are verified before every changeover',
        ]
      : [];
  return [...common, ...laser, ...cnc, ...swap];
}
