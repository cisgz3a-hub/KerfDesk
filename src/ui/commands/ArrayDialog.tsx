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
  readonly onApply: (spec: ArraySpec, advanceVariables?: boolean) => void;
  readonly hasVariableText?: boolean;
  readonly errorMessage?: string;
  readonly preparing?: boolean;
}): JSX.Element {
  const [mode, setMode] = useState<ArraySpec['kind']>('grid');
  const [advanceVariables, setAdvanceVariables] = useState(false);
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
  return (
    <Dialog
      title="Array"
      size="sm"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        const spec = arraySpecFromDraft(mode, draft);
        return advanceVariables ? props.onApply(spec, true) : props.onApply(spec);
      }}
    >
      <ArrayModes mode={mode} onChange={setMode} />
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
      <VariableArrayOption
        visible={props.hasVariableText === true}
        mode={mode}
        checked={advanceVariables}
        onChange={setAdvanceVariables}
      />
      {props.preparing === true ? <p role="status">Preparing variable copies…</p> : null}
      {props.errorMessage === undefined ? null : <p role="alert">{props.errorMessage}</p>}
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Create array
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ArrayModes(props: {
  readonly mode: ArraySpec['kind'];
  readonly onChange: (mode: ArraySpec['kind']) => void;
}): JSX.Element {
  return (
    <div role="tablist" aria-label="Array type" style={tabsStyle}>
      <ModeButton
        active={props.mode === 'grid'}
        label="Grid"
        onClick={() => props.onChange('grid')}
      />
      <ModeButton
        active={props.mode === 'point-rotation'}
        label="Point Rotation"
        onClick={() => props.onChange('point-rotation')}
      />
      <ModeButton
        active={props.mode === 'circular'}
        label="Circular"
        onClick={() => props.onChange('circular')}
      />
    </div>
  );
}

function VariableArrayOption(props: {
  readonly visible: boolean;
  readonly mode: ArraySpec['kind'];
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
      <label>
        <input
          type="checkbox"
          checked={props.checked}
          title="Assign each array copy a variable record using the current range and advance settings."
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />{' '}
        Advance variables per copy
      </label>
      {props.checked ? (
        <p style={{ margin: 0, fontSize: 13 }}>
          {VARIABLE_ARRAY_HINTS[props.mode]} Values use Advance by and wrap at range ends. Later
          data changes keep your placements; preview again. Creating copies does not advance the
          current record.
        </p>
      ) : null}
    </div>
  );
}

const VARIABLE_ARRAY_HINTS: Record<ArraySpec['kind'], string> = {
  grid: 'Records run left to right in each row. Spacing fits all current values.',
  circular:
    'Records follow increasing angles from the start angle. Each copy is centred on the chosen ring. The radius stays fixed, so wide copies can overlap.',
  'point-rotation':
    'Records start at the original placement and follow the signed total angle. All copies share the first evaluated design’s centre. Rotated copies can overlap.',
};

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
