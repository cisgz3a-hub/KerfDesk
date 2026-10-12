// Close Selected Paths With Tolerance (LightBurn Edit menu), for every
// operation: pick the largest gap to close and whether to bridge it with a
// line or move both ends together. The counts update as the tolerance changes.

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import {
  closePathsWithinTolerance,
  type CloseToleranceMode,
} from '../../core/geometry/close-within-tolerance';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { isPathEditable } from '../state/path-cleanup-actions';
import { selectedObjectIds } from './selection-command-state';

type DialogState = {
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
};

const useClosePathsToleranceDialogStore = create<DialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function openClosePathsToleranceDialog(): void {
  useClosePathsToleranceDialogStore.getState().show();
}

export function ClosePathsToleranceDialogHost(): JSX.Element | null {
  const open = useClosePathsToleranceDialogStore((state) => state.open);
  return open ? <ClosePathsToleranceDialog /> : null;
}

function useCloseCounts(
  toleranceMm: number,
  mode: CloseToleranceMode,
): { readonly closed: number; readonly remaining: number } {
  const project = useStore((state) => state.project);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  return useMemo(() => {
    const ids = new Set(selectedObjectIds(selectedObjectId, additional));
    let closed = 0;
    let remaining = 0;
    for (const object of project.scene.objects) {
      if (!ids.has(object.id) || object.locked === true || !isPathEditable(object)) continue;
      const result = closePathsWithinTolerance(object.paths, object.transform, toleranceMm, mode);
      closed += result.closed;
      remaining += result.remaining;
    }
    return { closed, remaining };
  }, [project, selectedObjectId, additional, toleranceMm, mode]);
}

function ClosePathsToleranceDialog(): JSX.Element {
  const close = useClosePathsToleranceDialogStore((state) => state.close);
  const apply = useStore((state) => state.closeSelectedPathsWithTolerance);
  const [text, setText] = useState('0.5');
  const [mode, setMode] = useState<CloseToleranceMode>('bridge');
  const toleranceMm = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(toleranceMm) && toleranceMm >= 0;
  const counts = useCloseCounts(valid ? toleranceMm : -1, mode);
  return (
    <Dialog
      title="Close Paths With Tolerance"
      size="sm"
      onClose={close}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || counts.closed === 0) return;
        apply(toleranceMm, mode);
        close();
      }}
    >
      <label className="lf-field">
        <span>Tolerance</span>
        <input
          title="Largest gap between path ends to close, in millimetres"
          className="lf-input"
          type="number"
          min="0"
          step="0.1"
          aria-label="Largest gap to close, in millimetres"
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <span>mm</span>
      </label>
      <fieldset>
        <legend>Close by</legend>
        <label>
          <input
            title="Close each gap with a new straight line"
            type="radio"
            checked={mode === 'bridge'}
            onChange={() => setMode('bridge')}
          />{' '}
          Adding a closing line (every point stays where it is)
        </label>
        <label>
          <input
            title="Close each gap by moving both ends to their midpoint"
            type="radio"
            checked={mode === 'move-ends'}
            onChange={() => setMode('move-ends')}
          />{' '}
          Moving both ends together (no new segment)
        </label>
      </fieldset>
      <div className="lf-dialog-body">
        <p>{counts.closed === 1 ? '1 path' : `${counts.closed} paths`} will close.</p>
        <p>{counts.remaining === 1 ? '1 path stays' : `${counts.remaining} paths stay`} open.</p>
        <p>Text and drawn rectangles, ellipses and polygons keep their own paths.</p>
      </div>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!valid || counts.closed === 0}>
          Close paths
        </Button>
      </DialogActions>
    </Dialog>
  );
}
