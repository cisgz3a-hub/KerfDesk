// Machine details panel for a Ruida reached over the network (ADR-697): an
// explicit IPv4 target, then Frame, Start, Pause, Resume and Abort — the
// controls the driver's datagramNetwork capabilities list, nothing else.
// Desktop only (browsers have no UDP); .rd export is unchanged beside it.

import { useState } from 'react';
import { selectControllerDriver } from '../../core/controllers';
import type { RuidaNetworkAdapter } from '../../platform/ruida-network-types';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import {
  RUIDA_NOT_QUALIFIED,
  ruidaStatusText,
} from '../state/ruida-network/ruida-network-messages';
import { prepareRuidaNetworkJob } from '../state/ruida-network/ruida-network-job';
import {
  useRuidaNetworkStore,
  type RuidaNetworkState,
} from '../state/ruida-network/ruida-network-store';

export function RuidaNetworkPanel(): JSX.Element | null {
  const platform = usePlatform();
  const controllerKind = useStore((state) => state.project.device.controllerKind);
  const network = platform.ruidaNetwork;
  if (network === undefined || selectControllerDriver(controllerKind).datagramNetwork === undefined)
    return null;
  return <RuidaNetworkDetails network={network} />;
}

function RuidaNetworkDetails({ network }: { readonly network: RuidaNetworkAdapter }): JSX.Element {
  const ruida = useRuidaNetworkStore();
  return (
    <details>
      <summary title="Connect a Ruida controller over Ethernet or Wi-Fi (UDP port 50200).">
        Ruida network connection (experimental)
      </summary>
      <p role="note">{RUIDA_NOT_QUALIFIED}</p>
      <p>
        Enter the IP address shown on the controller panel. Close LightBurn and RDWorks first: only
        one program can hold the reply port. This connection is unencrypted; use a trusted local
        network.
      </p>
      <RuidaConnectRow network={network} ruida={ruida} />
      {ruida.phase !== 'disconnected' && ruida.phase !== 'connecting' && (
        <RuidaJobControls ruida={ruida} />
      )}
      {ruida.message !== '' && (
        <p role="status" data-tone={ruida.tone}>
          {ruida.message}
        </p>
      )}
      {ruida.advisories.length > 0 && (
        <ul aria-label="Job warnings">
          {ruida.advisories.map((advisory) => (
            <li key={advisory}>{advisory}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function RuidaConnectRow({
  network,
  ruida,
}: {
  readonly network: RuidaNetworkAdapter;
  readonly ruida: RuidaNetworkState;
}): JSX.Element {
  const [host, setHost] = useState('');
  const disconnected = ruida.phase === 'disconnected';
  return (
    <>
      <label>
        Controller IP address
        <input
          aria-label="Ruida controller IP address"
          title="The controller's IPv4 address on your local network, as its panel shows it."
          value={disconnected ? host : (ruida.host ?? host)}
          disabled={!disconnected}
          autoComplete="off"
          onChange={(event) => setHost(event.target.value)}
        />
      </label>
      {disconnected || ruida.phase === 'connecting' ? (
        <button
          type="button"
          title="Open UDP to the entered controller address and read its status."
          disabled={!disconnected || host.trim() === ''}
          onClick={() => void ruida.connect(network, host.trim())}
        >
          Connect Ruida
        </button>
      ) : (
        <button
          type="button"
          title="Close the Ruida link. A running job gets Stop Process first."
          onClick={() => void ruida.disconnect()}
        >
          Disconnect Ruida
        </button>
      )}
    </>
  );
}

function RuidaJobControls({ ruida }: { readonly ruida: RuidaNetworkState }): JSX.Element {
  const [compileError, setCompileError] = useState('');
  const idle = ruida.phase === 'idle';
  const active = ruida.phase === 'framing' || ruida.phase === 'running' || ruida.phase === 'paused';
  const sending = ruida.sending !== null;
  const withJob = async (action: 'frame' | 'start'): Promise<void> => {
    const { project, jobPlacement } = useStore.getState();
    const prepared = await prepareRuidaNetworkJob(project, jobPlacement);
    if (!prepared.ok) {
      setCompileError(prepared.messages.join(' '));
      return;
    }
    setCompileError('');
    await (action === 'frame' ? ruida.frame(prepared.job) : ruida.start(prepared.job));
  };
  return (
    <>
      <p>
        Controller status: {ruidaStatusText(ruida.status)}
        {ruida.positionMm !== null &&
          ` · X ${ruida.positionMm.x.toFixed(1)} Y ${ruida.positionMm.y.toFixed(1)} mm`}
        {ruida.sending !== null &&
          ` · sent ${ruida.sending.acknowledged}/${ruida.sending.total} datagrams`}
      </p>
      <button
        type="button"
        title="Trace the job's outline with the laser off, where the job will run."
        disabled={!idle}
        onClick={() => void withJob('frame')}
      >
        Frame (laser off)
      </button>
      <button
        type="button"
        disabled={!idle || ruida.framed === null}
        title={ruida.framed === null ? 'Frame this job first.' : 'Send the framed job and run it.'}
        onClick={() => void withJob('start')}
      >
        Start
      </button>
      <button
        type="button"
        title="Send Pause Process to the controller."
        disabled={ruida.phase !== 'running' || sending}
        onClick={() => void ruida.pause()}
      >
        Pause
      </button>
      <button
        type="button"
        title="Send Restore Process to continue the paused job."
        disabled={ruida.phase !== 'paused'}
        onClick={() => void ruida.resume()}
      >
        Resume
      </button>
      <button
        type="button"
        title="Stop sending and send Stop Process. Keep a hand on the machine's Stop key."
        disabled={!active}
        onClick={() => void ruida.abort()}
      >
        Abort
      </button>
      {compileError !== '' && <p role="alert">{compileError}</p>}
    </>
  );
}
