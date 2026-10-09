import { useState } from 'react';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { connectMachine } from './connect-machine';

/** Explicit target, same live-controller session/driver as USB, no network discovery. */
function useFluidNcNetworkConnect() {
  const platform = usePlatform();
  const device = useStore((state) => state.project.device);
  const laser = useLaserStore();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [message, setMessage] = useState('');
  const network = platform.machineNetwork;
  const busy =
    laser.connection.kind === 'connected' ||
    laser.connection.kind === 'connecting' ||
    laser.controllerOperation !== null ||
    laser.motionOperation !== null;
  const connect = async (): Promise<void> => {
    if (network === undefined) return;
    const current = useStore.getState().project.device;
    if (current.controllerKind !== 'fluidnc' || current.controllerCommandSet !== undefined) {
      setMessage('Select the FluidNC protocol before connecting to its network channel.');
      return;
    }
    setMessage('Opening the entered FluidNC channel…');
    try {
      await connectMachine(
        { ...platform, serial: network.serialForTarget(host.trim(), Number(port)) },
        { hostedStreaming: false, portSelection: 'choose' },
      );
      const result = useLaserStore.getState().connection;
      setMessage(
        result.kind === 'connected'
          ? 'TCP channel connected; controller qualification is shown above.'
          : result.kind === 'failed'
            ? result.error
            : 'Network connection cancelled.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  return { network, device, busy, host, setHost, port, setPort, message, connect };
}

export function FluidNcNetworkConnect(): JSX.Element | null {
  const { network, device, busy, host, setHost, port, setPort, message, connect } =
    useFluidNcNetworkConnect();
  if (
    network === undefined ||
    device.controllerKind !== 'fluidnc' ||
    device.controllerCommandSet !== undefined
  )
    return null;
  return (
    <details>
      <summary title="Connect explicitly to the enabled FluidNC Telnet TCP channel in the desktop app.">
        FluidNC network connection
      </summary>
      <p>
        Enter the machine IP or hostname and its enabled Telnet/Port value. This uses the same
        FluidNC driver and Frame workflow. Disconnect the current controller first. Targets last
        only in this panel; there is no automatic scan, reconnect or command replay.
      </p>
      <p>Telnet is unencrypted. Use this channel on a trusted network.</p>
      <label>
        Machine IP or hostname
        <input
          aria-label="FluidNC machine IP or hostname"
          title="Operator-entered machine IP address or hostname; no URL or credentials."
          value={host}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => setHost(event.target.value)}
        />
      </label>
      <label>
        Telnet/Port
        <input
          type="number"
          aria-label="FluidNC Telnet port"
          title="Enter the Telnet/Port configured and enabled on your FluidNC controller."
          min={1}
          max={65535}
          step={1}
          value={port}
          disabled={busy}
          onChange={(event) => setPort(event.target.value)}
        />
      </label>
      <p>
        Keep the app responsive while streaming: this TCP session runs in the renderer and is not
        hosted in a background worker. Loss of the renderer or channel closes the transport;
        reconnect explicitly and review recovery.
      </p>
      <button
        type="button"
        title={
          busy
            ? 'Disconnect the current controller and finish setup motion before opening a network channel.'
            : 'Open only the entered FluidNC TCP target'
        }
        disabled={busy || host.trim() === '' || port === ''}
        onClick={() => void connect()}
      >
        Connect FluidNC network
      </button>
      {message !== '' && <p role="status">{message}</p>}
    </details>
  );
}
