import { useEffect, useReducer } from 'react';
import { Button } from '../kit';
import {
  settingsGroupStyle,
  settingsHeadingStyle,
  settingsNoteStyle,
} from '../settings/settings-styles';
import {
  getAgedRemoteAccessStatus,
  useRemoteAccessStore,
  type RemoteAccessStatus,
} from './remote-access-store';
import { CopyConnectionValue } from './CopyConnectionValue';
import { PairingLinkCard } from './PairingLinkCard';
import { oneTimePairingLink, phoneControlUrl } from './pairing-link';

const noteStyle: React.CSSProperties = { ...settingsNoteStyle, fontSize: 13, lineHeight: 1.5 };

export function PairingControls(): JSX.Element {
  const { status, busy, act } = useRemoteAccessStore();
  useExpiryRefresh(status?.pairing?.code);
  const current = getAgedRemoteAccessStatus();
  return (
    <section style={settingsGroupStyle}>
      <h3 style={settingsHeadingStyle}>Connect your phone</h3>
      <ol style={{ ...noteStyle, paddingLeft: 20 }}>
        <li>Create a pairing link below.</li>
        <li>Scan the QR code with your phone, or copy the link to your phone.</li>
        <li>Request access on the phone, then choose its permissions here on the PC.</li>
      </ol>
      <Button
        variant="primary"
        disabled={busy || status?.connected !== true || status.pairingPending}
        onClick={() => {
          void act('pair');
        }}
      >
        Create pairing link
      </Button>
      <PairingReadiness status={current} />
      <CurrentPairing status={status} current={current} />
      <ManualPairingDetails status={current} />
      <ConnectionUrls status={current} />
    </section>
  );
}
function CurrentPairing({
  status,
  current,
}: {
  readonly status: RemoteAccessStatus | null;
  readonly current: RemoteAccessStatus | null;
}): JSX.Element | null {
  if (status?.pairingPending === true) return <p role="status">Creating a new pairing link…</p>;
  const link = oneTimePairingLink(current);
  if (link !== null && current?.pairing != null)
    return <PairingLinkCard key={link} link={link} expiresInMs={current.pairing.expiresInMs} />;
  return status?.pairing != null && current?.pairing == null ? (
    <p role="status">Pairing link expired. Create a new pairing link.</p>
  ) : null;
}

function useExpiryRefresh(code: string | undefined): void {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (code === undefined) return;
    const update = (): void => refresh();
    const timer = window.setInterval(update, 1000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [code]);
}
function PairingReadiness({
  status,
}: {
  readonly status: RemoteAccessStatus | null;
}): JSX.Element | null {
  if (status?.enabled !== true)
    return <p style={noteStyle}>Turn on remote connections above to create a pairing link.</p>;
  if (!status.connected)
    return <p style={noteStyle}>Wait for Ready to pair before creating a pairing link.</p>;
  return null;
}
function ManualPairingDetails({
  status,
}: {
  readonly status: RemoteAccessStatus | null;
}): JSX.Element | null {
  if (status?.enabled !== true || status.deviceId === null) return null;
  const phoneUrl = phoneControlUrl(status.controlUrl);
  return (
    <details>
      <summary
        title="Show the computer ID and pairing code when you cannot scan or open the pairing link."
        style={{ cursor: 'pointer', padding: '8px 0' }}
      >
        Manual phone setup
      </summary>
      <p style={noteStyle}>Use these details if your phone cannot scan or open the pairing link.</p>
      {phoneUrl === null ? null : (
        <p>
          <a href={phoneUrl} target="_blank" rel="noopener noreferrer">
            Open the phone control page
          </a>
        </p>
      )}
      <p style={{ ...noteStyle, overflowWrap: 'anywhere', userSelect: 'all' }}>
        Computer ID: {status.deviceId}
      </p>
      <CopyConnectionValue key={status.deviceId} value={status.deviceId} label="Copy computer ID" />
      {status.pairing === null ? null : (
        <>
          <p style={noteStyle}>Pairing code (exact letter case):</p>
          <strong
            style={{ fontFamily: 'monospace', fontSize: 20, letterSpacing: 2, userSelect: 'all' }}
          >
            {status.pairing.code}
          </strong>
          <CopyConnectionValue
            key={status.pairing.code}
            value={status.pairing.code}
            label="Copy code"
          />
        </>
      )}
    </details>
  );
}
function ConnectionUrls({
  status,
}: {
  readonly status: RemoteAccessStatus | null;
}): JSX.Element | null {
  if (status === null) return null;
  return (
    <details>
      <summary
        title="Show the server URL and sign-in steps for ChatGPT or another MCP app."
        style={{ cursor: 'pointer', padding: '8px 0' }}
      >
        Connect ChatGPT or another MCP app
      </summary>
      <p style={noteStyle}>
        Add this server URL in your MCP app’s connection settings. Use the computer ID and a new
        code from Manual phone setup during sign-in, then approve the connection on this PC.
      </p>
      <p style={{ ...noteStyle, overflowWrap: 'anywhere', userSelect: 'all' }}>{status.mcpUrl}</p>
      <CopyConnectionValue key={status.mcpUrl} value={status.mcpUrl} label="Copy server URL" />
      <p style={noteStyle}>
        ChatGPT custom connections depend on your plan, workspace and available client features.
      </p>
    </details>
  );
}
