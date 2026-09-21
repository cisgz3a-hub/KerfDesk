import { Fragment } from 'react';
import { Button } from '../../kit';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { deviceSetupSupportsMachineKind } from './device-setup-flow';
import type { FirmwareDiff } from './device-setup-firmware-diff';
import { machineSetupControllerGuide } from './machine-setup-controller-guide';

type ReviewRows = ReadonlyArray<readonly [label: string, value: string]>;

export function DeviceSetupReviewSections({
  state,
  dispatch,
  firmwareWrites,
}: DeviceSetupStepProps & { readonly firmwareWrites: ReadonlyArray<FirmwareDiff> }): JSX.Element {
  return (
    <>
      <DeviceSetupReviewCard
        title="Machine and connection"
        onEdit={() => dispatch({ kind: 'go', step: 'identify' })}
        rows={connectionRows(state, firmwareWrites)}
      />
      <DeviceSetupReviewCard
        title="Workspace and coordinates"
        onEdit={() => dispatch({ kind: 'go', step: 'confirm' })}
        rows={workspaceRows(state)}
      />
      {deviceSetupSupportsMachineKind(state, 'laser') ? (
        <DeviceSetupReviewCard
          title="Laser machine output"
          onEdit={() => dispatch({ kind: 'go', step: 'confirm' })}
          rows={laserRows(state)}
        />
      ) : null}
      {deviceSetupSupportsMachineKind(state, 'cnc') ? (
        <DeviceSetupReviewCard
          title="CNC machine output"
          onEdit={() => dispatch({ kind: 'go', step: 'cnc-setup' })}
          rows={cncRows(state)}
        />
      ) : null}
      <DeviceSetupReviewCard
        title="Safety and optional features"
        onEdit={() => dispatch({ kind: 'go', step: 'options' })}
        rows={safetyRows(state)}
      />
    </>
  );
}

function connectionRows(
  state: DeviceSetupStepProps['state'],
  firmwareWrites: ReadonlyArray<FirmwareDiff>,
): ReviewRows {
  const guide = machineSetupControllerGuide(
    state.draft.controllerKind ?? 'grbl-v1.1',
    state.draft.controllerCommandSet,
  );
  const serial = guide.transportLabel === 'USB serial';
  const capability =
    state.machineKinds.length === 2
      ? 'Laser + CNC'
      : state.machineKinds[0] === 'cnc'
        ? 'CNC only'
        : 'Laser only';
  return [
    ['Capability', capability],
    ['Active mode', state.machineKind === 'cnc' ? 'CNC' : 'Laser'],
    ['Profile', state.draft.name],
    ['Controller', `${guide.label} (${guide.transportLabel})`],
    ['Baud', serial ? String(state.draft.baudRate ?? guide.defaultBaudRate) : 'Not used'],
    ['Output', serial ? state.draft.gcodeDialect.dialectId : 'Ruida .rd file'],
    [
      'Streaming',
      serial
        ? `${state.draft.streamingMode}${state.draft.streamingMode === 'char-counted' ? `, ${state.draft.rxBufferBytes} bytes` : ''}`
        : 'Not used',
    ],
    ['Firmware after save', firmwareSummary(firmwareWrites)],
  ];
}

function workspaceRows(state: DeviceSetupStepProps['state']): ReviewRows {
  const guide = machineSetupControllerGuide(
    state.draft.controllerKind ?? 'grbl-v1.1',
    state.draft.controllerCommandSet,
  );
  return [
    ['Work area', `${state.draft.bedWidth} × ${state.draft.bedHeight} mm`],
    ['Origin', state.draft.origin],
    [
      'Homing',
      state.draft.homing.enabled
        ? `${guide.homeCommand ?? 'enabled'} toward ${state.draft.homing.direction}`
        : 'Disabled',
    ],
    [
      'Output max / requested Frame feed',
      `${state.draft.maxFeed} / ${state.draft.framingFeedMmPerMin} mm/min`,
    ],
  ];
}

function laserRows(state: DeviceSetupStepProps['state']): ReviewRows {
  const fire = state.draft.fireControl;
  return [
    ['Power range', `${state.draft.minPowerS}–${state.draft.maxPowerS} S`],
    ['Laser mode', state.draft.laserModeEnabled ? 'Expected on' : 'Off'],
    ['Air output', state.draft.airAssistCommand],
    [
      'Low-power Fire',
      fire?.enabled === true ? `Enabled, ${fire.maxPowerPercent}% cap` : 'Disabled',
    ],
  ];
}

function cncRows(state: DeviceSetupStepProps['state']): ReviewRows {
  const params = state.cncDraft.params;
  return [
    ['Safe Z', `${params.safeZMm} mm`],
    ['Spindle', `${params.spindleMaxRpm} RPM; ${params.spindleSpinupSec} s dwell`],
    ['Coolant', params.coolant ?? 'off'],
    ['Park', `${params.parkXMm ?? 0}, ${params.parkYMm ?? 0} mm`],
  ];
}

function firmwareSummary(writes: ReadonlyArray<FirmwareDiff>): string {
  if (writes.length === 0) return 'No writes queued';
  const values = writes.map((write) => `${write.code}=${write.desired}`).join(', ');
  return `${writes.length} queued: ${values}; exact re-read required`;
}

function safetyRows(state: DeviceSetupStepProps['state']): ReviewRows {
  const rows: Array<readonly [string, string]> = [
    ['No-go zones', `${state.draft.noGoZones.filter((zone) => zone.enabled).length} enabled`],
    [
      'Powered Z',
      state.draft.capabilities?.includes('z-axis') === true
        ? `${state.draft.zTravelMm ?? 'unknown'} mm`
        : 'Disabled',
    ],
    [
      'Probe',
      state.draft.zProbePresent === true ? 'Recorded; hardware test pending' : 'Not recorded',
    ],
  ];
  if (deviceSetupSupportsMachineKind(state, 'laser')) {
    rows.push(
      ['Rotary', state.draft.rotary?.enabled === true ? 'Enabled' : 'Disabled'],
      [
        'Camera',
        state.draft.cameraAlignment === undefined ? 'Alignment pending / unchanged' : 'Aligned',
      ],
    );
  }
  return rows;
}

export function DeviceSetupReviewCard({
  title,
  onEdit,
  rows,
}: {
  readonly title: string;
  readonly onEdit: () => void;
  readonly rows: ReviewRows;
}): JSX.Element {
  return (
    <article className="lf-setup-review-card">
      <header>
        <h3>{title}</h3>
        <Button
          variant="ghost"
          aria-label={`Edit ${title}`}
          title={`Edit ${title}`}
          onClick={onEdit}
        >
          Edit
        </Button>
      </header>
      <dl>
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
      </dl>
    </article>
  );
}
