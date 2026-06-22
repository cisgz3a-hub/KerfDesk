import { useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';

export function ProjectNotesDialog(props: {
  readonly notes: string;
  readonly onCancel: () => void;
  readonly onApply: (notes: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(props.notes);
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
    props.onApply(draft);
  }
}

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

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
