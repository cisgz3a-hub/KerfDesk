import { useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
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
import { removedJigArtworkIds } from '../state/registration-jig-layout';
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

type OutlineFieldValues = {
  readonly shape: RegistrationJigShape;
  readonly widthMm: string;
  readonly heightMm: string;
  readonly diameterMm: string;
  readonly rows: string;
  readonly columns: string;
  readonly spacingX: string;
  readonly spacingY: string;
};

/**
 * The outline shape, size and grid (ADR-638). A change applies when Enter is
 * pressed, the shape is picked, or focus leaves the fields, so W, H, rows and
 * columns typed together rebuild the grid once. Escape returns the fields to
 * the outlines as they are; an invalid value says why and goes back too.
 */
export function RegistrationJigOutlineControls(props: {
  readonly scene: Scene;
  /** `leftover` is artwork from removed pieces, kept as ordinary artwork. */
  readonly onReplace: (spec: RegistrationJigSetSpec, leftover: ReadonlySet<string>) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const boxes = findRegistrationBoxes(props.scene);
  const captured = boxes.some((box) => box.provenance === 'captured-board');
  const fields = useOutlineFieldCommit(props.scene, boxes, captured, props.onReplace);
  const { values, set } = fields;
  const spec = jigSetSpec(values);
  const issue = registrationJigSetIssue(spec, props.scene);
  return (
    <>
      <div style={fieldsStyle} onBlur={fields.onBlur} onKeyDown={fields.onKeyDown}>
        <RegistrationJigShapeFields
          shape={values.shape}
          widthMm={values.widthMm}
          heightMm={values.heightMm}
          diameterMm={values.diameterMm}
          onShapeChange={fields.setShape}
          onWidthChange={(widthMm) => set({ widthMm })}
          onHeightChange={(heightMm) => set({ heightMm })}
          onDiameterChange={(diameterMm) => set({ diameterMm })}
        />
        <RegistrationJigGridFields
          rows={values.rows}
          columns={values.columns}
          spacingX={values.spacingX}
          spacingY={values.spacingY}
          onRowsChange={(rows) => set({ rows })}
          onColumnsChange={(columns) => set({ columns })}
          onSpacingXChange={(spacingX) => set({ spacingX })}
          onSpacingYChange={(spacingY) => set({ spacingY })}
        />
      </div>
      <p style={summaryStyle} role="status">
        {fields.rejected ?? issue ?? outlineSummary(boxes.length, spec.rows * spec.columns)}
      </p>
      <CapturedBoardWarning show={captured} />
      {boxes.length === 0 ? (
        <Button
          variant="primary"
          disabled={issue !== null}
          title={issue ?? 'Create one outline for every row and column'}
          onClick={() => fields.commit(values, true)}
        >
          Create outlines
        </Button>
      ) : (
        <RemoveRegistrationJigSetButton
          show={!captured}
          outlineCount={boxes.length}
          onClick={props.onRemove}
        />
      )}
    </>
  );
}

// The fields start from the outlines as they are (the parent remounts them
// when the outlines change) and publish a valid, changed layout at once.
function useOutlineFieldCommit(
  scene: Scene,
  boxes: ReadonlyArray<ShapeObject>,
  captured: boolean,
  onReplace: (spec: RegistrationJigSetSpec, leftover: ReadonlySet<string>) => void,
) {
  const [initial] = useState(() => initialFieldValues(boxes));
  const [values, setValues] = useState(initial);
  const [rejected, setRejected] = useState<string | null>(null);
  // Escape returns the fields; the blur that follows must not publish them.
  const skipCommit = useRef(false);
  const commit = (next: OutlineFieldValues, force = false): void => {
    if (captured) return;
    if (!force && JSON.stringify(next) === JSON.stringify(initial)) return;
    const nextSpec = jigSetSpec(next);
    const nextIssue = registrationJigSetIssue(nextSpec, scene);
    if (nextIssue !== null) {
      setRejected(nextIssue);
      setValues(initial);
      return;
    }
    setRejected(null);
    onReplace(
      { ...nextSpec, removedArtwork: 'keep' },
      removedJigArtworkIds(scene, nextSpec.rows * nextSpec.columns),
    );
  };
  return {
    values,
    rejected,
    commit,
    set: (patch: Partial<OutlineFieldValues>): void => {
      skipCommit.current = false;
      setValues((current) => ({ ...current, ...patch }));
    },
    setShape: (shape: RegistrationJigShape): void => {
      const next = { ...values, shape };
      setValues(next);
      commit(next);
    },
    onBlur: (event: FocusEvent<HTMLDivElement>): void => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      if (skipCommit.current) skipCommit.current = false;
      else commit(values);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(values);
      } else if (event.key === 'Escape') {
        skipCommit.current = true;
        setValues(initial);
        setRejected(null);
      }
    },
  };
}

function outlineSummary(outlineCount: number, requested: number): string {
  if (outlineCount === 0) return `${requested} ${pieceWord(requested)} to create`;
  return `${outlineCount} ${pieceWord(outlineCount)} · changes apply on Enter or when you leave the fields`;
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

function initialFieldValues(boxes: ReadonlyArray<ShapeObject>): OutlineFieldValues {
  return { ...initialOutline(boxes[0]), ...initialGrid(boxes) };
}

function initialOutline(
  box: ShapeObject | undefined,
): Pick<OutlineFieldValues, 'shape' | 'widthMm' | 'heightMm' | 'diameterMm'> {
  const defaults = {
    shape: 'rectangle' as const,
    widthMm: String(DEFAULT_WIDTH_MM),
    heightMm: String(DEFAULT_HEIGHT_MM),
    diameterMm: String(DEFAULT_DIAMETER_MM),
  };
  if (box?.spec.kind === 'ellipse') {
    return {
      ...defaults,
      shape: 'circle',
      diameterMm: String(box.spec.widthMm * Math.abs(box.transform.scaleX)),
    };
  }
  if (box?.spec.kind === 'rect') {
    return {
      ...defaults,
      widthMm: String(box.spec.widthMm * Math.abs(box.transform.scaleX)),
      heightMm: String(box.spec.heightMm * Math.abs(box.transform.scaleY)),
    };
  }
  return defaults;
}

function initialGrid(
  boxes: ReadonlyArray<ShapeObject>,
): Pick<OutlineFieldValues, 'rows' | 'columns' | 'spacingX' | 'spacingY'> {
  const defaults = {
    rows: String(DEFAULT_ROWS),
    columns: String(DEFAULT_COLUMNS),
    spacingX: String(DEFAULT_SPACING_MM),
    spacingY: String(DEFAULT_SPACING_MM),
  };
  if (boxes.length === 0) return defaults;
  const bounds = boxes.map(transformedBBox);
  const xCenters = distinctCoordinates(bounds.map((box) => (box.minX + box.maxX) / 2));
  const yCenters = distinctCoordinates(bounds.map((box) => (box.minY + box.maxY) / 2));
  if (xCenters.length * yCenters.length !== boxes.length) {
    return { ...defaults, columns: String(boxes.length) };
  }
  const first = bounds[0];
  if (first === undefined) return defaults;
  return {
    rows: String(yCenters.length),
    columns: String(xCenters.length),
    spacingX: String(axisSpacing(xCenters, first.maxX - first.minX)),
    spacingY: String(axisSpacing(yCenters, first.maxY - first.minY)),
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

function jigSetSpec(values: OutlineFieldValues): RegistrationJigSetSpec {
  return {
    outline:
      values.shape === 'circle'
        ? { kind: 'circle', diameterMm: finiteNumber(values.diameterMm) }
        : {
            kind: 'rectangle',
            widthMm: finiteNumber(values.widthMm),
            heightMm: finiteNumber(values.heightMm),
          },
    rows: finiteNumber(values.rows),
    columns: finiteNumber(values.columns),
    spacingX: finiteNumber(values.spacingX),
    spacingY: finiteNumber(values.spacingY),
  };
}

function finiteNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function pieceWord(count: number): string {
  return count === 1 ? 'piece' : 'pieces';
}

const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 6 };
const summaryStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const capturedWarnStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 12,
  color: 'var(--lf-warning-fg)',
};
