import { useEffect, useState } from 'react';
import { controller } from '../core/controller';
import { formatMm } from '../core/numbers';
import { canControl } from '../core/store';
import type { MachineStatus } from '../core/types';
import { useApp } from './hooks';
import { Icon } from './icons';
import { JobCard, ReviewSheet } from './machine-job';
import { JogCard } from './machine-jog';
import { ActionButton } from './machine-parts';
import { Banner } from './primitives';

export function MachineScreen() {
  const machine = useApp((state) => state.machine);
  const scopes = useApp((state) => state.scopes);
  const sheet = useApp((state) => state.sheet);
  useEffect(() => {
    void controller.refreshMachine(true);
  }, []);
  if (!scopes.includes('control'))
    return (
      <div className="screen">
        <div className="stack">
          <h1 className="screen-title">Machine</h1>
          <Banner tone="info">
            <Icon name="lock" />
            <span>
              Machine control isn’t approved for this connection. Pair again and tick{' '}
              <b>Allow Connect, Home, Jog, Frame, Start, Pause and Abort</b> on the PC.
            </span>
          </Banner>
          {machine === null ? null : <StatusCard machine={machine} />}
        </div>
      </div>
    );
  return (
    <div className="screen">
      <div className="stack">
        {machine === null ? (
          <div className="skeleton" style={{ height: 160 }} />
        ) : (
          <StatusCard machine={machine} />
        )}
        {machine === null ? null : machine.connection === 'connected' ? (
          <>
            <JobCard machine={machine} />
            <JogCard machine={machine} />
            <SetupCard machine={machine} />
          </>
        ) : (
          <SetupCard machine={machine} />
        )}
        {machine?.camera?.available === true ? <CameraCard /> : null}
      </div>
      {sheet?.kind === 'review' ? <ReviewSheet /> : null}
    </div>
  );
}

function stateTone(machine: MachineStatus): 'success' | 'warning' | 'danger' | 'info' | '' {
  if (machine.connection !== 'connected') return '';
  const state = machine.controllerState ?? '';
  if (/alarm/i.test(state)) return 'danger';
  if (/hold|door/i.test(state)) return 'warning';
  if (/run|jog|home/i.test(state)) return 'info';
  return 'success';
}

function StatusCard({ machine }: { machine: MachineStatus }) {
  const connected = machine.connection === 'connected';
  const label = !connected
    ? machine.connection === 'connecting'
      ? 'Connecting…'
      : 'Not connected'
    : (machine.controllerState ?? 'Connected');
  const position = machine.position;
  return (
    <div className="card">
      <div className="status-line">
        <span className="state-big">{label}</span>
        <span className={`chip ${stateTone(machine)}`}>
          {machine.mode === 'cnc' ? 'CNC' : 'Laser'}
        </span>
        {machine.homing === 'confirmed' ? <span className="chip success">Homed</span> : null}
        {machine.frame.complete ? <span className="chip success">Framed</span> : null}
      </div>
      {position === undefined ? (
        <p className="note">Position appears once the machine reports it.</p>
      ) : (
        <div className="dro" aria-label="Work position">
          <div>
            <b>X</b>
            <span>{formatMm(position.xMm)}</span>
          </div>
          <div>
            <b>Y</b>
            <span>{formatMm(position.yMm)}</span>
          </div>
          <div>
            <b>Z</b>
            <span>{position.zMm === undefined ? '—' : formatMm(position.zMm)}</span>
          </div>
        </div>
      )}
      <p className="note">
        Work position{position?.wcs === undefined ? '' : ` (${position.wcs})`} in mm, as reported by
        the PC.
      </p>
    </div>
  );
}

function SetupCard({ machine }: { machine: MachineStatus }) {
  const [confirmHome, setConfirmHome] = useState(false);
  const a = machine.availability;
  if (a.connect === undefined) return null;
  const connected = machine.connection === 'connected';
  if (!connected)
    return (
      <div className="card">
        <div className="card-title">Connect the machine</div>
        <ActionButton
          icon="plug"
          label="Connect"
          primary
          availability={a.connect}
          onClick={() => void controller.machineAction('connect_machine')}
        />
        <p className="note">
          {a.connect.available === false && a.connect.reason !== undefined
            ? a.connect.reason
            : 'Uses the port already chosen on the PC. The first connection must be made there.'}
        </p>
      </div>
    );
  return (
    <div className="card">
      <div className="card-title">Setup</div>
      <div className="btn-row">
        {machine.homing !== 'not_supported' ? (
          <ActionButton
            icon="home"
            label="Home"
            availability={a.home}
            onClick={() => setConfirmHome(true)}
          />
        ) : null}
        <ActionButton
          icon="target"
          label="Set origin here"
          availability={a.origin}
          onClick={() => void controller.machineAction('set_work_origin', { axes: 'xy' })}
        />
        {machine.jog.zSupported ? (
          <ActionButton
            icon="down"
            label="Zero Z"
            availability={a.origin}
            onClick={() => void controller.machineAction('set_work_origin', { axes: 'z' })}
          />
        ) : null}
      </div>
      {confirmHome ? (
        <Banner tone="warning">
          <span style={{ flex: 1 }}>
            The machine will move to its limit switches. Make sure the work area is clear.
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setConfirmHome(false);
              void controller.machineAction('home_machine');
            }}
          >
            Home
          </button>
        </Banner>
      ) : null}
      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginTop: 8 }}
        disabled={a.disconnect?.available === false}
        title={a.disconnect?.reason}
        onClick={() => void controller.machineAction('disconnect_machine')}
      >
        <Icon name="unplug" size={18} /> Disconnect
      </button>
    </div>
  );
}

function CameraCard() {
  const camera = useApp((state) => state.camera);
  const sharing = useApp((state) => state.workspace?.permissions?.artworkSharingEnabled === true);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card camera">
      <div className="card-title">
        Camera <span className="spacer" />
        <button
          type="button"
          className="btn btn-soft"
          style={{ minHeight: 40 }}
          disabled={busy || !sharing}
          onClick={async () => {
            setBusy(true);
            await controller.cameraSnapshot();
            setBusy(false);
          }}
        >
          {busy ? <span className="spinner" /> : <Icon name="camera" size={18} />}{' '}
          {camera === null ? 'Show' : 'Refresh'}
        </button>
      </div>
      {!sharing ? (
        <p className="note">Turn on artwork sharing on the PC to see the camera here.</p>
      ) : null}
      {camera === null ? null : (
        <img
          alt="Machine camera still from the PC"
          src={`data:image/jpeg;base64,${camera.data}`}
          width={camera.width}
          height={camera.height}
          style={{ height: 'auto' }}
        />
      )}
      {camera === null ? null : (
        <p className="note">
          Taken {new Date(camera.at).toLocaleTimeString()}. Not an alignment guarantee.
        </p>
      )}
    </div>
  );
}

export function AbortDock() {
  const machine = useApp((state) => state.machine);
  const allowed = useApp(canControl);
  const pending = useApp(
    (state) =>
      state.operation !== null &&
      !['completed', 'cancelled', 'failed', 'unknown'].includes(state.operation.state),
  );
  if (!allowed || machine === null || machine.connection !== 'connected') return null;
  const moving =
    machine.job.active ||
    machine.motion.kind !== 'idle' ||
    pending ||
    controller.holdActive() ||
    /run|jog|home|hold/i.test(machine.controllerState ?? '');
  if (!moving) return null;
  return (
    <div className="abort-dock">
      <button type="button" className="abort-btn" onClick={() => void controller.abort()}>
        <Icon name="stop" size={24} /> Abort
      </button>
      <p className="abort-note">
        Software stop through the PC. Use the machine’s emergency stop if the connection fails.
      </p>
    </div>
  );
}
