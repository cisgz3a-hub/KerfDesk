import { useState } from 'react';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { connectMachine } from './connect-machine';
import { machineNetworkProfileForDevice } from './machine-network-profile';

type NetworkProfile = NonNullable<ReturnType<typeof machineNetworkProfileForDevice>>;
function connectionBusy(laser: ReturnType<typeof useLaserStore.getState>): boolean {
  return (
    laser.connection.kind === 'connected' ||
    laser.connection.kind === 'connecting' ||
    laser.controllerOperation !== null ||
    laser.motionOperation !== null
  );
}

/** Explicit target, same live-controller session/driver as USB, no network discovery. */
function useMachineNetworkConnect(profile: NetworkProfile) {
  const platform = usePlatform();
  const busy = useLaserStore(connectionBusy);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [message, setMessage] = useState('');
  const network = platform.machineNetwork;
  const connect = async (): Promise<void> => {
    if (network === undefined || connectionBusy(useLaserStore.getState())) return;
    const current = machineNetworkProfileForDevice(useStore.getState().project.device);
    if (current === null || current.kind !== profile.kind) {
      setMessage(
        'Select a supported controller protocol before connecting to its network channel.',
      );
      return;
    }
    setMessage(`Opening the entered ${current.label} channel…`);
    try {
      const targetHost = host.trim();
      const targetPort = Number(port);
      const serial = network.serialForTarget(targetHost, targetPort, current.protocol);
      await connectMachine(
        { ...platform, serial },
        { hostedStreaming: false, portSelection: 'choose' },
        { kind: current.kind, serial, host: targetHost, port: targetPort },
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
  return { busy, host, setHost, port, setPort, message, connect };
}

export function MachineNetworkConnect(): JSX.Element | null {
  const platform = usePlatform();
  const device = useStore((state) => state.project.device);
  const profile = machineNetworkProfileForDevice(device);
  if (platform.machineNetwork === undefined || profile === null) return null;
  return <NetworkConnectForm key={profile.kind} profile={profile} />;
}

function NetworkConnectForm({ profile }: { readonly profile: NetworkProfile }): JSX.Element {
  const { busy, host, setHost, port, setPort, message, connect } =
    useMachineNetworkConnect(profile);
  const validPort = Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535;
  return (
    <details>
      <summary
        title={`Connect ${profile.label} over Wi-Fi or Ethernet using its enabled network service.`}
      >
        {profile.label} network connection
      </summary>
      <p>
        Connect over Wi-Fi or an Ethernet cable. Enter the machine IP or hostname and its configured{' '}
        {profile.portSetting}. {profile.channelDescription} Disconnect the current controller first.
      </p>
      <p>This connection is unencrypted. Use a trusted local network.</p>
      <label>
        Machine IP or hostname
        <input
          aria-label={`${profile.label} machine IP or hostname`}
          title="Operator-entered machine IP address or hostname; no URL or credentials."
          value={host}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => setHost(event.target.value)}
        />
      </label>
      <label>
        {profile.portSetting}
        <input
          type="number"
          aria-label={`${profile.label} Telnet port`}
          title={`Enter the ${profile.portSetting} configured and enabled on your ${profile.label} controller.`}
          min={1}
          max={65535}
          step={1}
          value={port}
          disabled={busy}
          onChange={(event) => setPort(event.target.value)}
        />
      </label>
      <p>
        Keep KerfDesk open and responsive while sending a job. After a lost connection, reconnect
        yourself and review recovery; commands are never replayed automatically. The address is kept
        only while this panel or its setup is open.
      </p>
      <button
        type="button"
        title={
          busy
            ? 'Disconnect the current controller and finish setup motion before opening a network channel.'
            : `Open only the entered ${profile.label} network target`
        }
        disabled={busy || host.trim() === '' || !validPort}
        onClick={() => void connect()}
      >
        Connect {profile.label} network
      </button>
      {message !== '' && <p role="status">{message}</p>}
    </details>
  );
}
