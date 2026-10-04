import { useState } from 'react';
import { Button } from '../kit';
import { setArtworkSharingEnabled, useArtworkSharing } from './artwork-sharing';
import {
  settingsGroupStyle,
  settingsHeadingStyle,
  settingsNoteStyle,
  settingsRowStyle,
} from '../settings/settings-styles';
import { useRemoteAccessStore, type RemoteAccessStatus } from './remote-access-store';

export function RemoteAccessSection(): JSX.Element {
  return (
    <>
      <RemoteConsent />
      <ArtworkSharingConsent />
      <PairingControls />
      <ApprovedClients />
    </>
  );
}
function ArtworkSharingConsent(): JSX.Element {
  const sharing = useArtworkSharing();
  const available = useRemoteAccessStore((state) => state.status?.available === true);
  const [failed, setFailed] = useState(false);
  return (
    <section style={settingsGroupStyle}>
      <label style={settingsRowStyle}>
        <input
          type="checkbox"
          checked={sharing}
          disabled={!available}
          onChange={(event) => {
            setFailed(!setArtworkSharingEnabled(event.currentTarget.checked));
          }}
        />
        <span>Share artwork previews and text with approved phones and MCP apps</span>
      </label>
      <p style={settingsNoteStyle}>
        This is off by default. Turning it on lets approved connections see your artwork and read
        its text. An MCP app can send this content to its AI provider. Turn it off to stop sharing
        future previews and text; it cannot erase content already received by a client.
      </p>
      {failed ? <p role="alert">Artwork sharing could not be saved and is off.</p> : null}
    </section>
  );
}
function connectionText(status: RemoteAccessStatus | null): string {
  if (status?.enabled !== true) return 'Remote access is off';
  return status.connected ? 'Connected to the remote service' : 'Waiting for the remote service';
}
/** This consent never prevents ordinary desktop use. */
function RemoteConsent(): JSX.Element {
  const { status, busy, message, act } = useRemoteAccessStore();
  return (
    <section style={settingsGroupStyle}>
      <h3 style={settingsHeadingStyle}>Phone & MCP access</h3>
      <p style={settingsNoteStyle}>
        Connect a phone control page, ChatGPT or another MCP client to this computer. KerfDesk must
        stay open and the computer must stay awake and online.
      </p>
      <p style={settingsNoteStyle}>
        Connected clients can read artwork summaries, machine limits, recipes and job review facts.
        An approved editing connection can add or edit text, arrange artwork, undo or redo its edits
        and change laser operation settings in Laser workspaces. Machine execution remains on the
        desktop.
      </p>
      <p style={settingsNoteStyle}>
        Requests and these summaries pass through KerfDesk’s Cloudflare service. An MCP client may
        send them to its AI provider. Licence keys, serial ports and saved file paths are excluded.
      </p>
      <label style={settingsRowStyle}>
        <input
          type="checkbox"
          title="Enable pairing with connections you approve on this computer."
          checked={status?.enabled ?? false}
          disabled={busy || status?.available !== true}
          onChange={(event) => {
            void act('configure', { enabled: event.currentTarget.checked });
          }}
        />
        <span>Allow approved remote connections</span>
      </label>
      <p role="status">{connectionText(status)}</p>
      <p style={settingsNoteStyle}>
        Turning this off disconnects clients immediately and revokes their access when this computer
        next connects.
      </p>
      {status?.error != null ? <p role="alert">{status.error}</p> : null}
      {message !== null ? <p role="alert">{message}</p> : null}
    </section>
  );
}
function PairingControls(): JSX.Element {
  const { status, busy, act } = useRemoteAccessStore();
  return (
    <section style={settingsGroupStyle}>
      <h3 style={settingsHeadingStyle}>Connect a phone or MCP client</h3>
      <p style={settingsNoteStyle}>
        Create a one-use pairing code, enter it on the phone or MCP sign-in page, then approve the
        connection on this computer. Codes expire after five minutes.
      </p>
      <Button
        disabled={busy || status?.connected !== true || status.pairingPending}
        onClick={() => {
          void act('pair');
        }}
      >
        Create pairing code
      </Button>
      {status?.pairingPending === true ? <p role="status">Creating a new pairing code…</p> : null}
      {status?.pairing != null ? (
        <p>
          Pairing code:{' '}
          <strong style={{ fontFamily: 'monospace', letterSpacing: 2 }}>
            {status.pairing.code}
          </strong>
        </p>
      ) : null}
      {status?.enabled === true && status.deviceId !== null ? (
        <p>
          <a href={status.controlUrl} target="_blank" rel="noreferrer">
            Open the phone control page
          </a>
        </p>
      ) : null}
      <ConnectionUrls status={status} />
    </section>
  );
}
function ConnectionUrls({
  status,
}: {
  readonly status: RemoteAccessStatus | null;
}): JSX.Element | null {
  if (status === null) return null;
  return (
    <>
      <p style={{ ...settingsNoteStyle, overflowWrap: 'anywhere' }}>
        Phone page: {status.controlUrl}
      </p>
      <p style={{ ...settingsNoteStyle, overflowWrap: 'anywhere' }}>
        MCP server URL: {status.mcpUrl}
      </p>
      {status.deviceId !== null ? (
        <p style={{ ...settingsNoteStyle, overflowWrap: 'anywhere' }}>
          Computer ID: {status.deviceId}
        </p>
      ) : null}
      <p style={settingsNoteStyle}>
        ChatGPT custom connections depend on your plan, workspace and available client features.
        Public plugin listing requires OpenAI review.
      </p>
    </>
  );
}
function ApprovedClients(): JSX.Element {
  const { status, busy, act } = useRemoteAccessStore();
  return (
    <section style={settingsGroupStyle}>
      <h3 style={settingsHeadingStyle}>Approved connections</h3>
      {(status?.clients.length ?? 0) === 0 ? (
        <p style={settingsNoteStyle}>No approved connections.</p>
      ) : null}
      {status?.clients.map((client) => (
        <div key={client.id} style={settingsRowStyle}>
          <span>
            {client.label} · {client.scopes.includes('edit') ? 'View and edit' : 'View only'}
          </span>
          <Button
            disabled={busy || !status.connected}
            onClick={() => {
              void act('revoke', { clientId: client.id });
            }}
          >
            Revoke
          </Button>
        </div>
      ))}
      <Button
        disabled={busy || status?.enabled !== true}
        onClick={() => {
          void act('revoke-all');
        }}
      >
        Revoke all connections
      </Button>
    </section>
  );
}
