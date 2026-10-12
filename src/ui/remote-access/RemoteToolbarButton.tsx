// MCP in the main toolbar: live connection status at a glance, and a
// quick panel that reuses the Settings controls for pairing, artwork sharing
// and approved connections. Settings → Phone & MCP keeps the full page.

import { useCallback, useId, useRef, useState } from 'react';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { ToolbarIcon } from '../common/ToolbarIcon';
import { Button } from '../kit';
import { openSettings } from '../settings/settings-dialog-store';
import { isRemoteAccessRenderer } from './desktop-only';
import { PairingControls } from './PairingControls';
import { ApprovedClients, ArtworkSharingConsent } from './RemoteAccessSection';
import {
  REMOTE_DISCONNECTED_SUMMARY,
  useRemoteAccessStore,
  type RemoteAccessStatus,
} from './remote-access-store';
import './remote-toolbar.css';

export type RemoteTone = 'off' | 'connecting' | 'disconnected' | 'ready' | 'live' | 'attention';

export function remoteToolbarSummary(
  status: RemoteAccessStatus | null,
  connectionLost = false,
): {
  readonly tone: RemoteTone;
  readonly text: string;
} {
  if (status?.available === false) return { tone: 'off', text: 'Unavailable on this computer' };
  if (status?.enabled === false) return { tone: 'off', text: 'Remote access is off' };
  if (connectionLost) return { tone: 'disconnected', text: REMOTE_DISCONNECTED_SUMMARY };
  if (status === null) return { tone: 'connecting', text: 'Loading connection status…' };
  if (status.requests.length > 0)
    return { tone: 'attention', text: 'A connection is waiting for your approval' };
  if (!status.connected) return { tone: 'connecting', text: 'Connecting to the remote service…' };
  const clients = status.clients.length;
  if (clients === 0) return { tone: 'ready', text: 'Ready to pair' };
  return { tone: 'live', text: `${clients} approved connection${clients === 1 ? '' : 's'}` };
}

export function RemoteToolbarButton(): JSX.Element | null {
  return isRemoteAccessRenderer() ? <RemoteToolbarControl /> : null;
}

function RemoteToolbarControl(): JSX.Element {
  const status = useRemoteAccessStore((state) => state.status);
  const connectionLost = useRemoteAccessStore((state) => state.connectionLost);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const triggerId = useId();
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  const summary = remoteToolbarSummary(status, connectionLost);
  return (
    <>
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        className="lf-btn lf-toolbar-command lf-remote-toolbar-button"
        aria-label="Phone & MCP"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`Phone & MCP: ${summary.text}`}
        data-remote-state={summary.tone}
        onClick={() => setOpen((value) => !value)}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node) || !document.getElementById(panelId)?.contains(next)) close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <span className="lf-remote-toolbar-icon">
          <ToolbarIcon icon="remote" />
          <span className="lf-remote-dot" aria-hidden="true" />
        </span>
        <span className="lf-remote-toolbar-label">MCP</span>
      </button>
      {open ? (
        <AnchoredPopover
          id={panelId}
          label="Phone & MCP"
          role="dialog"
          anchorRef={triggerRef}
          className="lf-remote-panel"
          initialFocus={'[role="switch"]:not(:disabled), button:not(:disabled)'}
          focusFallbackId={triggerId}
          closeOnTab={false}
          onClose={close}
        >
          <RemoteQuickPanel onClose={close} />
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function RemoteQuickPanel(props: { readonly onClose: () => void }): JSX.Element {
  const status = useRemoteAccessStore((state) => state.status);
  const message = useRemoteAccessStore((state) => state.message);
  return (
    <div className="lf-remote-panel__body">
      <RemotePanelHeader />
      {status?.error != null ? (
        <p role="alert" className="lf-remote-panel__alert">
          {status.error}
        </p>
      ) : null}
      {message !== null ? (
        <p role="alert" className="lf-remote-panel__alert">
          {message}
        </p>
      ) : null}
      {status?.enabled === true ? (
        <>
          <PairingControls />
          <hr className="lf-remote-panel__rule" />
          <ArtworkSharingConsent />
          <hr className="lf-remote-panel__rule" />
          <ApprovedClients />
        </>
      ) : (
        <p className="lf-remote-panel__note">
          Use your phone, ChatGPT or another MCP app with this workspace. Approved connections reach
          this PC through KerfDesk’s Cloudflare service, and an MCP app may send what it reads to
          its AI provider. Licence keys, serial ports and saved file paths are excluded. Keep
          KerfDesk open and this computer awake and online.
        </p>
      )}
      <Button
        onClick={() => {
          props.onClose();
          openSettings('remote');
        }}
      >
        All Phone & MCP settings…
      </Button>
    </div>
  );
}

function RemotePanelHeader(): JSX.Element {
  const { status, connectionLost, busy, act } = useRemoteAccessStore();
  const summary = remoteToolbarSummary(status, connectionLost);
  const enabled = status?.enabled === true;
  const toggleHelp = enabled
    ? 'Turn off to disconnect clients now; their access is revoked when this computer next connects.'
    : 'Enable pairing with connections you approve on this computer.';
  return (
    <div className="lf-remote-panel__header">
      <div>
        <h2 className="lf-remote-panel__title">Phone & MCP</h2>
        <p role="status" className="lf-remote-panel__status" data-remote-state={summary.tone}>
          <span className="lf-remote-dot" aria-hidden="true" />
          {summary.text}
        </p>
      </div>
      <label className="lf-remote-panel__switch" title={toggleHelp}>
        <input
          type="checkbox"
          role="switch"
          aria-label="Allow approved remote connections"
          title={toggleHelp}
          checked={enabled}
          disabled={busy || status?.available !== true}
          onChange={(event) => {
            void act('configure', { enabled: event.currentTarget.checked });
          }}
        />
        <span aria-hidden="true">{enabled ? 'On' : 'Off'}</span>
      </label>
    </div>
  );
}
