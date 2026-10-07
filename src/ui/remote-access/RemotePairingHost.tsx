import { useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { useRemoteAccessStore, type RemoteAccessStatus } from './remote-access-store';

export function RemotePairingHost(): JSX.Element | null {
  const { status, busy, act } = useRemoteAccessStore();
  const request = status?.requests[0];
  if (request === undefined) return null;
  return <PairingRequest key={request.pairingId} request={request} busy={busy} act={act} />;
}

type PairingRequestProps = {
  readonly request: RemoteAccessStatus['requests'][number];
  readonly busy: boolean;
  readonly act: ReturnType<typeof useRemoteAccessStore.getState>['act'];
};

function PairingRequest({ request, busy, act }: PairingRequestProps): JSX.Element {
  const [edit, setEdit] = useState(false);
  const [control, setControl] = useState(false);
  const decide = (approved: boolean): void => {
    void act('decide', {
      pairingId: request.pairingId,
      approved,
      scopes: [
        'read',
        ...(approved && edit ? ['edit'] : []),
        ...(approved && control ? ['control'] : []),
      ],
    });
  };
  return (
    <Dialog title="Approve remote connection" initialFocus="surface" onClose={() => decide(false)}>
      <p>
        <strong>{request.clientLabel}</strong> is asking to connect to this KerfDesk workspace.
      </p>
      <p>
        View access shares artwork summaries, machine limits, recipes, edition and update status
        through KerfDesk’s remote service. Editing access can change artwork and laser operation
        settings. Machine control is a separate permission.
      </p>
      {request.requestedScopes.includes('edit') ? (
        <label style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'start' }}>
          <input
            type="checkbox"
            title="Approve artwork and laser-setting edits for this connection."
            checked={edit}
            disabled={busy}
            onChange={(event) => setEdit(event.currentTarget.checked)}
          />
          <span>Allow artwork and operation editing</span>
        </label>
      ) : null}
      {request.requestedScopes.includes('control') ? (
        <>
          <label style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'start' }}>
            <input
              type="checkbox"
              title="Approve this connection to jog, frame, start and abort machine work."
              checked={control}
              disabled={busy}
              onChange={(event) => setControl(event.currentTarget.checked)}
            />
            <span>Allow Jog, Frame, Start and Abort</span>
          </label>
          <p>
            This connection can move the machine and start a laser or spindle job. Keep the machine
            in view while controlling it.
          </p>
        </>
      ) : null}
      <p>
        Approve only a connection you are setting up. You can revoke it in Settings → Phone & MCP.
      </p>
      <DialogActions>
        <Button disabled={busy} onClick={() => decide(false)}>
          Reject
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => decide(true)}>
          {edit || control ? 'Approve selected access' : 'Allow viewing'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
