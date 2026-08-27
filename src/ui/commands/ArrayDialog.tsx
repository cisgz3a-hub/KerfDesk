import { useState } from 'react';
import { assertNever, type ArraySpec, type Bounds } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import {
  CircularArrayFields,
  GridArrayFields,
  PointRotationArrayFields,
} from './ArrayDialogFields';

export function ArrayDialog(props: {
  readonly selectionBounds: Bounds;
  readonly onCancel: () => void;
  readonly onApply: (spec: ArraySpec) => void;
}): JSX.Element {
  const [mode, setMode] = useState<ArraySpec['kind']>('grid');
  const [rows, setRows] = useState('2');
  const [columns, setColumns] = useState('2');
  const [spacingX, setSpacingX] = useState('2');
  const [spacingY, setSpacingY] = useState('2');
  const [count, setCount] = useState('6');
  const [centerX, setCenterX] = useState(center(props.selectionBounds, 'x').toFixed(2));
  const [centerY, setCenterY] = useState(center(props.selectionBounds, 'y').toFixed(2));
  const [radius, setRadius] = useState('25');
  const [startAngle, setStartAngle] = useState('0');
  const [rotateCopies, setRotateCopies] = useState(false);
  const [totalAngle, setTotalAngle] = useState('360');
  const draft = {
    rows,
    columns,
    spacingX,
    spacingY,
    count,
    centerX,
    centerY,
    radius,
    startAngle,
    rotateCopies,
    totalAngle,
  };
  const submit = (): void => props.onApply(arraySpecFromDraft(mode, draft));
  return (
    <Dialog
      title="Array"
      size="sm"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div role="tablist" aria-label="Array type" style={tabsStyle}>
        <ModeButton active={mode === 'grid'} label="Grid" onClick={() => setMode('grid')} />
        <ModeButton
          active={mode === 'point-rotation'}
          label="Point Rotation"
          onClick={() => setMode('point-rotation')}
        />
        <ModeButton
          active={mode === 'circular'}
          label="Circular"
          onClick={() => setMode('circular')}
        />
      </div>
      {mode === 'grid' ? (
        <GridArrayFields
          values={{ rows, columns, spacingX, spacingY }}
          setters={{ setRows, setColumns, setSpacingX, setSpacingY }}
        />
      ) : mode === 'point-rotation' ? (
        <PointRotationArrayFields
          values={{ count, totalAngle }}
          setters={{ setCount, setTotalAngle }}
        />
      ) : (
        <CircularArrayFields
          values={{ count, centerX, centerY, radius, startAngle, rotateCopies }}
          setters={{ setCount, setCenterX, setCenterY, setRadius, setStartAngle, setRotateCopies }}
        />
      )}
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Create array
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ModeButton(props: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      title={`Use ${props.label.toLowerCase()} array placement`}
      aria-selected={props.active}
      className="lf-button"
      style={{ ...tabStyle, fontWeight: props.active ? 600 : 400 }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function center(bounds: Bounds, axis: 'x' | 'y'): number {
  return axis === 'x' ? (bounds.minX + bounds.maxX) / 2 : (bounds.minY + bounds.maxY) / 2;
}

type ArrayDialogDraft = {
  readonly rows: string;
  readonly columns: string;
  readonly spacingX: string;
  readonly spacingY: string;
  readonly count: string;
  readonly centerX: string;
  readonly centerY: string;
  readonly radius: string;
  readonly startAngle: string;
  readonly rotateCopies: boolean;
  readonly totalAngle: string;
};

function arraySpecFromDraft(mode: ArraySpec['kind'], draft: ArrayDialogDraft): ArraySpec {
  switch (mode) {
    case 'grid':
      return {
        kind: 'grid',
        rows: positiveInteger(draft.rows),
        columns: positiveInteger(draft.columns),
        spacingX: nonNegative(draft.spacingX),
        spacingY: nonNegative(draft.spacingY),
      };
    case 'point-rotation':
      return {
        kind: 'point-rotation',
        count: positiveInteger(draft.count),
        totalAngleDeg: finiteNumber(draft.totalAngle),
      };
    case 'circular':
      return {
        kind: 'circular',
        count: positiveInteger(draft.count),
        centerX: finiteNumber(draft.centerX),
        centerY: finiteNumber(draft.centerY),
        radius: nonNegative(draft.radius),
        startAngleDeg: finiteNumber(draft.startAngle),
        rotateCopies: draft.rotateCopies,
      };
    default:
      return assertNever(mode, 'Array mode');
  }
}

function positiveInteger(raw: string): number {
  return Math.max(1, Math.floor(finiteNumber(raw)));
}

function nonNegative(raw: string): number {
  return Math.max(0, finiteNumber(raw));
}

function finiteNumber(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

const tabsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 4,
};
const tabStyle: React.CSSProperties = { minHeight: 32 };
