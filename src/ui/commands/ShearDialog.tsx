// Shear (LightBurn skew) for workspace vector artwork: slant the selection
// horizontally and/or vertically about its centre. The shear is written into
// the paths, so it is undone with Undo, not by editing a transform field.

import { useState } from 'react';
import { create } from 'zustand';
import { MAX_SHEAR_DEG } from '../../core/geometry/shear-bake';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';

type DialogState = {
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
};

const useShearDialogStore = create<DialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function openShearDialog(): void {
  useShearDialogStore.getState().show();
}

export function ShearDialogHost(): JSX.Element | null {
  const open = useShearDialogStore((state) => state.open);
  return open ? <ShearDialog /> : null;
}

function parseAngle(text: string): number | null {
  const value = text.trim() === '' ? 0 : Number(text);
  return Number.isFinite(value) && Math.abs(value) <= MAX_SHEAR_DEG ? value : null;
}

function ShearDialog(): JSX.Element {
  const close = useShearDialogStore((state) => state.close);
  const shear = useStore((state) => state.shearSelection);
  const [horizontal, setHorizontal] = useState('15');
  const [vertical, setVertical] = useState('0');
  const ax = parseAngle(horizontal);
  const ay = parseAngle(vertical);
  const valid = ax !== null && ay !== null && (ax !== 0 || ay !== 0);
  const field = (label: string, value: string, set: (next: string) => void) => (
    <label className="lf-field">
      <span>{label}</span>
      <input
        title="Shear angle in degrees"
        className="lf-input"
        type="number"
        min={-MAX_SHEAR_DEG}
        max={MAX_SHEAR_DEG}
        step="1"
        aria-label={`${label} shear angle in degrees`}
        value={value}
        onChange={(event) => set(event.currentTarget.value)}
      />
      <span>°</span>
    </label>
  );
  return (
    <Dialog
      title="Shear"
      size="sm"
      onClose={close}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        shear(ax, ay);
        close();
      }}
    >
      {field('Horizontal', horizontal, setHorizontal)}
      {field('Vertical', vertical, setVertical)}
      <p>
        Slants the selection about its centre, up to {MAX_SHEAR_DEG}° each way. The shear is written
        into the paths; text, drawn shapes and images need converting to paths first.
      </p>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!valid}>
          Shear
        </Button>
      </DialogActions>
    </Dialog>
  );
}
