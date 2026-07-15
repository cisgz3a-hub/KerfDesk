// Step 7: software configuration review plus an explicit hardware handoff.
// Save never claims the physical machine is ready to move or energize output.

import { Button } from '../../kit';
import { useLaserStore } from '../../state/laser-store';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { machineSetupValidationIssues } from './device-setup-flow';
import { computeFirmwareDiffs, type FirmwareDiff } from './device-setup-firmware-diff';
import { machineSetupControllerGuide } from './machine-setup-controller-guide';

export function DeviceSetupReviewStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const issues = machineSetupValidationIssues(state);
  const rows = useLaserStore((store) => store.grblSettingsRows);
  const queuedFirmwareWrites = computeFirmwareDiffs(state.draft, rows, state.draftMachine).filter(
    (diff) => diff.differs && diff.writable && state.queuedFirmwareWriteIds.includes(diff.id),
  );
  return (
    <section style={sectionStyle}>
      <SoftwareStatus issues={issues} />
      <ConnectionReview
        state={state}
        firmwareWrites={queuedFirmwareWrites}
        onEdit={() => dispatch({ kind: 'go', step: 'identify' })}
      />
      <WorkspaceReview state={state} onEdit={() => dispatch({ kind: 'go', step: 'confirm' })} />
      <OutputReview state={state} onEdit={() => dispatch({ kind: 'go', step: 'machine' })} />
      <SafetyReview state={state} onEdit={() => dispatch({ kind: 'go', step: 'safety' })} />
      <HardwareHandoff machineKind={state.machineKind} />
    </section>
  );
}

function SoftwareStatus(props: { readonly issues: ReadonlyArray<string> }): JSX.Element {
  const ready = props.issues.length === 0;
  return (
    <>
      <p style={ready ? readyStyle : pendingStyle}>
        {ready
          ? 'Software configuration is internally consistent. Saving will not run or home the machine.'
          : 'Resolve the software configuration issues below before saving.'}
      </p>
      {!ready ? (
        <ul style={issueListStyle}>
          {props.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ConnectionReview(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly firmwareWrites: ReadonlyArray<FirmwareDiff>;
  readonly onEdit: () => void;
}): JSX.Element {
  const { state } = props;
  const guide = machineSetupControllerGuide(state.draft.controllerKind ?? 'grbl-v1.1');
  const baud =
    guide.transportLabel === 'USB serial'
      ? String(state.draft.baudRate ?? guide.defaultBaudRate)
      : 'Not used';
  const streaming =
    guide.transportLabel === 'USB serial'
      ? `${state.draft.streamingMode}${state.draft.streamingMode === 'char-counted' ? `, ${state.draft.rxBufferBytes} bytes` : ''}`
      : 'Not used';
  return (
    <ReviewSection title="Machine and connection" onEdit={props.onEdit}>
      <ReviewRow label="Type" value={state.machineKind === 'cnc' ? 'CNC router / mill' : 'Laser'} />
      <ReviewRow label="Profile" value={state.draft.name} />
      <ReviewRow label="Controller" value={`${guide.label} (${guide.transportLabel})`} />
      <ReviewRow label="Baud" value={baud} />
      <ReviewRow
        label="Output"
        value={
          guide.transportLabel === 'USB serial'
            ? state.draft.gcodeDialect.dialectId
            : 'Ruida .rd file'
        }
      />
      <ReviewRow label="Streaming" value={streaming} />
      <ReviewRow
        label="Firmware after save"
        value={
          props.firmwareWrites.length === 0
            ? 'No writes queued'
            : `${props.firmwareWrites.map((write) => `${write.code}=${write.desired}`).join(', ')}; exact re-read required`
        }
      />
    </ReviewSection>
  );
}

function WorkspaceReview(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly onEdit: () => void;
}): JSX.Element {
  const { state } = props;
  const guide = machineSetupControllerGuide(state.draft.controllerKind ?? 'grbl-v1.1');
  const homing = state.draft.homing.enabled
    ? `${guide.homeCommand ?? 'enabled'} toward ${state.draft.homing.direction}`
    : 'Disabled';
  return (
    <ReviewSection title="Workspace and coordinates" onEdit={props.onEdit}>
      <ReviewRow
        label="Work area"
        value={`${state.draft.bedWidth} × ${state.draft.bedHeight} mm`}
      />
      <ReviewRow label="Origin" value={state.draft.origin} />
      <ReviewRow label="Homing" value={homing} />
      <ReviewRow
        label="Max / frame feed"
        value={`${state.draft.maxFeed} / ${state.draft.framingFeedMmPerMin} mm/min`}
      />
    </ReviewSection>
  );
}

function OutputReview(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly onEdit: () => void;
}): JSX.Element {
  const cnc = props.state.draftMachine.kind === 'cnc';
  return (
    <ReviewSection
      title={cnc ? 'CNC machine output' : 'Laser machine output'}
      onEdit={props.onEdit}
    >
      {cnc ? <CncOutputRows state={props.state} /> : <LaserOutputRows state={props.state} />}
    </ReviewSection>
  );
}

function CncOutputRows({ state }: { readonly state: DeviceSetupStepProps['state'] }): JSX.Element {
  if (state.draftMachine.kind !== 'cnc') return <></>;
  const params = state.draftMachine.params;
  return (
    <>
      <ReviewRow label="Safe Z" value={`${params.safeZMm} mm`} />
      <ReviewRow
        label="Spindle"
        value={`${params.spindleMaxRpm} RPM; ${params.spindleSpinupSec} s dwell`}
      />
      <ReviewRow label="Coolant" value={params.coolant ?? 'off'} />
      <ReviewRow label="Park" value={`${params.parkXMm ?? 0}, ${params.parkYMm ?? 0} mm`} />
    </>
  );
}

function LaserOutputRows({
  state,
}: {
  readonly state: DeviceSetupStepProps['state'];
}): JSX.Element {
  const fire = state.draft.fireControl;
  return (
    <>
      <ReviewRow
        label="Power range"
        value={`${state.draft.minPowerS}–${state.draft.maxPowerS} S`}
      />
      <ReviewRow label="Laser mode" value={state.draft.laserModeEnabled ? 'Expected on' : 'Off'} />
      <ReviewRow label="Air output" value={state.draft.airAssistCommand} />
      <ReviewRow
        label="Low-power Fire"
        value={fire?.enabled === true ? `Enabled, ${fire.maxPowerPercent}% cap` : 'Disabled'}
      />
    </>
  );
}

function SafetyReview(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly onEdit: () => void;
}): JSX.Element {
  const { state } = props;
  const poweredZ =
    state.draft.capabilities?.includes('z-axis') === true
      ? `${state.draft.zTravelMm ?? 'unknown'} mm`
      : 'Disabled';
  return (
    <ReviewSection title="Safety and optional features" onEdit={props.onEdit}>
      <ReviewRow
        label="No-go zones"
        value={`${state.draft.noGoZones.filter((zone) => zone.enabled).length} enabled`}
      />
      <ReviewRow label="Powered Z" value={poweredZ} />
      <ReviewRow
        label="Probe"
        value={
          state.draft.zProbePresent === true ? 'Recorded; hardware test pending' : 'Not recorded'
        }
      />
      {state.machineKind === 'laser' ? <LaserSafetyRows state={state} /> : null}
    </ReviewSection>
  );
}

function LaserSafetyRows({
  state,
}: {
  readonly state: DeviceSetupStepProps['state'];
}): JSX.Element {
  return (
    <>
      <ReviewRow
        label="Rotary"
        value={state.draft.rotary?.enabled === true ? 'Enabled' : 'Disabled'}
      />
      <ReviewRow
        label="Camera"
        value={
          state.draft.cameraAlignment === undefined ? 'Alignment pending / unchanged' : 'Aligned'
        }
      />
    </>
  );
}

function ReviewSection(props: {
  readonly title: string;
  readonly onEdit: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <article style={cardStyle}>
      <header style={cardHeaderStyle}>
        <strong>{props.title}</strong>
        <Button variant="ghost" onClick={props.onEdit}>
          Edit
        </Button>
      </header>
      <dl style={definitionStyle}>{props.children}</dl>
    </article>
  );
}

function ReviewRow(props: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </>
  );
}

function HardwareHandoff(props: { readonly machineKind: 'laser' | 'cnc' }): JSX.Element {
  return (
    <div style={hardwareStyle}>
      <strong>Hardware commissioning — operator check after saving</strong>
      <ul style={hardwareListStyle}>
        {hardwareChecklist(props.machineKind).map((item) => (
          <li key={item}>☐ {item}</li>
        ))}
      </ul>
      <p style={hardwareNoteStyle}>
        Keep the emergency stop accessible. Start with outputs disabled and motion clear of clamps,
        then verify one item at a time. KerfDesk does not store these as complete automatically.
      </p>
    </div>
  );
}

function hardwareChecklist(machineKind: 'laser' | 'cnc'): ReadonlyArray<string> {
  const common = [
    'Emergency stop and disconnect path work',
    'Axis labels, positive directions, and travel limits match the machine',
    'Limit switches and homing direction are correct before running Home',
    'Origin and displayed position match a measured point',
    'Frame / dry-run path clears clamps, fixtures, and no-go zones',
  ];
  return machineKind === 'cnc'
    ? [
        ...common,
        'Z-positive retracts away from stock and Safe Z clears clamps',
        'Spindle S value, spin-up time, coolant relay, and park point are correct',
        'Probe plate thickness, electrical contact, and plate removal are verified',
      ]
    : [
        ...common,
        'Beam remains off during travel and at S0',
        'Lowest-power pulse and maximum S scale are verified on scrap',
        'Air-assist relay, focus method, enclosure, interlocks, and exhaust are verified',
      ];
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 9 };
const readyStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: 600,
  color: 'var(--lf-success)',
  fontSize: 12,
};
const pendingStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: 600,
  color: 'var(--lf-warning)',
  fontSize: 12,
};
const issueListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--lf-warning)',
  fontSize: 12,
};
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
};
const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 5,
  fontSize: 12,
};
const definitionStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '130px minmax(0, 1fr)',
  gap: '4px 10px',
  margin: 0,
  fontSize: 12,
};
const hardwareStyle: React.CSSProperties = {
  border: '1px solid var(--lf-warning)',
  borderRadius: 6,
  padding: 9,
  fontSize: 12,
};
const hardwareListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '7px 0',
  padding: 0,
  display: 'grid',
  gap: 4,
};
const hardwareNoteStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.45,
};
