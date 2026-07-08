// CircleCaptureSteps — the circle capture phase of the Place Board panel
// (ADR-126). The operator jogs to the CENTRE and Captures (which sets the work
// origin at the centre), then either types the hand-measured diameter or jogs to
// any rim point and captures it to measure the diameter (2·centre→rim).
// "Create board outline" draws the locked, centre-anchored circle.

import { useEffect, useState } from 'react';
import { diameterFromCenterEdge, type Vec2 } from '../../../core/scene';
import { Button, NumberInput } from '../../kit';
import { MIN_BOARD_DIMENSION_MM } from './constants';

export function CircleCaptureSteps(props: {
  readonly corners: ReadonlyArray<Vec2>;
  readonly livePosition: Vec2 | null;
  readonly disabled: boolean;
  readonly onCapture: () => void;
  readonly onUndo: () => void;
  readonly onFinish: (diameterMm: number) => void;
  readonly onReset: () => void;
}): JSX.Element {
  const count = props.corners.length;
  const centre = props.corners[0];
  const rim = props.corners[1];
  const measured =
    centre !== undefined && rim !== undefined ? diameterFromCenterEdge(centre, rim) : null;

  return (
    <div style={columnStyle}>
      <p style={stepStyle}>{guidance(count)}</p>
      <LivePositionRow position={props.livePosition} />
      <div style={buttonRowStyle}>
        <Button
          variant="primary"
          disabled={props.disabled || props.livePosition === null || count >= 2}
          title={captureTitle(count, props.livePosition)}
          onClick={props.onCapture}
        >
          {count === 0 ? 'Capture centre' : 'Capture edge'}
        </Button>
        <Button variant="ghost" disabled={count === 0} onClick={props.onUndo}>
          Undo last
        </Button>
        {count > 0 && (
          <Button variant="ghost" onClick={props.onReset}>
            Start over
          </Button>
        )}
      </div>
      {count >= 1 && <CircleDiameterForm measured={measured} onDraw={props.onFinish} />}
    </div>
  );
}

function CircleDiameterForm({
  measured,
  onDraw,
}: {
  readonly measured: number | null;
  readonly onDraw: (diameterMm: number) => void;
}): JSX.Element {
  const [typed, setTyped] = useState('');
  // A fresh rim measurement wins: adopt it into the field so a value typed FIRST
  // can't shadow a later, more precise Capture-edge (typing after still overrides,
  // and the field stays consistent with the "measured" badge).
  useEffect(() => {
    if (measured !== null) setTyped(measured.toFixed(1));
  }, [measured]);
  const diameter = Number(typed);
  const canDraw = Number.isFinite(diameter) && diameter >= MIN_BOARD_DIMENSION_MM;

  return (
    <div style={formStyle}>
      <p style={hintStyle}>Diameter — type it, or jog to the rim and Capture edge:</p>
      <div style={rowStyle}>
        <NumberInput
          aria-label="Circle diameter in mm"
          value={typed}
          min={MIN_BOARD_DIMENSION_MM}
          step={1}
          style={inputStyle}
          onChange={(event) => setTyped(event.target.value)}
        />
        <span style={mutedStyle}>mm ⌀</span>
        {measured !== null && <span style={mutedStyle}>measured {measured.toFixed(1)}</span>}
      </div>
      {typed !== '' && !canDraw && (
        <p style={warnStyle}>
          That&apos;s too small — type a diameter of at least {MIN_BOARD_DIMENSION_MM} mm.
        </p>
      )}
      <Button variant="primary" disabled={!canDraw} onClick={() => canDraw && onDraw(diameter)}>
        Create board outline
      </Button>
    </div>
  );
}

function LivePositionRow({ position }: { readonly position: Vec2 | null }): JSX.Element {
  return (
    <div style={liveStyle}>
      <strong>Head:</strong>{' '}
      {position === null
        ? 'waiting for position…'
        : `X ${position.x.toFixed(1)} Y ${position.y.toFixed(1)}`}
    </div>
  );
}

function guidance(count: number): string {
  if (count === 0) {
    return 'Jog to the CENTRE of the circle, then Capture — this sets the work origin.';
  }
  return 'Type the diameter, or jog to any point on the rim and Capture edge to measure it.';
}

function captureTitle(count: number, livePosition: Vec2 | null): string {
  if (livePosition === null) {
    return 'Waiting for a live machine position (connect and wait for Idle).';
  }
  return count === 0
    ? 'Record the head position at the circle centre.'
    : 'Record a point on the rim to measure the diameter.';
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const stepStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const liveStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
};
const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 6,
};
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const inputStyle: React.CSSProperties = { width: 64 };
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const warnStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--lf-warning-fg)',
};
