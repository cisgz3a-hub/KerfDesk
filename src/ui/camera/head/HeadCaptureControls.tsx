// HeadCaptureControls — the Camera panel's capture row for a camera on the
// laser head (ADR-449): Capture here takes one picture where the head is;
// Capture selection (or Capture bed, with nothing selected) moves the head
// over that area with the laser off and stitches the pictures into one.

import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import { combinedBBox } from '../../../core/scene';
import { useStore } from '../../state';
import {
  captureWithHeadCamera,
  useHeadCaptureStore,
  type HeadCaptureState,
} from './head-capture-store';

export function HeadCaptureControls(): JSX.Element {
  const state = useHeadCaptureStore((s) => s.state);
  const stop = useHeadCaptureStore((s) => s.stop);
  const hasSelection = useStore(
    (s) => s.selectedObjectId !== null || s.additionalSelectedIds.size > 0,
  );
  const running = state.kind === 'running';
  return (
    <div style={columnStyle}>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn"
          disabled={running}
          onClick={() => void captureWithHeadCamera({ kind: 'here' })}
          title="Show what the head camera sees now on the canvas, without moving the head."
        >
          Capture here
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={running}
          onClick={() => void captureWithHeadCamera({ kind: 'area', area: areaToCapture() })}
          title="Move the head over the area with the laser off, take a picture at each stop, and stitch them into one picture on the canvas."
        >
          {hasSelection ? 'Capture selection' : 'Capture bed'}
        </button>
        {running ? (
          <button
            type="button"
            className="lf-btn"
            disabled={state.stopping}
            onClick={stop}
            title="Stop moving the head. The pictures already taken are kept."
          >
            Stop
          </button>
        ) : null}
      </div>
      <HeadCaptureStatus state={state} />
    </div>
  );
}

function HeadCaptureStatus(props: { readonly state: HeadCaptureState }): JSX.Element | null {
  const { state } = props;
  switch (state.kind) {
    case 'idle':
      return null;
    case 'running':
      return (
        <p role="status" style={noteStyle}>
          {state.stopping
            ? 'Stopping…'
            : `Taking picture ${Math.min(state.taken + 1, state.total)} of ${state.total}…`}
        </p>
      );
    case 'finished':
      return state.note === null ? null : (
        <p role="status" style={noteStyle}>
          {state.note}
        </p>
      );
    case 'failed':
      return (
        <p role="status" style={errorStyle}>
          {state.message}
        </p>
      );
  }
}

// The selected objects' box on the bed, or the whole bed with nothing selected.
function areaToCapture(): BedArea {
  const { project, selectedObjectId, additionalSelectedIds } = useStore.getState();
  const ids = new Set([
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ]);
  const bed = { width: project.device.bedWidth, height: project.device.bedHeight };
  const box = combinedBBox(project.scene.objects.filter((object) => ids.has(object.id)));
  if (box === null) return { x: 0, y: 0, ...bed };
  const x0 = Math.max(0, box.minX);
  const y0 = Math.max(0, box.minY);
  const x1 = Math.min(bed.width, box.maxX);
  const y1 = Math.min(bed.height, box.maxY);
  return x1 > x0 && y1 > y0
    ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    : { x: 0, y: 0, ...bed };
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const noteStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--lf-text-faint)' };
const errorStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--lf-danger-fg)' };
