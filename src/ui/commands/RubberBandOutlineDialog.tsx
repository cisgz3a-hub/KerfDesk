// Rubber-Band Outline (ADR-480, Amendment 7): shows which operation the
// outline will cut with and lets the user pick another, the way Union
// Silhouette's dialog picks its result operation. Only operations that cut
// along a line are offered, so the outline never fills or pockets the hull.

import { useState } from 'react';
import { create } from 'zustand';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import {
  outlineChoiceLabel,
  rubberBandOutlineOptions,
} from '../state/rubber-band-outline-operation';
import { selectedObjectIds } from './selection-command-state';

type DialogState = {
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
};

const useRubberBandOutlineDialogStore = create<DialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function openRubberBandOutlineDialog(): void {
  useRubberBandOutlineDialogStore.getState().show();
}

export function RubberBandOutlineDialogHost(): JSX.Element | null {
  const open = useRubberBandOutlineDialogStore((state) => state.open);
  return open ? <RubberBandOutlineDialog /> : null;
}

function RubberBandOutlineDialog(): JSX.Element {
  const close = useRubberBandOutlineDialogStore((state) => state.close);
  const project = useStore((state) => state.project);
  const primary = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const addOutline = useStore((state) => state.addRubberBandOutline);
  const options = rubberBandOutlineOptions(project, selectedObjectIds(primary, additional));
  const [chosenId, setChosenId] = useState(options.defaultId);
  const chosen = options.choices.find((choice) => choice.id === chosenId);
  const canApply = options.sources.length > 0 && chosen !== undefined;
  return (
    <Dialog
      title="Rubber-band outline"
      size="sm"
      onClose={close}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canApply && addOutline(chosenId)) close();
      }}
    >
      <p>Add one closed outline stretched around the selection, as a cut line around it.</p>
      <label className="lf-field">
        <span>Cut the outline with</span>
        <select
          className="lf-input"
          title="Choose the operation the outline is cut with."
          value={chosenId}
          onChange={(event) => setChosenId(event.currentTarget.value)}
        >
          {options.choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {outlineChoiceLabel(choice)}
            </option>
          ))}
        </select>
      </label>
      {chosen?.source === null ? (
        <p>A new operation with the default settings. Set its power, speed or depth afterwards.</p>
      ) : (
        <p>A copy of this operation, with the selected artwork&apos;s own settings.</p>
      )}
      {options.passedOver.length === 0 ? null : (
        <p role="note">
          Not offered: {options.passedOver.map((name) => `“${name}”`).join(', ')}. Only Line
          operations (Profile cuts in CNC) can cut an outline; a fill, pocket or V-carve would clear
          the whole area inside it.
        </p>
      )}
      {chosen !== undefined && !chosen.output ? (
        <p role="alert">
          This operation&apos;s output is off, so the outline will not burn or cut.
        </p>
      ) : null}
      {options.leftOut === '' ? null : <p role="note">{options.leftOut}</p>}
      {options.sources.length === 0 ? (
        <p role="status">Select the artwork to outline first.</p>
      ) : null}
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!canApply}>
          Add outline
        </Button>
      </DialogActions>
    </Dialog>
  );
}
