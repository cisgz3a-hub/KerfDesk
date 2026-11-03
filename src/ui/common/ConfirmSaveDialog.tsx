// ConfirmSaveDialog — the three-button Save / Don't Save / Cancel prompt
// shown before a destructive action discards unsaved changes (LU18,
// AUDIT-2026-06-10 / WORKFLOW F-A13; LightBurn parity). Renders whenever
// confirm-save-store holds a pending request; the chosen button resolves
// the awaiting confirmDiscardAsync call.
//
// Button order is the Windows MessageBox convention (Save first), which
// also gives Save the dialog's initial focus via use-dialog-a11y — Enter
// saves, Escape cancels.

import { Button, Dialog, DialogActions } from '../kit';
import { useConfirmSaveStore, type ConfirmSaveRequest } from '../state/confirm-save-store';

export function ConfirmSaveDialog(): JSX.Element | null {
  const request = useConfirmSaveStore((s) => s.request);
  if (request === null) return null;
  return <ConfirmSavePanel request={request} />;
}

function ConfirmSavePanel(props: { readonly request: ConfirmSaveRequest }): JSX.Element {
  const choose = useConfirmSaveStore((s) => s.choose);
  if (props.request.canSave === false) return <CannotSavePanel request={props.request} />;
  return (
    <Dialog size="sm" title="Save changes?" onClose={() => choose('cancel')}>
      <p style={bodyStyle}>
        {sentenceSubject(props.request.projectName)} has unsaved changes. Save them before you{' '}
        {props.request.action}?
      </p>
      <p style={hintStyle}>Don&apos;t Save discards the changes permanently.</p>
      <DialogActions>
        <Button variant="primary" onClick={() => choose('save')}>
          Save
        </Button>
        <Button onClick={() => choose('discard')}>Don&apos;t Save</Button>
        <Button onClick={() => choose('cancel')}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

// ADR-688: in a browser without file pickers Save always fails, so it is not
// offered. Cancel leads and takes the initial focus: it keeps the work, which
// stays in this browser's autosave.
function CannotSavePanel(props: { readonly request: ConfirmSaveRequest }): JSX.Element {
  const choose = useConfirmSaveStore((s) => s.choose);
  return (
    <Dialog size="sm" title="Unsaved changes" onClose={() => choose('cancel')}>
      <p style={bodyStyle}>
        {sentenceSubject(props.request.projectName)} has unsaved changes, and this browser
        can&apos;t save files. Cancel keeps working on them here; they stay in this browser&apos;s
        autosave. To keep them as a file, open KerfDesk in Chrome or Edge, or use the desktop app.
      </p>
      <p style={hintStyle}>
        Don&apos;t Save discards the changes permanently and goes on to {props.request.action}.
      </p>
      <DialogActions>
        <Button variant="primary" onClick={() => choose('cancel')}>
          Cancel
        </Button>
        <Button onClick={() => choose('discard')}>Don&apos;t Save</Button>
      </DialogActions>
    </Dialog>
  );
}

const bodyStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 13 };
const hintStyle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};

// An unnamed project is called "this project", which opens the sentence.
function sentenceSubject(projectName: string): string {
  return projectName === 'this project' ? 'This project' : projectName;
}
