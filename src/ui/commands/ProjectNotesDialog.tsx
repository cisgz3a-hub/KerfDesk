import { useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';

export function ProjectNotesDialog(props: {
  readonly notes: string;
  readonly showOnOpen?: boolean;
  readonly onCancel: () => void;
  readonly onApply: (notes: string, showOnOpen: boolean) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(props.notes);
  const [showOnOpen, setShowOnOpen] = useState(props.showOnOpen === true);
  return (
    <Dialog title="Project Notes" size="md" onClose={props.onCancel} as="form" onSubmit={submit}>
      <label style={fieldStyle}>
        <span style={labelStyle}>Notes</span>
        <textarea
          title="Project notes"
          value={draft}
          rows={10}
          style={textareaStyle}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      </label>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={showOnOpen}
          title="Open these notes automatically whenever this project is opened, for setup reminders or handover."
          onChange={(event) => setShowOnOpen(event.currentTarget.checked)}
        />
        Show these notes when the project is opened
      </label>
      <DialogActions>
        <Button type="button" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Save Notes
        </Button>
      </DialogActions>
    </Dialog>
  );

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    props.onApply(draft, showOnOpen);
  }
}

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const toggleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };

const labelStyle: React.CSSProperties = {
  fontWeight: 700,
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 180,
  boxSizing: 'border-box',
  resize: 'vertical',
  font: '13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};
