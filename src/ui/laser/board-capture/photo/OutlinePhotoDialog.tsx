import { useEffect, useRef } from 'react';
import type { BoardOutlineDraft } from '../../../../core/scene';
import { Button, Dialog, DialogActions } from '../../../kit';
import { buildPhotoOutlineDraft } from './outline-photo-logic';
import { photoDisplaySize, usePhotoCanvas } from './outline-photo-canvas';
import { handleOutlinePhotoClick, loadOutlinePhoto } from './outline-photo-dialog-actions';
import { OutlinePhotoControls } from './OutlinePhotoControls';
import { useOutlinePhotoSession } from './use-outline-photo-session';

export function OutlinePhotoDialog(props: {
  readonly onUseOutline: (draft: BoardOutlineDraft) => void;
  readonly onClose: () => void;
  readonly initialFile?: File | undefined;
}): JSX.Element {
  const [state, dispatch] = useOutlinePhotoSession();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialFile = useRef(props.initialFile);
  const initialFileLoaded = useRef(false);
  usePhotoCanvas(
    canvasRef,
    state.image,
    state.corners,
    state.outline,
    state.anchors,
    state.trace?.toMm ?? null,
  );
  useEffect(() => {
    if (initialFileLoaded.current) return;
    initialFileLoaded.current = true;
    void loadOutlinePhoto(initialFile.current, dispatch);
  }, [dispatch]);
  const display =
    state.image === null
      ? { width: 860, height: 560 }
      : photoDisplaySize(state.image.width, state.image.height);
  const draft = draftFromSession(state);
  return (
    <Dialog title="Outline from photo" size="xl" onClose={props.onClose}>
      <div style={layoutStyle}>
        <OutlinePhotoControls state={state} dispatch={dispatch} />
        <canvas
          ref={canvasRef}
          aria-label="Board photo preview"
          style={{ ...canvasStyle, width: display.width, height: display.height }}
          onClick={(event) => handleOutlinePhotoClick(event, state, dispatch)}
        />
      </div>
      <DialogActions>
        <Button variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={draft === null || state.busy}
          onClick={() => {
            if (draft !== null) props.onUseOutline(draft);
          }}
        >
          Use this outline
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function draftFromSession(
  state: ReturnType<typeof useOutlinePhotoSession>[0],
): BoardOutlineDraft | null {
  if (state.outline === null) return null;
  return buildPhotoOutlineDraft({
    outlineMm: state.outline,
    widthMm: Number(state.width),
    heightMm: Number(state.height),
    anchorIndices: state.anchors,
    firstAnchor: state.firstAnchor,
  });
}

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '280px minmax(0, 1fr)',
  gap: 12,
  minHeight: 420,
};
const canvasStyle: React.CSSProperties = {
  maxWidth: 860,
  maxHeight: 560,
  alignSelf: 'start',
  background: 'var(--lf-bg-0)',
};
