// Offset Shapes dialog (LightBurn gap batch 3, ADR-410). Distance, direction,
// corner style, Outer Shapes Only and Delete Originals, with a live preview and
// size readout computed by the same core call the action uses. That call runs
// in the vector worker (ADR-609), and Apply commits its settled result.

import { useMemo, useState } from 'react';
import type { VectorSceneObject } from '../../core/geometry';
import type { OffsetCornerStyle, OffsetDirection } from '../../core/geometry/offset-shapes';
import type { ImportedSvg, Scene } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { evaluateNumericEntry } from '../../core/numeric-expression';
import {
  offsetShapesResultIds,
  offsetShapesTargets,
  type OffsetShapesRequest,
} from '../state/offset-shapes-actions';
import {
  OffsetNotices,
  ResultOperationField,
  useNoInwardNotice,
  useOffsetResultOperation,
} from './OffsetResultOperationField';
import type { PreparedOffsetShapes } from '../state/vector-op-prepared';
import { OffsetShapesPreview } from './OffsetShapesPreview';
import {
  useStableObjects,
  useVectorOpPreview,
  type VectorOpPreview,
} from './use-vector-op-preview';

export const DEFAULT_OFFSET_SHAPES_REQUEST: OffsetShapesRequest = {
  distanceMm: 1,
  direction: 'outward',
  cornerStyle: 'round',
  outerShapesOnly: false,
  deleteOriginals: false,
};

const DIRECTIONS: ReadonlyArray<readonly [OffsetDirection, string, string]> = [
  ['outward', 'Outward', 'Grow the shapes; open lines get a closed outline around them.'],
  ['inward', 'Inward', 'Shrink closed shapes.'],
  ['both', 'Both', 'Make one outward and one inward copy.'],
];

const CORNERS: ReadonlyArray<readonly [OffsetCornerStyle, string, string]> = [
  ['round', 'Round', 'Round the outward corners.'],
  ['bevel', 'Bevel', 'Cut the outward corners off flat.'],
  ['corner', 'Corner', 'Keep the outward corners sharp.'],
];

type OffsetShapesForm = Omit<OffsetShapesRequest, 'distanceMm'> & {
  readonly distanceText: string;
};

export function OffsetShapesDialog(props: {
  readonly scene: Scene;
  readonly selectedIds: ReadonlyArray<string>;
  readonly initial: OffsetShapesRequest;
  /** The artwork outputs a jig's Artwork only restores (ADR-410 Amendment 6). */
  readonly artworkSnapshot?: Readonly<Record<string, boolean>> | null;
  /** The machine bed, for the too-large hint (tools audit T1, T33-P3-4). */
  readonly bed?: { readonly widthMm: number; readonly heightMm: number };
  readonly onCancel: () => void;
  readonly onApply: (request: OffsetShapesRequest, prepared?: PreparedOffsetShapes) => void;
}): JSX.Element {
  const [form, setForm] = useState<OffsetShapesForm>(() => {
    const { distanceMm, ...rest } = props.initial;
    return { ...rest, distanceText: String(distanceMm) };
  });
  const request = useMemo<OffsetShapesRequest>(() => {
    const { distanceText, ...rest } = form;
    const entry = evaluateNumericEntry(distanceText, { kind: 'length' });
    return { ...rest, distanceMm: entry.kind === 'ok' ? entry.value : Number.NaN };
  }, [form]);
  const picked = useMemo(
    () => offsetShapesTargets(props.scene, props.selectedIds, form.deleteOriginals),
    [props.scene, props.selectedIds, form.deleteOriginals],
  );
  const sources = useStableObjects(picked.targets);
  const { preview, prepared } = useOffsetShapesPreview(props.scene, sources, request);
  const shown = preview.settled?.sources === sources ? preview.settled.result : null;
  const snapshot = props.artworkSnapshot ?? null;
  const choice = useOffsetResultOperation(
    props.scene,
    picked.targets,
    props.selectedIds,
    form.operationId,
    snapshot,
  );
  const lost = useNoInwardNotice(sources, shown, request);
  const canApply = prepared !== undefined || preview.unavailable !== null;
  return (
    <Dialog
      title="Offset Shapes"
      size="sm"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canApply) return;
        const chosen = choice.operation === null ? {} : { operationId: choice.operation.id };
        props.onApply({ ...request, ...chosen }, prepared);
      }}
    >
      <OffsetShapesFields
        form={form}
        onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
      />
      <ResultOperationField
        choice={choice}
        snapshot={snapshot}
        style={fieldStyle}
        onChange={(operationId) => setForm((current) => ({ ...current, operationId }))}
      />
      <OffsetShapesPreview sources={sources} result={shown?.kind === 'ok' ? shown.value : null} />
      <OffsetNotices note={picked.notice} alerts={[choice.offNotice, lost]} />
      <p role="status" aria-live="polite">
        {offsetStatus(preview, props.bed)}
      </p>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!canApply}>
          Offset
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function OffsetShapesFields(props: {
  readonly form: OffsetShapesForm;
  readonly onChange: (patch: Partial<OffsetShapesForm>) => void;
}): JSX.Element {
  const { form, onChange } = props;
  return (
    <div style={fieldsStyle}>
      <label style={fieldStyle}>
        <span>Offset distance (mm)</span>
        <input
          type="text"
          inputMode="decimal"
          className="lf-input"
          aria-label="Offset distance"
          aria-invalid={evaluateNumericEntry(form.distanceText, { kind: 'length' }).kind !== 'ok'}
          value={form.distanceText}
          title="How far the new outline sits from the selected shapes. Type arithmetic or units such as 1/8in."
          onChange={(event) => onChange({ distanceText: event.currentTarget.value })}
        />
      </label>
      <Choice
        label="Direction"
        options={DIRECTIONS}
        value={form.direction}
        onChange={(direction) => onChange({ direction })}
      />
      <Choice
        label="Corner style"
        options={CORNERS}
        value={form.cornerStyle}
        onChange={(cornerStyle) => onChange({ cornerStyle })}
      />
      <Check
        label="Outer shapes only"
        title="Ignore holes and shapes inside other shapes; offset only the outer border."
        checked={form.outerShapesOnly}
        onChange={(outerShapesOnly) => onChange({ outerShapesOnly })}
      />
      <Check
        label="Delete original objects"
        title="Remove the selected shapes once the offset is added. Undo brings them back."
        checked={form.deleteOriginals}
        onChange={(deleteOriginals) => onChange({ deleteOriginals })}
      />
    </div>
  );
}

type OffsetShapesTask = {
  readonly kind: 'offset-shapes';
  readonly options: PreparedOffsetShapes['options'];
  readonly ids: PreparedOffsetShapes['ids'];
};

function useOffsetShapesPreview(
  scene: Scene,
  sources: ReadonlyArray<VectorSceneObject>,
  request: OffsetShapesRequest,
): {
  readonly preview: VectorOpPreview<OffsetShapesTask>;
  readonly prepared: PreparedOffsetShapes | undefined;
} {
  const { outward, inward } = useMemo(() => offsetShapesResultIds(scene), [scene]);
  const { distanceMm, direction, cornerStyle, outerShapesOnly } = request;
  const task = useMemo<OffsetShapesTask>(
    () => ({
      kind: 'offset-shapes',
      options: { distanceMm, direction, cornerStyle, outerShapesOnly },
      ids: { outward, inward },
    }),
    [distanceMm, direction, cornerStyle, outerShapesOnly, outward, inward],
  );
  const preview = useVectorOpPreview(sources, task);
  const result = preview.current?.result;
  const prepared =
    result?.kind === 'ok'
      ? { sources, options: task.options, ids: task.ids, result: result.value }
      : undefined;
  return { preview, prepared };
}

function offsetStatus(
  preview: VectorOpPreview<OffsetShapesTask>,
  bed?: { readonly widthMm: number; readonly heightMm: number },
): string {
  const result = preview.current?.result;
  if (result !== undefined)
    return result.kind === 'ok'
      ? summary(result.value) + bedHint(result.value, bed)
      : result.error.message;
  if (preview.failed !== null) return `${preview.failed} Change the settings to try again.`;
  if (preview.unavailable !== null) return `${preview.unavailable} Offset still works.`;
  return 'Updating preview…';
}

function summary(result: { outward: ImportedSvg | null; inward: ImportedSvg | null }): string {
  const parts = [
    result.outward === null ? null : `outward ${size(result.outward)}`,
    result.inward === null ? null : `inward ${size(result.inward)}`,
  ].filter((part): part is string => part !== null);
  const count = parts.length === 1 ? 'one new shape' : 'two new shapes';
  return `Adds ${count}: ${parts.join(', ')}.`;
}

function bedHint(
  result: { outward: ImportedSvg | null },
  bed?: { readonly widthMm: number; readonly heightMm: number },
): string {
  const { outward } = result;
  if (bed === undefined || outward === null) return '';
  const width = outward.bounds.maxX - outward.bounds.minX;
  const height = outward.bounds.maxY - outward.bounds.minY;
  if (width <= bed.widthMm && height <= bed.heightMm) return '';
  return ` The outward offset is larger than the ${bed.widthMm} × ${bed.heightMm} mm bed.`;
}

function size(object: ImportedSvg): string {
  const width = object.bounds.maxX - object.bounds.minX;
  const height = object.bounds.maxY - object.bounds.minY;
  return `${width.toFixed(2)} × ${height.toFixed(2)} mm`;
}

function Choice<T extends string>(props: {
  readonly label: string;
  readonly options: ReadonlyArray<readonly [T, string, string]>;
  readonly value: T;
  readonly onChange: (value: T) => void;
}): JSX.Element {
  return (
    <div style={fieldStyle}>
      <span>{props.label}</span>
      <div role="group" aria-label={props.label} style={choiceStyle}>
        {props.options.map(([value, label, title]) => (
          <Button
            key={value}
            pressed={props.value === value}
            title={title}
            onClick={() => props.onChange(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Check(props: {
  readonly label: string;
  readonly title: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label style={checkStyle}>
      <input
        type="checkbox"
        title={props.title}
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      {props.label}
    </label>
  );
}

const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 10, marginBottom: 10 };
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 1fr) 190px',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const choiceStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 4,
};
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
