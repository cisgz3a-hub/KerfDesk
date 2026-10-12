// File > Print artwork...: choose colour or black and the printed line width,
// then print the selection (or all artwork) at true size.

import { useState } from 'react';
import { create } from 'zustand';
import { printableArtworkSvg, printSvg } from '../app/print-artwork';
import { Button, Dialog, DialogActions, NumberInput } from '../kit';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

type State = { readonly open: boolean; readonly show: () => void; readonly close: () => void };

export const usePrintArtworkStore = create<State>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function PrintArtworkDialogHost(): JSX.Element | null {
  return usePrintArtworkStore((state) => state.open) ? <PrintArtworkDialog /> : null;
}

function PrintArtworkDialog(): JSX.Element {
  const close = usePrintArtworkStore((state) => state.close);
  const [blackOnly, setBlackOnly] = useState(true);
  const [lineWidth, setLineWidth] = useState('0.2');
  const print = async (): Promise<void> => {
    const state = useStore.getState();
    const result = await printableArtworkSvg(
      state.project,
      selectedObjectIds(state),
      { blackOnly, lineWidthMm: Number(lineWidth) || 0.2 },
      new Date(),
    );
    if (!result.ok) {
      useToastStore.getState().pushToast(`Could not print: ${result.message}`, 'warning');
      return;
    }
    close();
    printSvg(result.svg);
  };
  return (
    <Dialog
      title="Print Artwork"
      size="sm"
      onClose={close}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        void print();
      }}
    >
      <p>Prints the selection, or all artwork when nothing is selected, at true size.</p>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={blackOnly}
          title="Print every line and fill in black, as for a template or a print-and-cut check."
          onChange={(event) => setBlackOnly(event.currentTarget.checked)}
        />
        Print in black
      </label>
      <label className="lf-field">
        <span>Line width (mm)</span>
        <NumberInput
          value={lineWidth}
          min={0.01}
          step={0.05}
          title="Width every line prints at."
          onChange={(event) => setLineWidth(event.currentTarget.value)}
        />
      </label>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" variant="primary">
          Print...
        </Button>
      </DialogActions>
    </Dialog>
  );
}
