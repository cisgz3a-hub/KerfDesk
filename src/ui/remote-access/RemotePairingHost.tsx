import { Button, Dialog, DialogActions } from '../kit';
import { useRemoteAccessStore } from './remote-access-store';

export function RemotePairingHost(): JSX.Element | null {
  const { status, busy, act } = useRemoteAccessStore();
  const request = status?.requests[0];
  if (request === undefined) return null;
  const decide = (approved: boolean, edit = false): void => {
    void act('decide', {
      pairingId: request.pairingId,
      approved,
      scopes: edit ? ['read', 'edit'] : ['read'],
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
        settings.
      </p>
      <p>
        Approve only a connection you are setting up. You can revoke it in Settings → Phone & MCP.
      </p>
      <DialogActions>
        <Button disabled={busy} onClick={() => decide(false)}>
          Reject
        </Button>
        <Button disabled={busy} onClick={() => decide(true)}>
          Allow viewing
        </Button>
        {request.requestedScopes.includes('edit') ? (
          <Button variant="primary" disabled={busy} onClick={() => decide(true, true)}>
            Allow viewing and editing
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
