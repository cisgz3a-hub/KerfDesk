// Offset Shapes dialog (LightBurn gap batch 3, ADR-410). Distance, direction,
// corner style, Outer Shapes Only and Delete Originals, with a live preview and
// size readout computed by the same core call the action uses.

import { useDeferredValue, useMemo, useState } from 'react';
import {
  offsetShapes,
  type OffsetCornerStyle,
  type OffsetDirection,
} from '../../core/geometry/offset-shapes';
import type { ImportedSvg, Scene } from '../../core/scene';
import { Button, Dialog, DialogActions, NumberInput } from '../kit';
import { offsetShapesTargets, type OffsetShapesRequest } from '../state/offset-shapes-actions';
import { OffsetShapesPreview } from './OffsetShapesPreview';

export const DEFAULT_OFFSET_SHAPES_REQUEST: OffsetShapesRequest = {
  distanceMm: 1,
  direction: 'outward',
  cornerStyle: 'round',
  outerShapesOnly: false,
  deleteOriginals: false,
};

const PREVIEW_IDS = { outward: 'preview-out', inward: 'preview-in' };

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
  readonly onCancel: () => void;
  readonly onApply: (request: OffsetShapesRequest) => void;
}): JSX.Element {
  const [form, setForm] = useState<OffsetShapesForm>(() => {
    const { distanceMm, ...rest } = props.initial;
    return { ...rest, distanceText: String(distanceMm) };
  });
  const request = useMemo<OffsetShapesRequest>(() => {
    const { distanceText, ...rest } = form;
    return { ...rest, distanceMm: distanceText.trim() === '' ? Number.NaN : Number(distanceText) };
  }, [form]);
  const previewRequest = useDeferredValue(request);
  const sources = useMemo(
    () => offsetShapesTargets(props.scene, props.selectedIds),
    [props.scene, props.selectedIds],
  );
  const preview = useMemo(
    () => offsetShapes(sources, previewRequest, PREVIEW_IDS),
    [sources, previewRequest],
  );
  const result = preview.kind === 'ok' ? preview.value : null;
  return (
    <Dialog
      title="Offset Shapes"
      size="sm"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        if (result !== null) props.onApply(request);
      }}
    >
      <OffsetShapesFields
        form={form}
        onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
      />
      <OffsetShapesPreview sources={sources} result={result} />
      <p role="status" aria-live="polite">
        {preview.kind === 'ok' ? summary(preview.value) : preview.error.message}
      </p>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={result === null}>
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
        <NumberInput
          value={form.distanceText}
          min={0}
          step="any"
          title="How far the new outline sits from the selected shapes."
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

function summary(result: { outward: ImportedSvg | null; inward: ImportedSvg | null }): string {
  const parts = [
    result.outward === null ? null : `outward ${size(result.outward)}`,
    result.inward === null ? null : `inward ${size(result.inward)}`,
  ].filter((part): part is string => part !== null);
  const count = parts.length === 1 ? 'one new shape' : 'two new shapes';
  return `Adds ${count}: ${parts.join(', ')}.`;
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
