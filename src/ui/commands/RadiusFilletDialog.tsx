// Radius / Fillet (LightBurn Tools) for workspace artwork: round the
// selection's corners, bite them with a reverse radius, or remove fillets.
// Nodes picked with the node tool limit the edit to those corners.

import { useState } from 'react';
import { create } from 'zustand';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import type { FilletAction } from '../state/path-fillet-actions';

type DialogState = {
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
};

const useRadiusFilletDialogStore = create<DialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function openRadiusFilletDialog(): void {
  useRadiusFilletDialogStore.getState().show();
}

export function RadiusFilletDialogHost(): JSX.Element | null {
  const open = useRadiusFilletDialogStore((state) => state.open);
  return open ? <RadiusFilletDialog /> : null;
}

function RadiusFilletDialog(): JSX.Element {
  const close = useRadiusFilletDialogStore((state) => state.close);
  const fillet = useStore((state) => state.filletSelection);
  const pickedNodes = useStore((state) => state.selectedPathNodes.length);
  const [text, setText] = useState('2');
  const [action, setAction] = useState<FilletAction>('round');
  const radiusMm = Number(text);
  const valid = action === 'remove' || (Number.isFinite(radiusMm) && radiusMm > 0);
  return (
    <Dialog
      title="Radius / Fillet"
      size="sm"
      onClose={close}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        fillet(radiusMm, action);
        close();
      }}
    >
      <fieldset>
        <legend>Corners</legend>
        <label>
          <input type="radio" checked={action === 'round'} onChange={() => setAction('round')} />{' '}
          Round (arc tangent to both sides)
        </label>
        <label>
          <input
            type="radio"
            checked={action === 'reverse'}
            onChange={() => setAction('reverse')}
          />{' '}
          Reverse radius (concave bite centred on the corner)
        </label>
        <label>
          <input type="radio" checked={action === 'remove'} onChange={() => setAction('remove')} />{' '}
          Remove fillets (restore sharp corners)
        </label>
      </fieldset>
      <label className="lf-field">
        <span>Radius</span>
        <input
          className="lf-input"
          type="number"
          min="0"
          step="0.1"
          aria-label="Fillet radius in millimetres"
          disabled={action === 'remove'}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <span>mm</span>
      </label>
      <p>
        {pickedNodes > 0
          ? `Applies to the ${pickedNodes === 1 ? 'picked corner' : `${pickedNodes} picked corners`}.`
          : 'Applies to every corner of the selection. Pick nodes with the node tool to choose corners.'}
      </p>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!valid}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
