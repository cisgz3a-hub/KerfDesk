// Step 6: compare and, only for supported GRBL-dollar controllers, offer
// individually confirmed writes queued for final Save. Machine-critical travel
// settings never get a batch-write shortcut, and Cancel sends no command.

import { useState } from 'react';
import { Button } from '../../kit';
import { isActiveJob } from '../../state/laser-store-helpers';
import { useLaserStore } from '../../state/laser-store';
import { MachineSettingsPanel } from '../MachineSettingsPanel';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { computeFirmwareDiffs, type FirmwareDiff } from './device-setup-firmware-diff';
import { machineSetupControllerGuide } from './machine-setup-controller-guide';

export function DeviceSetupFirmwareStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const lastReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const connection = useLaserStore((s) => s.connection);
  const activeControllerKind = useLaserStore((s) => s.activeControllerKind);
  const controllerKind = state.draft.controllerKind ?? 'grbl-v1.1';
  const guide = machineSetupControllerGuide(controllerKind);

  if (guide.writePolicy !== 'guarded-single-setting') {
    return <ExternalConfigurationNotice guide={guide} />;
  }
  if (connection.kind !== 'connected') {
    return (
      <section style={sectionStyle}>
        <p style={hintStyle}>
          Connect the controller to compare firmware. This step is optional — saving the software
          profile never requires a firmware write.
        </p>
      </section>
    );
  }
  if (activeControllerKind !== controllerKind) {
    return (
      <section style={sectionStyle}>
        <p role="alert" style={warningStyle}>
          Firmware writes are blocked because the active connection uses {activeControllerKind},
          while this draft uses {controllerKind}. Reconnect correctly on step 2 first.
        </p>
      </section>
    );
  }
  if (lastReadAt === null) {
    return (
      <section style={sectionStyle}>
        <p style={hintStyle}>
          Read and export a controller backup before any write. You can skip this step and save the
          software profile without changing firmware.
        </p>
        <MachineSettingsPanel defaultOpen />
      </section>
    );
  }
  return <ComparedFirmware state={state} dispatch={dispatch} rows={rows} />;
}

function ComparedFirmware(props: {
  readonly state: DeviceSetupStepProps['state'];
  readonly dispatch: DeviceSetupStepProps['dispatch'];
  readonly rows: ReturnType<typeof useLaserStore.getState>['grblSettingsRows'];
}): JSX.Element {
  const { state, dispatch, rows } = props;
  const diffs = computeFirmwareDiffs(state.draft, rows, state.draftMachine);
  const writable = diffs.filter((diff) => diff.differs && diff.writable);
  const infoOnly = diffs.filter((diff) => diff.differs && !diff.writable);
  return (
    <section style={sectionStyle}>
      <p style={hintStyle}>
        Export the current settings first. Only common power settings can be queued below. Final
        Save commits the software profile first, then writes each queued value and verifies it by
        exact re-read. Cancel sends no firmware command.
      </p>
      <MachineSettingsPanel defaultOpen />
      <label style={backupStyle}>
        <input
          type="checkbox"
          checked={state.firmwareBackupConfirmed}
          onChange={(event) =>
            dispatch({
              kind: 'set-firmware-backup-confirmed',
              confirmed: event.target.checked,
            })
          }
          aria-label="Confirm controller backup exported"
          title="Attest that the current settings dump was exported and stored before queueing a write."
        />
        I exported and stored the current controller settings backup.
      </label>
      {writable.length === 0 && infoOnly.length === 0 ? (
        <p style={okStyle}>The compared controller values match this software profile.</p>
      ) : null}
      {writable.map((diff) => (
        <FirmwareSyncRow
          key={diff.id}
          diff={diff}
          backupConfirmed={state.firmwareBackupConfirmed}
          queued={state.queuedFirmwareWriteIds.includes(diff.id)}
          onToggle={() => dispatch({ kind: 'toggle-firmware-write', id: diff.id })}
        />
      ))}
      {infoOnly.length > 0 ? (
        <div style={infoStyle}>
          <strong>Review only — never batch-written:</strong>
          <ul style={listStyle}>
            {infoOnly.map((diff) => (
              <li key={diff.id}>
                {diff.code} {diff.label}: controller {diff.current} → profile {diff.desired}. Check
                the hardware manual and use the controller manufacturer&apos;s procedure after a
                backup.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ExternalConfigurationNotice(props: {
  readonly guide: ReturnType<typeof machineSetupControllerGuide>;
}): JSX.Element {
  const { guide } = props;
  return (
    <section style={sectionStyle}>
      <p style={hintStyle}>
        <strong>{guide.label} configuration is not written from KerfDesk.</strong>
      </p>
      <p style={hintStyle}>{guide.writeExplanation}</p>
      <dl style={definitionStyle}>
        <dt>Configure in</dt>
        <dd>{guide.configurationSurface}</dd>
        <dt>Read commands</dt>
        <dd>{guide.settingsCommands.join(', ') || 'None in this build'}</dd>
        <dt>Write policy</dt>
        <dd>{guide.writePolicy}</dd>
      </dl>
    </section>
  );
}

function FirmwareSyncRow(props: {
  readonly diff: FirmwareDiff;
  readonly backupConfirmed: boolean;
  readonly queued: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  const { diff } = props;
  const [confirmed, setConfirmed] = useState(false);
  const connection = useLaserStore((s) => s.connection);
  const statusReport = useLaserStore((s) => s.statusReport);
  const streamer = useLaserStore((s) => s.streamer);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const canQueue =
    props.backupConfirmed &&
    confirmed &&
    connection.kind === 'connected' &&
    statusReport?.state === 'Idle' &&
    !isActiveJob(streamer) &&
    motionOperation === null &&
    controllerOperation === null &&
    !autofocusBusy;
  const toggle = (): void => {
    props.onToggle();
    setConfirmed(false);
  };
  return (
    <article style={rowStyle}>
      <div style={rowInfoStyle}>
        <strong>{diff.code}</strong> {diff.label}
        <span style={mutedStyle}>
          {' '}
          — controller {diff.current} → profile {diff.desired}
        </span>
      </div>
      <label style={confirmStyle}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          aria-label={`Confirm write ${diff.code}`}
          title={`Confirm the exact proposed value ${diff.code}=${diff.desired} before it can be queued.`}
        />
        Confirm {diff.code}={diff.desired}
      </label>
      <Button
        variant={props.queued ? 'default' : 'primary'}
        disabled={!props.queued && !canQueue}
        onClick={toggle}
      >
        {props.queued ? `Remove queued ${diff.code}` : `Queue ${diff.code} for Save`}
      </Button>
    </article>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 9 };
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.45,
};
const okStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-success)', fontWeight: 600 };
const warningStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-warning)', fontSize: 12 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
};
const rowInfoStyle: React.CSSProperties = { flex: 1, fontSize: 12, minWidth: 210 };
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const confirmStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  cursor: 'pointer',
};
const backupStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 12,
  fontWeight: 600,
};
const infoStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-muted)' };
const listStyle: React.CSSProperties = { margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.5 };
const definitionStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px minmax(0, 1fr)',
  gap: '5px 10px',
  margin: 0,
  fontSize: 12,
};
