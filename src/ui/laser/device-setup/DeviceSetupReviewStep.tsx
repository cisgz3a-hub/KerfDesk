// Saving confirms the software draft, never the physical machine's readiness.
import { useEffect, useState } from 'react';
import { useLaserStore } from '../../state/laser-store';
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
  const rows = useLaserStore((store) => store.grblSettingsRows);
  const queuedFirmwareWrites = computeFirmwareDiffs(state.draft, rows, {
    machine: state.draftMachine,
    machineKinds: state.machineKinds,
  }).filter(
    (diff) => diff.differs && diff.writable && state.queuedFirmwareWriteIds.includes(diff.id),
  );
  return (
    <section className="lf-setup-review">
      <SoftwareStatus issues={issues} />
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

function SoftwareStatus({ issues }: { readonly issues: ReadonlyArray<string> }): JSX.Element {
  const ready = issues.length === 0;
  return (
    <div className={`lf-setup-review-status ${ready ? 'is-ready' : 'has-issues'}`} role="status">
      <span className="lf-setup-review-status-mark" aria-hidden="true">
        {ready ? '✓' : '!'}
      </span>
      <div>
        <strong>{ready ? 'Ready to save' : 'A few settings need attention'}</strong>
        <p>
          {ready
            ? 'Software configuration is internally consistent. Saving will not run or home the machine.'
            : 'Fix the issues below, then return here to save your setup.'}
        </p>
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
      <summary>
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
        <summary>Hardware commissioning checklist</summary>
        <ul className="lf-setup-review-checklist">
          {hardwareChecklist(machineKinds).map((item) => (
            <li key={item}>
              <span aria-hidden="true">☐</span> {item}
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
