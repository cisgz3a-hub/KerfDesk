// Docking options: padding, Move as group and Lock inner objects.

import { useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { useDockOptionsStore } from './dock-options-store';

export function DockOptionsDialogHost(): JSX.Element | null {
  const open = useDockOptionsStore((state) => state.dialogOpen);
  return open ? <DockOptionsDialog /> : null;
}

function DockOptionsDialog(): JSX.Element {
  const settings = useDockOptionsStore((state) => state.settings);
  const setSettings = useDockOptionsStore((state) => state.setSettings);
  const close = useDockOptionsStore((state) => state.closeDialog);
  const [padding, setPadding] = useState(String(settings.paddingMm));
  const [moveAsGroup, setMoveAsGroup] = useState(settings.moveAsGroup);
  const [lockInner, setLockInner] = useState(settings.lockInner);
  const paddingMm = Number(padding);
  const valid = padding.trim() !== '' && Number.isFinite(paddingMm) && paddingMm >= 0;
  return (
    <Dialog
      title="Docking Options"
      size="sm"
      onClose={close}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        setSettings({ paddingMm, moveAsGroup, lockInner });
        close();
      }}
    >
      <label className="lf-field">
        <span>Padding</span>
        <input
          title="Space kept between docked artwork and what it meets, in millimetres"
          className="lf-input"
          type="number"
          min="0"
          step="0.1"
          aria-label="Docking padding in millimetres"
          value={padding}
          onChange={(event) => setPadding(event.currentTarget.value)}
        />
        <span>mm</span>
      </label>
      <label>
        <input
          title="Dock the whole selection as one piece"
          type="checkbox"
          checked={moveAsGroup}
          onChange={(event) => setMoveAsGroup(event.currentTarget.checked)}
        />{' '}
        Move as group: the whole selection stops when any part of it meets something
      </label>
      <label>
        <input
          title="Keep selected artwork inside other selected artwork moving with it"
          type="checkbox"
          checked={lockInner}
          onChange={(event) => setLockInner(event.currentTarget.checked)}
        />{' '}
        Lock inner objects: selected artwork inside other selected artwork moves with it
      </label>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!valid}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
