import { useState } from 'react';
import { diameterFromCenterEdge, type Vec2 } from '../../../core/scene';
import { bestFitCircleFromRimPoints } from '../../../core/scene/board-circle-fit';
import { Button, NumberInput } from '../../kit';
import { CircleCenterConfirmation } from './CircleCenterConfirmation';
import { CIRCLE_RIM_POINT_COUNT, type CircleCaptureMethod } from './use-board-capture';
import { MIN_BOARD_DIMENSION_MM } from './constants';

export function CircleCaptureSteps(props: {
  readonly method: CircleCaptureMethod;
  readonly corners: ReadonlyArray<Vec2>;
  readonly livePosition: Vec2 | null;
  readonly disabled: boolean;
  readonly sessionDisabled: boolean;
  readonly onMethodChange: (method: CircleCaptureMethod) => void;
  readonly onCapture: () => void;
  readonly onUndo: () => void;
  readonly onMoveToPoint: (point: Vec2) => Promise<void>;
  readonly onFinish: (center: Vec2, diameterMm: number) => Promise<void>;
}): JSX.Element {
  return (
    <div style={columnStyle}>
      <p style={stepStyle}>How should Place Board locate the circle center?</p>
      <div role="group" aria-label="Circle center method" style={buttonRowStyle}>
        <Button
          variant={props.method === 'rim-fit' ? 'primary' : 'default'}
          disabled={props.sessionDisabled}
          aria-pressed={props.method === 'rim-fit'}
          onClick={() => props.onMethodChange('rim-fit')}
        >
          Find center from rim
        </Button>
        <Button
          variant={props.method === 'marked-center' ? 'primary' : 'default'}
          disabled={props.sessionDisabled}
          aria-pressed={props.method === 'marked-center'}
          onClick={() => props.onMethodChange('marked-center')}
        >
          Center already marked
        </Button>
      </div>
      {props.method === 'rim-fit' ? (
        <RimFitCapture {...props} />
      ) : (
        <MarkedCenterCapture {...props} />
      )}
    </div>
  );
}

function RimFitCapture(props: Parameters<typeof CircleCaptureSteps>[0]): JSX.Element {
  const count = props.corners.length;
  const complete = count >= CIRCLE_RIM_POINT_COUNT;
  const fit = complete ? bestFitCircleFromRimPoints(props.corners) : null;
  return (
    <div style={columnStyle}>
      <p style={stepStyle}>{rimGuidance(count)}</p>
      <LivePositionRow position={props.livePosition} />
      <div style={buttonRowStyle}>
        <Button
          variant="primary"
          disabled={props.disabled || props.livePosition === null || complete}
          title="Record a well-spaced point on the physical circle rim. The laser stays off."
          onClick={props.onCapture}
        >
          Capture rim point
        </Button>
        <Button
          variant="ghost"
          disabled={props.sessionDisabled || count === 0}
          onClick={props.onUndo}
        >
          Undo last
        </Button>
        {count > 0 && (
          <Button
            variant="ghost"
            disabled={props.sessionDisabled}
            onClick={() => props.onMethodChange('rim-fit')}
          >
            Start over
          </Button>
        )}
      </div>
      {complete && fit === null && (
        <p role="alert" style={warnStyle}>
          Those points cannot define a reliable circle. Start over and capture four points spread
          around the rim.
        </p>
      )}
      {fit !== null && (
        <CircleCenterConfirmation
          key={captureKey(props.corners)}
          fit={fit}
          livePosition={props.livePosition}
          disabled={props.disabled}
          onMoveToPoint={props.onMoveToPoint}
          onFinish={props.onFinish}
        />
      )}
    </div>
  );
}

function MarkedCenterCapture(props: Parameters<typeof CircleCaptureSteps>[0]): JSX.Element {
  const count = props.corners.length;
  const center = props.corners[0];
  const rim = props.corners[1];
  const measured =
    center !== undefined && rim !== undefined ? diameterFromCenterEdge(center, rim) : null;
  return (
    <div style={columnStyle}>
      <p style={stepStyle}>{markedCenterGuidance(count)}</p>
      <LivePositionRow position={props.livePosition} />
      <div style={buttonRowStyle}>
        <Button
          variant="primary"
          disabled={props.disabled || props.livePosition === null || count >= 2}
          title={markedCaptureTitle(count, props.livePosition)}
          onClick={props.onCapture}
        >
          {count === 0 ? 'Capture center' : 'Capture edge'}
        </Button>
        <Button
          variant="ghost"
          disabled={props.sessionDisabled || count === 0}
          onClick={props.onUndo}
        >
          Undo last
        </Button>
        {count > 0 && (
          <Button
            variant="ghost"
            disabled={props.sessionDisabled}
            onClick={() => props.onMethodChange('marked-center')}
          >
            Start over
          </Button>
        )}
      </div>
      {center !== undefined && (
        <CircleDiameterForm
          key={measured === null ? 'typed' : `measured-${measured}`}
          initialDiameter={measured}
          center={center}
          disabled={props.disabled}
          onDraw={props.onFinish}
        />
      )}
    </div>
  );
}

function CircleDiameterForm(props: {
  readonly initialDiameter: number | null;
  readonly center: Vec2;
  readonly disabled: boolean;
  readonly onDraw: (center: Vec2, diameterMm: number) => Promise<void>;
}): JSX.Element {
  const [typed, setTyped] = useState(
    props.initialDiameter === null ? '' : props.initialDiameter.toFixed(1),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diameter = Number(typed);
  const canDraw = Number.isFinite(diameter) && diameter >= MIN_BOARD_DIMENSION_MM;
  const draw = (): void => {
    if (!canDraw || saving) return;
    setSaving(true);
    setError(null);
    void props
      .onDraw(props.center, diameter)
      .catch((cause: unknown) =>
        setError(errorMessage(cause, 'Could not create the circle outline.')),
      )
      .finally(() => setSaving(false));
  };
  return (
    <div style={formStyle}>
      <p style={hintStyle}>Diameter — type it, or jog to the rim and Capture edge:</p>
      <div style={buttonRowStyle}>
        <NumberInput
          aria-label="Circle diameter in mm"
          value={typed}
          disabled={props.disabled}
          min={MIN_BOARD_DIMENSION_MM}
          step={1}
          style={inputStyle}
          onChange={(event) => setTyped(event.target.value)}
        />
        <span style={mutedStyle}>mm ⌀</span>
        {props.initialDiameter !== null && (
          <span style={mutedStyle}>measured {props.initialDiameter.toFixed(1)}</span>
        )}
      </div>
      {typed !== '' && !canDraw && (
        <p style={warnStyle}>
          That&apos;s too small — type a diameter of at least {MIN_BOARD_DIMENSION_MM} mm.
        </p>
      )}
      <Button variant="primary" disabled={props.disabled || !canDraw || saving} onClick={draw}>
        {saving ? 'Creating…' : 'Create board outline'}
      </Button>
      {error !== null && (
        <p role="alert" style={warnStyle}>
          {error}
        </p>
      )}
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

function rimGuidance(count: number): string {
  if (count >= CIRCLE_RIM_POINT_COUNT) return 'All four rim points captured.';
  return `Rim point ${count + 1} of ${CIRCLE_RIM_POINT_COUNT}: jog to the physical edge. Spread the points around the circle.`;
}

function markedCenterGuidance(count: number): string {
  if (count === 0) return 'Jog to the marked center, then Capture — this sets the work origin.';
  return 'Type the diameter, or jog to any point on the rim and Capture edge to measure it.';
}

function markedCaptureTitle(count: number, livePosition: Vec2 | null): string {
  if (livePosition === null) return 'Waiting for a live machine position.';
  return count === 0
    ? 'Record the head position at the marked circle center.'
    : 'Record a point on the rim to measure the diameter.';
}

function captureKey(points: ReadonlyArray<Vec2>): string {
  return points.map((point) => `${point.x},${point.y}`).join('|');
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
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
const confirmationStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 6,
};
const formStyle: React.CSSProperties = { ...confirmationStyle };
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const inputStyle: React.CSSProperties = { width: 64 };
const mutedStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const warnStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--lf-warning-fg)',
};
