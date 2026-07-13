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
  const [method, setMethod] = useState<QuickNestOptions['method']>('outline');
  return (
    <Dialog
      title="Quick Nest"
      size="sm"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        props.onApply({ bin, padding: nonNegative(padding), allowRotation, method });
      }}
    >
      <div style={fieldsStyle}>
        <NestingMethod value={method} onChange={setMethod} />
        <label style={fieldStyle}>
          <span>Nest into</span>
          <select
            title="Choose the boundary that contains the nested selection"
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
            title="Allow parts to rotate by 90 degrees while nesting"
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

function NestingMethod(props: {
  readonly value: QuickNestOptions['method'];
  readonly onChange: (value: QuickNestOptions['method']) => void;
}): JSX.Element {
  return (
    <div style={fieldStyle}>
      <span>Nesting method</span>
      <div role="group" aria-label="Nesting method" style={methodStyle}>
        <Button
          pressed={props.value === 'outline'}
          title="Use closed vector outlines to compact concave parts and parts with holes."
          onClick={() => props.onChange('outline')}
        >
          Outline
        </Button>
        <Button
          pressed={props.value === 'fast'}
          title="Use fast rectangular bounds for large or mixed raster selections."
          onClick={() => props.onChange('fast')}
        >
          Fast
        </Button>
      </div>
    </div>
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
const methodStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 4,
};
