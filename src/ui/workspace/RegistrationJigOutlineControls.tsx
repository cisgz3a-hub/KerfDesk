import { useState } from 'react';
import { findRegistrationBoxes, transformedBBox, type ShapeObject } from '../../core/scene';
import {
  registrationJigSetIssue,
  type RegistrationJigSetSpec,
} from '../state/registration-jig-set-actions';
import { Button } from '../kit';
import { useStore } from '../state';
import {
  LockRegistrationJigSetControl,
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

export function RegistrationJigOutlineControls(): JSX.Element {
  const scene = useStore((state) => state.project.scene);
  const replaceSet = useStore((state) => state.replaceRegistrationJigSet);
  const removeSet = useStore((state) => state.removeRegistrationBox);
  const setLocked = useStore((state) => state.setRegistrationBoxLocked);
  const boxes = findRegistrationBoxes(scene);
  const initial = initialOutlineControls(boxes[0]);
  const initialGrid = initialGridControls(boxes);
  const isCapturedBoard = boxes.some((box) => box.provenance === 'captured-board');
  const [shape, setShape] = useState<RegistrationJigShape>(initial.shape);
  const [widthMm, setWidthMm] = useState(initial.widthMm);
  const [heightMm, setHeightMm] = useState(initial.heightMm);
  const [diameterMm, setDiameterMm] = useState(initial.diameterMm);
  const [rows, setRows] = useState(initialGrid.rows);
  const [columns, setColumns] = useState(initialGrid.columns);
  const [spacingX, setSpacingX] = useState(initialGrid.spacingX);
  const [spacingY, setSpacingY] = useState(initialGrid.spacingY);
  const spec = jigSetSpec(shape, widthMm, heightMm, diameterMm, rows, columns, spacingX, spacingY);
  const issue = registrationJigSetIssue(spec, scene);
  const requestedCount = spec.rows * spec.columns;

  return (
    <>
      <RegistrationJigShapeFields
        shape={shape}
        widthMm={widthMm}
        heightMm={heightMm}
        diameterMm={diameterMm}
        onShapeChange={setShape}
        onWidthChange={setWidthMm}
        onHeightChange={setHeightMm}
        onDiameterChange={setDiameterMm}
      />
      <RegistrationJigGridFields
        rows={rows}
        columns={columns}
        spacingX={spacingX}
        spacingY={spacingY}
        onRowsChange={setRows}
        onColumnsChange={setColumns}
        onSpacingXChange={setSpacingX}
        onSpacingYChange={setSpacingY}
      />
      <p style={setSummaryStyle}>
        {issue !== null
          ? issue
          : boxes.length === 0
            ? `${requestedCount} ${jigWord(requestedCount)} requested`
            : `${boxes.length} ${jigWord(boxes.length)} on canvas`}
      </p>
      <div style={actionRowStyle}>
        <Button
          variant="primary"
          disabled={isCapturedBoard || issue !== null}
          title={
            isCapturedBoard
              ? 'This outline is a captured board — Remove it or re-capture with Place Board.'
              : (issue ?? 'Create one registered outline for every row and column in the jig set')
          }
          onClick={() => replaceSet(spec)}
        >
          {createButtonLabel(initial.hasOutline, requestedCount)}
        </Button>
        <RemoveRegistrationJigSetButton
          show={initial.hasOutline}
          outlineCount={boxes.length}
          onClick={removeSet}
        />
      </div>
      <LockRegistrationJigSetControl
        show={initial.hasOutline}
        checked={initial.locked}
        disabled={isCapturedBoard}
        outlineCount={boxes.length}
        onChange={setLocked}
      />
      <CapturedBoardWarning show={isCapturedBoard} />
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
      diameterMm: String(box.spec.widthMm),
    };
  }
  if (box.spec.kind === 'rect') {
    return {
      hasOutline: true,
      locked: box.locked === true,
      shape: 'rectangle',
      widthMm: String(box.spec.widthMm),
      heightMm: String(box.spec.heightMm),
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

function createButtonLabel(hasOutline: boolean, count: number): string {
  if (!Number.isSafeInteger(count) || count < 1)
    return hasOutline ? 'Replace outlines' : 'Create outlines';
  if (count === 1) return hasOutline ? 'Replace outline' : 'Create outline';
  return hasOutline ? `Replace with ${count} jigs` : `Create ${count} jigs`;
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
