import { useEffect, useMemo, useRef } from 'react';
import type { BoardOutlineDraft } from '../../../../core/scene';
import { Button, Dialog, DialogActions } from '../../../kit';
import { checkPhotoOutline, type PhotoOutlineCheck } from './outline-photo-logic';
import { photoDisplaySize, usePhotoCanvas } from './outline-photo-canvas';
import {
  dragOutlinePoint,
  loadOutlinePhoto,
  pastedImageFile,
  pressOutlinePhoto,
} from './outline-photo-dialog-actions';
import { OutlinePhotoControls } from './OutlinePhotoControls';
import {
  useOutlinePhotoSession,
  type OutlinePhotoDispatch,
  type OutlinePhotoSession,
} from './use-outline-photo-session';

export function OutlinePhotoDialog(props: {
  readonly onUseOutline: (draft: BoardOutlineDraft) => void;
  readonly onClose: () => void;
  readonly initialFile?: File | undefined;
}): JSX.Element {
  const [state, dispatch] = useOutlinePhotoSession();
  const check = useMemo(
    () =>
      checkPhotoOutline({
        points: state.points,
        width: state.width,
        height: state.height,
        firstAnchor: state.firstAnchor,
      }),
    [state.firstAnchor, state.height, state.points, state.width],
  );
  useInitialPhoto(props.initialFile, dispatch);
  usePastedPhoto(dispatch);
  return (
    <Dialog title="Draw the board from a photo" size="xl" onClose={props.onClose}>
      <div style={layoutStyle}>
        <OutlinePhotoControls state={state} dispatch={dispatch} check={check} />
        <OutlinePhotoCanvas state={state} dispatch={dispatch} check={check} />
      </div>
      <DialogActions>
        <Button variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          title="Put the board outline on the canvas at this size"
          disabled={check.draft === null}
          onClick={() => {
            if (check.draft !== null) props.onUseOutline(check.draft);
          }}
        >
          Draw on canvas
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function useInitialPhoto(file: File | undefined, dispatch: OutlinePhotoDispatch): void {
  const initial = useRef(file);
  const loaded = useRef(false);
  useEffect(() => {
    // Development StrictMode runs effects twice; decode the photo once.
    if (loaded.current) return;
    loaded.current = true;
    void loadOutlinePhoto(initial.current, dispatch);
  }, [dispatch]);
}

function usePastedPhoto(dispatch: OutlinePhotoDispatch): void {
  useEffect(() => {
    const paste = (event: ClipboardEvent): void => {
      const file = pastedImageFile(event);
      if (file === undefined) return;
      event.preventDefault();
      void loadOutlinePhoto(file, dispatch);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [dispatch]);
}

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '300px minmax(0, 1fr)',
  gap: 16,
  minHeight: 420,
};
const canvasStyle: React.CSSProperties = {
  alignSelf: 'start',
  cursor: 'crosshair',
  touchAction: 'none',
  background: 'var(--lf-bg-0)',
};
const emptyStyle: React.CSSProperties = {
  width: 860,
  height: 560,
  maxWidth: '100%',
  display: 'grid',
  placeItems: 'center',
  border: '1px dashed var(--lf-border)',
  color: 'var(--lf-text-muted)',
  fontSize: 13,
};

function OutlinePhotoCanvas(props: {
  readonly state: OutlinePhotoSession;
  readonly dispatch: OutlinePhotoDispatch;
  readonly check: PhotoOutlineCheck;
}): JSX.Element {
  const { state, dispatch, check } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);
  const marks = useMemo(
    () => ({
      points: state.points,
      anchors: check.anchors,
      captureOrder: check.draft?.captureOrder ?? null,
      selected: state.straighten?.from ?? null,
    }),
    [check.anchors, check.draft, state.points, state.straighten],
  );
  usePhotoCanvas(canvasRef, state.image, marks);
  if (state.image === null) {
    return <div style={emptyStyle}>Choose or paste a photo of the board.</div>;
  }
  const display = photoDisplaySize(state.image.width, state.image.height);
  return (
    <canvas
      ref={canvasRef}
      aria-label="Board photo: click the board's corners"
      style={{
        ...canvasStyle,
        width: display.width,
        height: display.height,
        cursor: state.straighten === null ? 'crosshair' : 'pointer',
      }}
      onPointerDown={(event) => {
        dragging.current = pressOutlinePhoto(event, state, dispatch);
        if (dragging.current !== null) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (dragging.current !== null) dragOutlinePoint(event, dragging.current, state, dispatch);
      }}
      onPointerUp={() => {
        dragging.current = null;
      }}
    />
  );
}
