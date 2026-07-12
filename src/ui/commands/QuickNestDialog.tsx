import { useState } from 'react';
import { Button, Dialog, DialogActions, NumberInput } from '../kit';
import type { QuickNestOptions } from '../state/nest-actions';

export function QuickNestDialog(props: {
  readonly boardAvailable: boolean;
  readonly onCancel: () => void;
  readonly onApply: (options: QuickNestOptions) => void;
}): JSX.Element {
  const [bin, setBin] = useState<QuickNestOptions['bin']>('workspace');
  const [padding, setPadding] = useState('2');
  const [allowRotation, setAllowRotation] = useState(true);
  return (
    <Dialog
      title="Quick Nest"
      size="sm"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        props.onApply({ bin, padding: nonNegative(padding), allowRotation });
      }}
    >
      <div style={fieldsStyle}>
        <label style={fieldStyle}>
          <span>Nest into</span>
          <select
            value={bin}
            onChange={(event) => setBin(event.currentTarget.value as QuickNestOptions['bin'])}
          >
            <option value="workspace">Workspace</option>
            <option value="board" disabled={!props.boardAvailable}>
              Placed board
            </option>
          </select>
        </label>
        <label style={fieldStyle}>
          <span>Part spacing (mm)</span>
          <NumberInput
            value={padding}
            min={0}
            step={0.1}
            onChange={(event) => setPadding(event.currentTarget.value)}
          />
        </label>
        <label style={checkStyle}>
          <input
            type="checkbox"
            checked={allowRotation}
            onChange={(event) => setAllowRotation(event.currentTarget.checked)}
          />
          Allow 90 degree rotation
        </label>
      </div>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Nest selection
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function nonNegative(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 10 };
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(130px, 1fr) 120px',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
