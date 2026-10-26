import { usePlatformOptional } from '../../../app/platform-context';
import { Button, NumberInput } from '../../../kit';
import { loadOutlinePhoto } from './outline-photo-dialog-actions';
import type { PhotoOutlineCheck } from './outline-photo-logic';
import type { OutlinePhotoDispatch, OutlinePhotoSession } from './use-outline-photo-session';

type ControlsProps = {
  readonly state: OutlinePhotoSession;
  readonly dispatch: OutlinePhotoDispatch;
  readonly check: PhotoOutlineCheck;
};

export function OutlinePhotoControls(props: ControlsProps): JSX.Element {
  return (
    <div style={controlsStyle}>
      <PhotoSource dispatch={props.dispatch} />
      {props.state.image !== null && <OutlinePoints {...props} />}
      {props.state.image !== null && <OutlineSize {...props} />}
      <OutlineMessages {...props} />
    </div>
  );
}

function PhotoSource(props: { readonly dispatch: OutlinePhotoDispatch }): JSX.Element {
  const desktop = usePlatformOptional()?.id === 'electron';
  return (
    <section aria-label="Board photo source" style={sectionStyle}>
      <strong>1. Photo</strong>
      <p style={hintStyle}>Take it from straight above, with the whole board in view.</p>
      <input
        aria-label="Board photo"
        title="Choose a JPEG, PNG or WebP photo of the board"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void loadOutlinePhoto(file, props.dispatch);
        }}
      />
      <p style={hintStyle}>Or paste a photo with Ctrl+V.</p>
      <p style={mcpStyle}>
        <strong>From your AI assistant (MCP):</strong>{' '}
        {desktop
          ? 'send it the photo and ask it to put it in KerfDesk Place Board. It opens here by itself.'
          : 'needs the KerfDesk desktop app.'}
      </p>
    </section>
  );
}

function OutlinePoints(props: ControlsProps): JSX.Element {
  const { state, dispatch } = props;
  return (
    <section aria-label="Board outline points" style={sectionStyle}>
      <strong>2. Outline</strong>
      <p style={hintStyle}>
        Click each corner of the board in order around its edge. Add extra points along curved
        edges. Drag a point to move it.
      </p>
      <StraightenControls {...props} />
      <div style={rowStyle}>
        <Button
          variant="ghost"
          title="Undo the last point, drag, straighten or clear"
          disabled={state.history.length === 0}
          onClick={() => dispatch({ type: 'undo' })}
        >
          Undo
        </Button>
        <Button
          variant="ghost"
          title="Remove every point and start the outline again"
          disabled={state.points.length === 0}
          onClick={() => dispatch({ type: 'points-cleared' })}
        >
          Clear
        </Button>
        <span style={hintStyle}>{state.points.length} points</span>
      </div>
    </section>
  );
}

function StraightenControls(props: ControlsProps): JSX.Element {
  const { state, dispatch } = props;
  if (state.straighten === null) {
    return (
      <div style={rowStyle}>
        <Button
          variant="ghost"
          title="Line up points that are a little off: pick the two ends of an edge and the points between move onto a straight line"
          disabled={state.points.length < 3}
          onClick={() => dispatch({ type: 'straighten-started' })}
        >
          Straighten edge
        </Button>
      </div>
    );
  }
  return (
    <div style={rowStyle} role="status">
      <span style={noticeStyle}>
        {state.straighten.from === null
          ? 'Straighten edge: click the point where the edge starts.'
          : `Straighten edge: from point ${state.straighten.from + 1}, now click the point where the edge ends.`}
      </span>
      <Button
        variant="ghost"
        title="Stop straightening without changing the outline"
        onClick={() => dispatch({ type: 'straighten-cancelled' })}
      >
        Cancel
      </Button>
    </div>
  );
}

function OutlineSize(props: ControlsProps): JSX.Element {
  const { state, dispatch, check } = props;
  return (
    <section aria-label="Board size" style={sectionStyle}>
      <strong>3. Size</strong>
      <p style={hintStyle}>
        Measure the board with a ruler. The outline is scaled to exactly this.
      </p>
      <label style={rowStyle}>
        Width (left to right in the photo)
        <NumberInput
          aria-label="Board width in mm"
          title="The board's width in millimetres, measured left to right as it appears in the photo"
          value={state.width}
          onChange={(event) => dispatch({ type: 'width-edited', value: event.target.value })}
        />
        mm
      </label>
      <label style={rowStyle}>
        Height (top to bottom in the photo)
        <NumberInput
          aria-label="Board height in mm"
          title="The board's height in millimetres, measured top to bottom as it appears in the photo"
          value={state.height}
          onChange={(event) => dispatch({ type: 'height-edited', value: event.target.value })}
        />
        mm
      </label>
      {check.anchors.length >= 2 && check.firstAnchor !== null && (
        <label style={rowStyle}>
          Head captures point A at
          <select
            aria-label="First point the head captures"
            title="The outline point you will jog the laser head to first (shown as A)"
            value={check.firstAnchor}
            onChange={(event) =>
              dispatch({ type: 'first-anchor-selected', index: Number(event.target.value) })
            }
          >
            {check.anchors.map((index) => (
              <option key={index} value={index}>
                Point {index + 1}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}

function OutlineMessages(props: ControlsProps): JSX.Element {
  const { state, check } = props;
  return (
    <>
      {state.image !== null && check.problem !== null && (
        <p role="status" style={hintStyle}>
          {check.problem}
        </p>
      )}
      {check.notice !== null && <p style={noticeStyle}>{check.notice}</p>}
      {state.error !== null && (
        <p role="alert" style={errorStyle}>
          {state.error}
        </p>
      )}
    </>
  );
}

const controlsStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
};
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.35 };
const mcpStyle: React.CSSProperties = { ...hintStyle, color: 'var(--lf-text-muted)' };
const noticeStyle: React.CSSProperties = { ...hintStyle, color: 'var(--lf-warning-fg)' };
const errorStyle: React.CSSProperties = { ...hintStyle, color: 'var(--lf-danger-fg)' };
