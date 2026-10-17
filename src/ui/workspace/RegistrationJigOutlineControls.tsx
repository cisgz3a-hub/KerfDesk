import { useEffect, useMemo, useState } from 'react';
import {
  findRegistrationBoxes,
  transformedBBox,
  type Scene,
  type ShapeObject,
} from '../../core/scene';
import {
  registrationJigSetIssue,
  type RegistrationJigSetSpec,
} from '../state/registration-jig-set-actions';
import { Button } from '../kit';
import {
  removedJigArtworkIds,
  type RemovedJigArtworkPolicy,
} from '../state/registration-jig-layout';
import {
  RegistrationJigGridFields,
  RegistrationJigShapeFields,
  RemoveRegistrationJigSetButton,
  type RegistrationJigShape,
} from './RegistrationJigOutlineFields';

const DEFAULT_WIDTH_MM = 80;
const DEFAULT_HEIGHT_MM = 40;
const DEFAULT_DIAMETER_MM = 60;
const DEFAULT_ROWS = 1;
const DEFAULT_COLUMNS = 1;
const DEFAULT_SPACING_MM = 5;
const GRID_ALIGNMENT_TOLERANCE_MM = 0.0001;

type InitialOutlineControls = {
  readonly hasOutline: boolean;
  readonly locked: boolean;
  readonly shape: RegistrationJigShape;
  readonly widthMm: string;
  readonly heightMm: string;
  readonly diameterMm: string;
};

type InitialGridControls = {
  readonly rows: string;
  readonly columns: string;
  readonly spacingX: string;
  readonly spacingY: string;
};

export function RegistrationJigOutlineControls(props: {
  readonly scene: Scene;
  readonly onReplace: (spec: RegistrationJigSetSpec) => void;
  readonly onRemove: () => void;
  readonly onPendingChange: (pending: boolean) => void;
}): JSX.Element {
  const boxes = findRegistrationBoxes(props.scene);
  const fields = useOutlineFields(boxes, props.onPendingChange);
  const [removedArtwork, setRemovedArtwork] = useState<RemovedJigArtworkPolicy>('keep');
  const spec = { ...fields.spec, removedArtwork };
  const issue = registrationJigSetIssue(spec, props.scene);
  const captured = boxes.some((box) => box.provenance === 'captured-board');
  return (
    <>
      <RegistrationJigShapeFields {...fields.shapeFields} />
      <RegistrationJigGridFields {...fields.gridFields} />
      <JigLayoutSummary
        scene={props.scene}
        issue={issue}
        requestedCount={spec.rows * spec.columns}
        outlineCount={boxes.length}
        removedArtwork={removedArtwork}
        onPolicyChange={setRemovedArtwork}
      />
      <div style={actionRowStyle}>
        <ReplaceJigButton
          capturedBoard={captured}
          issue={issue}
          label="Apply layout"
          onClick={() => {
            props.onReplace(spec);
            setRemovedArtwork('keep');
          }}
        />
        <RemoveRegistrationJigSetButton
          show={boxes.length > 0 && !captured}
          outlineCount={boxes.length}
          onClick={props.onRemove}
        />
      </div>
    </>
  );
}

function useOutlineFields(
  boxes: ReadonlyArray<ShapeObject>,
  onPendingChange: (pending: boolean) => void,
) {
  const initial = initialOutlineControls(boxes[0]);
  const initialGrid = initialGridControls(boxes);
  const [shape, setShape] = useState<RegistrationJigShape>(initial.shape);
  const [widthMm, setWidthMm] = useState(initial.widthMm);
  const [heightMm, setHeightMm] = useState(initial.heightMm);
  const [diameterMm, setDiameterMm] = useState(initial.diameterMm);
  const [rows, setRows] = useState(initialGrid.rows);
  const [columns, setColumns] = useState(initialGrid.columns);
  const [spacingX, setSpacingX] = useState(initialGrid.spacingX);
  const [spacingY, setSpacingY] = useState(initialGrid.spacingY);
  const pending =
    JSON.stringify([shape, widthMm, heightMm, diameterMm, rows, columns, spacingX, spacingY]) !==
    JSON.stringify([
      initial.shape,
      initial.widthMm,
      initial.heightMm,
      initial.diameterMm,
      initialGrid.rows,
      initialGrid.columns,
      initialGrid.spacingX,
      initialGrid.spacingY,
    ]);
  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);
  return {
    spec: jigSetSpec(shape, widthMm, heightMm, diameterMm, rows, columns, spacingX, spacingY),
    shapeFields: {
      shape,
      widthMm,
      heightMm,
      diameterMm,
      onShapeChange: setShape,
      onWidthChange: setWidthMm,
      onHeightChange: setHeightMm,
      onDiameterChange: setDiameterMm,
    },
    gridFields: {
      rows,
      columns,
      spacingX,
      spacingY,
      onRowsChange: setRows,
      onColumnsChange: setColumns,
      onSpacingXChange: setSpacingX,
      onSpacingYChange: setSpacingY,
    },
  };
}

function ReplaceJigButton(props: {
  readonly capturedBoard: boolean;
  readonly issue: string | null;
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <Button
      variant="primary"
      disabled={props.capturedBoard || props.issue !== null}
      title={
        props.capturedBoard
          ? 'This outline is a captured board — Remove it or re-capture with Place Board.'
          : (props.issue ?? 'Create one registered outline for every row and column in the jig set')
      }
      onClick={props.onClick}
    >
      {props.label}
    </Button>
  );
}

function JigLayoutSummary(props: {
  readonly scene: Scene;
  readonly issue: string | null;
  readonly requestedCount: number;
  readonly outlineCount: number;
  readonly removedArtwork: RemovedJigArtworkPolicy;
  readonly onPolicyChange: (policy: RemovedJigArtworkPolicy) => void;
}): JSX.Element {
  const removedCount = useMemo(
    () =>
      Number.isSafeInteger(props.requestedCount) && props.requestedCount >= 1
        ? removedJigArtworkIds(props.scene, props.requestedCount).size
        : 0,
    [props.scene, props.requestedCount],
  );
  return (
    <>
      <p style={setSummaryStyle}>
        {props.issue ??
          (props.outlineCount === 0
            ? `${props.requestedCount} ${jigWord(props.requestedCount)} requested`
            : `${props.outlineCount} ${jigWord(props.outlineCount)} on canvas`)}
      </p>
      {props.outlineCount > 0 && (
        <p style={setSummaryStyle}>
          Replacing this grid moves linked artwork with its slots, keeping size and offset. New
          slots start empty.
        </p>
      )}
      {removedCount > 0 && (
        <label style={setSummaryStyle}>
          {removedCount} artwork object{removedCount === 1 ? '' : 's'} in removed slots
          <select
            aria-label="Artwork in removed jig slots"
            title="Choose whether to keep or remove artwork belonging to slots removed by this grid edit"
            value={props.removedArtwork}
            onChange={(event) =>
              props.onPolicyChange(event.target.value === 'remove' ? 'remove' : 'keep')
            }
            style={{ width: '100%', marginTop: 4 }}
          >
            <option value="keep">Keep as ordinary artwork</option>
            <option value="remove">Remove with their slots</option>
          </select>
          <span>
            {props.removedArtwork === 'keep'
              ? 'Kept artwork stays in place and can still output on its enabled operations.'
              : 'This edit removes that artwork and its slot membership. Undo restores both.'}
          </span>
        </label>
      )}
      <CapturedBoardWarning
        show={findRegistrationBoxes(props.scene).some((box) => box.provenance === 'captured-board')}
      />
    </>
  );
}

function CapturedBoardWarning(props: { readonly show: boolean }): JSX.Element | null {
  if (!props.show) return null;
  return (
    <p style={capturedWarnStyle}>
      This outline is a captured board — replacing it here breaks its physical registration. Use
      Place Board to re-capture, or Remove it first.
    </p>
  );
}

function initialOutlineControls(box: ShapeObject | undefined): InitialOutlineControls {
  if (box === undefined) return defaultOutlineControls();
  if (box.spec.kind === 'ellipse') {
    return {
      hasOutline: true,
      locked: box.locked === true,
      shape: 'circle',
      widthMm: String(DEFAULT_WIDTH_MM),
      heightMm: String(DEFAULT_HEIGHT_MM),
      diameterMm: String(box.spec.widthMm * Math.abs(box.transform.scaleX)),
    };
  }
  if (box.spec.kind === 'rect') {
    return {
      hasOutline: true,
      locked: box.locked === true,
      shape: 'rectangle',
      widthMm: String(box.spec.widthMm * Math.abs(box.transform.scaleX)),
      heightMm: String(box.spec.heightMm * Math.abs(box.transform.scaleY)),
      diameterMm: String(DEFAULT_DIAMETER_MM),
    };
  }
  return { ...defaultOutlineControls(), hasOutline: true, locked: box.locked === true };
}

function defaultOutlineControls(): InitialOutlineControls {
  return {
    hasOutline: false,
    locked: false,
    shape: 'rectangle',
    widthMm: String(DEFAULT_WIDTH_MM),
    heightMm: String(DEFAULT_HEIGHT_MM),
    diameterMm: String(DEFAULT_DIAMETER_MM),
  };
}

function initialGridControls(boxes: ReadonlyArray<ShapeObject>): InitialGridControls {
  if (boxes.length === 0) return defaultGridControls();
  const bounds = boxes.map(transformedBBox);
  const xCenters = distinctCoordinates(bounds.map((box) => (box.minX + box.maxX) / 2));
  const yCenters = distinctCoordinates(bounds.map((box) => (box.minY + box.maxY) / 2));
  if (xCenters.length * yCenters.length !== boxes.length) {
    return { ...defaultGridControls(), columns: String(boxes.length) };
  }
  const first = bounds[0];
  if (first === undefined) return defaultGridControls();
  return {
    rows: String(yCenters.length),
    columns: String(xCenters.length),
    spacingX: String(axisSpacing(xCenters, first.maxX - first.minX)),
    spacingY: String(axisSpacing(yCenters, first.maxY - first.minY)),
  };
}

function defaultGridControls(): InitialGridControls {
  return {
    rows: String(DEFAULT_ROWS),
    columns: String(DEFAULT_COLUMNS),
    spacingX: String(DEFAULT_SPACING_MM),
    spacingY: String(DEFAULT_SPACING_MM),
  };
}

function distinctCoordinates(values: ReadonlyArray<number>): ReadonlyArray<number> {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.filter(
    (value, index) =>
      index === 0 || Math.abs(value - (sorted[index - 1] ?? value)) > GRID_ALIGNMENT_TOLERANCE_MM,
  );
}

function axisSpacing(coordinates: ReadonlyArray<number>, outlineSpan: number): number {
  const first = coordinates[0];
  const second = coordinates[1];
  return first === undefined || second === undefined
    ? DEFAULT_SPACING_MM
    : Math.max(0, second - first - outlineSpan);
}

function jigSetSpec(
  shape: RegistrationJigShape,
  widthMm: string,
  heightMm: string,
  diameterMm: string,
  rows: string,
  columns: string,
  spacingX: string,
  spacingY: string,
): RegistrationJigSetSpec {
  return {
    outline:
      shape === 'circle'
        ? { kind: 'circle', diameterMm: finiteNumber(diameterMm) }
        : { kind: 'rectangle', widthMm: finiteNumber(widthMm), heightMm: finiteNumber(heightMm) },
    rows: finiteNumber(rows),
    columns: finiteNumber(columns),
    spacingX: finiteNumber(spacingX),
    spacingY: finiteNumber(spacingY),
  };
}

function finiteNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function jigWord(count: number): string {
  return count === 1 ? 'jig' : 'jigs';
}

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};
const setSummaryStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const capturedWarnStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 12,
  color: 'var(--lf-warning-fg)',
};
