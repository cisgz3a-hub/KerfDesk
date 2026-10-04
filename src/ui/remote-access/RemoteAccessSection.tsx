import { useState } from 'react';
import { Button } from '../kit';
import { PairingControls } from './PairingControls';
import { setArtworkSharingEnabled, useArtworkSharing } from './artwork-sharing';
import {
  settingsGroupStyle,
  settingsHeadingStyle,
  settingsNoteStyle,
  settingsRowStyle,
} from '../settings/settings-styles';
import { useRemoteAccessStore, type RemoteAccessStatus } from './remote-access-store';

const remoteNoteStyle: React.CSSProperties = {
  ...settingsNoteStyle,
  fontSize: 13,
  lineHeight: 1.5,
};

export function RemoteAccessSection(): JSX.Element {
  return (
    <>
      <RemoteConsent />
      <PairingControls />
      <ArtworkSharingConsent />
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
          title="Allow approved connections to receive artwork previews and existing text."
          checked={sharing}
          disabled={!available}
          onChange={(event) => {
            setFailed(!setArtworkSharingEnabled(event.currentTarget.checked));
          }}
        />
        <span>Share artwork previews and text with approved phones and MCP apps</span>
      </label>
      <p style={remoteNoteStyle}>
        This is off by default. Turning it on lets approved connections see your artwork and read
        its text. An MCP app can send this content to its AI provider. Turn it off to stop sharing
        future previews and text; it cannot erase content already received by a client.
      </p>
      {failed ? <p role="alert">Artwork sharing could not be saved and is off.</p> : null}
    </section>
  );
}
function connectionText(status: RemoteAccessStatus | null): string {
  if (status === null) return 'Loading connection status…';
  if (status?.enabled !== true) return 'Remote access is off';
  return status.connected ? 'Ready to pair' : 'Connecting to the remote service…';
}
/** This consent never prevents ordinary desktop use. */
function RemoteConsent(): JSX.Element {
  const { status, busy, message, act } = useRemoteAccessStore();
  return (
    <section style={settingsGroupStyle}>
      <h3 style={settingsHeadingStyle}>Phone & MCP access</h3>
      <p style={remoteNoteStyle}>
        Use your phone, ChatGPT or another MCP app with this workspace. Keep KerfDesk open and this
        computer awake and online.
      </p>
      <p style={remoteNoteStyle}>
        Viewing shows workspace summaries, machine limits, recipes and job review. Editing lets an
        approved connection change artwork and laser settings. Separately approving machine control
        enables Jog, Frame, Start and Abort from that connection.
      </p>
      <p style={remoteNoteStyle}>
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
      <p style={remoteNoteStyle}>
        Turning this off disconnects clients immediately and revokes their access when this computer
        next connects.
      </p>
      {status?.error != null ? <p role="alert">{status.error}</p> : null}
      {message !== null ? <p role="alert">{message}</p> : null}
    </section>
  );
}
function ApprovedClients(): JSX.Element {
  const { status, busy, act } = useRemoteAccessStore();
  return (
    <section style={settingsGroupStyle}>
      <h3 style={settingsHeadingStyle}>Approved connections</h3>
      {(status?.clients.length ?? 0) === 0 ? (
        <p style={remoteNoteStyle}>
          No approved connections yet. Connect a phone or MCP app above.
        </p>
      ) : null}
      {status?.clients.map((client) => (
        <div key={client.id} style={settingsRowStyle}>
          <span>
            {client.label} · {client.scopes.includes('edit') ? 'View and edit' : 'View'}
            {client.scopes.includes('control') ? ' · Machine control' : ''}
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
