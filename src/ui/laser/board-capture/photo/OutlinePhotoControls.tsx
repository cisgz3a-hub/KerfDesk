import { Button, NumberInput } from '../../../kit';
import { loadOutlinePhoto, straightenOutlinePhoto } from './outline-photo-dialog-actions';
import type { OutlinePhotoDispatch, OutlinePhotoSession } from './use-outline-photo-session';
import type { ReferenceKind } from './outline-photo-rectify';

export function OutlinePhotoControls(props: {
  readonly state: OutlinePhotoSession;
  readonly dispatch: OutlinePhotoDispatch;
}): JSX.Element {
  const { state, dispatch } = props;
  const canRectify =
    state.image !== null && (state.reference === 'skip' || state.corners.length === 4);
  return (
    <div style={controlsStyle}>
      <p style={hintStyle}>
        Lay a sheet of paper flat on top of the board and photograph straight down so the whole
        board and the sheet are in view. Click the sheet&apos;s four corners.
      </p>
      <input
        aria-label="Board photo"
        title="Choose a JPEG, PNG or WebP photo of the board"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => void loadOutlinePhoto(event.target.files?.[0], dispatch)}
      />
      <ReferenceControls state={state} dispatch={dispatch} />
      <Button
        disabled={state.corners.length === 0}
        onClick={() => dispatch({ type: 'clear-corners' })}
      >
        Clear corners
      </Button>
      <Button
        variant="primary"
        disabled={!canRectify || state.busy}
        onClick={() => straightenOutlinePhoto(state, dispatch)}
      >
        Straighten photo
      </Button>
      <TraceControls state={state} dispatch={dispatch} />
    </div>
  );
}

function TraceControls(props: {
  readonly state: OutlinePhotoSession;
  readonly dispatch: OutlinePhotoDispatch;
}): JSX.Element {
  const { state, dispatch } = props;
  return (
    <>
      {state.trace !== null && state.outline === null && (
        <p style={hintStyle}>Click the middle of the board.</p>
      )}
      {state.outline !== null && (
        <Button variant="ghost" onClick={() => dispatch({ type: 'retap-board' })}>
          Click the board again
        </Button>
      )}
      {state.trace?.coarse === true && (
        <p style={noticeStyle}>
          The photo covers a very large area; the outline will be rough. Move closer.
        </p>
      )}
      {state.partial && (
        <p style={noticeStyle}>
          Part of the board is outside the photo; the outline is cut off there.
        </p>
      )}
      {state.outline !== null && <OutlineSizeControls state={state} dispatch={dispatch} />}
      {state.busy && <p role="status">{state.busyLabel}</p>}
      {state.anchorHint !== null && <p style={noticeStyle}>{state.anchorHint}</p>}
      {state.error !== null && (
        <p role="alert" style={errorStyle}>
          {state.error}
        </p>
      )}
    </>
  );
}

function ReferenceControls(props: {
  readonly state: OutlinePhotoSession;
  readonly dispatch: OutlinePhotoDispatch;
}): JSX.Element {
  const { state, dispatch } = props;
  return (
    <>
      <label>
        Reference
        <select
          aria-label="Photo reference"
          title="Choose the sheet used to straighten and scale the photo"
          value={state.reference}
          onChange={(event) =>
            dispatch({
              type: 'reference-changed',
              reference: event.target.value as ReferenceKind,
            })
          }
        >
          <option value="a4">A4 sheet (210 × 297 mm)</option>
          <option value="letter">US Letter sheet (215.9 × 279.4 mm)</option>
          <option value="custom">Custom</option>
          <option value="skip">Skip — photo taken straight down (rough)</option>
        </select>
      </label>
      {state.reference === 'custom' && (
        <div style={rowStyle}>
          <NumberInput
            aria-label="Reference width in mm"
            value={state.customWidth}
            onChange={(event) =>
              dispatch({ type: 'custom-size-changed', axis: 'width', value: event.target.value })
            }
          />
          <span>×</span>
          <NumberInput
            aria-label="Reference height in mm"
            value={state.customHeight}
            onChange={(event) =>
              dispatch({ type: 'custom-size-changed', axis: 'height', value: event.target.value })
            }
          />
        </div>
      )}
    </>
  );
}

function OutlineSizeControls(props: {
  readonly state: OutlinePhotoSession;
  readonly dispatch: OutlinePhotoDispatch;
}): JSX.Element {
  const { state, dispatch } = props;
  return (
    <>
      <p style={hintStyle}>
        Measure the board with a ruler. KerfDesk scales the outline to exactly this size; the head
        checks it later.
      </p>
      <div style={rowStyle}>
        <NumberInput
          aria-label="Outline width in mm"
          value={state.width}
          onChange={(event) => dispatch({ type: 'width-edited', value: event.target.value })}
        />
        <span>×</span>
        <NumberInput
          aria-label="Outline height in mm"
          value={state.height}
          onChange={(event) => dispatch({ type: 'height-edited', value: event.target.value })}
        />
      </div>
      <label>
        First anchor to capture
        <select
          aria-label="First anchor to capture"
          title="Choose which outline anchor the head will capture first"
          value={state.firstAnchor}
          onChange={(event) =>
            dispatch({ type: 'first-anchor-selected', index: Number(event.target.value) })
          }
        >
          {state.anchors.map((index, ordinal) => (
            <option key={index} value={index}>
              Anchor {ordinal + 1}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

const controlsStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' };
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.35 };
const noticeStyle: React.CSSProperties = { ...hintStyle, color: 'var(--lf-warning-fg)' };
const errorStyle: React.CSSProperties = { ...hintStyle, color: 'var(--lf-danger-fg)' };
