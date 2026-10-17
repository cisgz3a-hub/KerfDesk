import { useState } from 'react';
import type { Layer } from '../../../core/scene';
import { NumberInput } from '../../kit';
import type { JigDraft } from './jig-editor-session';
import {
  applyJigArtworkSettings,
  jigArtworkOperations,
  type JigArtworkSettingsPatch,
} from './jig-artwork-settings';

export function JigArtworkSettings(props: {
  readonly draft: JigDraft;
  readonly onChange: (draft: JigDraft) => void;
}): JSX.Element | null {
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const operations = jigArtworkOperations(props.draft);
  const operation = operations.find((item) => item.id === requestedId) ?? operations[0];
  if (operation === undefined) return null;
  const change = (patch: JigArtworkSettingsPatch): void => {
    const next = applyJigArtworkSettings(props.draft, operation.id, patch);
    const nextOperations = jigArtworkOperations(next);
    const nextOperation =
      nextOperations.find((item) => item.id === operation.id) ??
      nextOperations.find((item) => !operations.some((previous) => previous.id === item.id));
    setRequestedId(nextOperation?.id ?? null);
    props.onChange(next);
  };
  return (
    <section className="lf-jig-fields" aria-label="Jig artwork burn settings">
      <strong>Line / Fill settings</strong>
      {operations.length > 1 && (
        <label>
          Operation
          <select
            title="Choose which artwork operation these settings change"
            className="lf-select"
            aria-label="Jig artwork operation"
            value={operation.id}
            onChange={(event) => setRequestedId(event.currentTarget.value)}
          >
            {operations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <BurnMode operation={operation} onChange={change} />
      <BurnNumericFields
        key={operation.id}
        operation={operation}
        maxFeed={props.draft.project.device.maxFeed}
        onChange={change}
      />
      {operation.mode === 'fill' && <FillOptions operation={operation} onChange={change} />}
      <p className="lf-jig-muted">
        Applies to selected artwork using this operation. Save to canvas to keep these settings.
      </p>
    </section>
  );
}

type OperationFieldsProps = {
  readonly operation: Layer;
  readonly onChange: (patch: JigArtworkSettingsPatch) => void;
};

function BurnMode({ operation, onChange }: OperationFieldsProps): JSX.Element {
  return (
    <label>
      Burn mode
      <select
        title="Burn the selected artwork as Line (outline) or Fill (scan)"
        className="lf-select"
        aria-label="Jig artwork burn mode"
        value={operation.mode}
        onChange={(event) => {
          const mode = event.currentTarget.value;
          if (mode === 'line' || mode === 'fill') onChange({ mode });
        }}
      >
        {operation.mode === 'image' && (
          <option value="image" disabled>
            Image (choose Line or Fill for vectors)
          </option>
        )}
        <option value="line">Line — trace edges</option>
        <option value="fill">Fill — engrave inside</option>
      </select>
    </label>
  );
}

function BurnNumericFields({
  operation,
  maxFeed,
  onChange,
}: OperationFieldsProps & { readonly maxFeed: number }): JSX.Element {
  return (
    <div className="lf-jig-pair">
      <BurnNumber
        label="Power (%)"
        value={operation.power}
        min={0}
        max={100}
        onCommit={(power) => onChange({ power })}
      />
      <BurnNumber
        label="Speed (mm/min)"
        value={operation.speed}
        min={1}
        max={maxFeed}
        onCommit={(speed) => onChange({ speed })}
      />
      <BurnNumber
        label="Passes"
        value={operation.passes}
        min={1}
        integer
        onCommit={(passes) => onChange({ passes })}
      />
      {operation.mode === 'fill' && (
        <>
          <BurnNumber
            label="Line interval (mm)"
            value={operation.hatchSpacingMm}
            min={0.05}
            max={10}
            onCommit={(hatchSpacingMm) => onChange({ hatchSpacingMm })}
          />
          <BurnNumber
            label="Scan angle (degrees)"
            value={operation.hatchAngleDeg}
            min={0}
            max={180}
            onCommit={(hatchAngleDeg) => onChange({ hatchAngleDeg })}
          />
        </>
      )}
    </div>
  );
}

function FillOptions({ operation, onChange }: OperationFieldsProps): JSX.Element {
  return (
    <>
      <label>
        Fill style
        <select
          title="How Fill scans the artwork"
          className="lf-select"
          aria-label="Jig fill style"
          value={operation.fillStyle}
          onChange={(event) => {
            const fillStyle = event.currentTarget.value;
            if (fillStyle === 'scanline' || fillStyle === 'offset' || fillStyle === 'island')
              onChange({ fillStyle });
          }}
        >
          <option value="scanline">Scanline</option>
          <option value="offset">Follow Shape</option>
          <option value="island">Island Fill</option>
        </select>
      </label>
      <label>
        <input
          title="Add a second fill pass at 90 degrees"
          type="checkbox"
          checked={operation.fillCrossHatch}
          onChange={(event) => onChange({ fillCrossHatch: event.currentTarget.checked })}
        />{' '}
        Cross-hatch
      </label>
      <p className="lf-jig-muted">Fill engraves closed shapes. Open traced paths need Line.</p>
    </>
  );
}

function BurnNumber(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <NumberInput
        key={props.value}
        aria-label={`Jig ${props.label}`}
        defaultValue={props.value}
        min={props.min}
        max={props.max}
        step={props.integer ? 1 : 'any'}
        onBlur={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (
            Number.isFinite(value) &&
            value >= props.min &&
            (props.max === undefined || value <= props.max) &&
            (!props.integer || Number.isInteger(value))
          ) {
            if (value !== props.value) props.onCommit(value);
          } else event.currentTarget.value = String(props.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
