import { useState } from 'react';
import {
  buildSelectionTransformEdit,
  isRegistrationBox,
  selectionMetrics,
  type Project,
  type SelectionTransformEdit,
} from '../../../core/scene';
import { Button, IconButton, NumberInput } from '../../kit';
import { jigEditableSelection, withJigTransforms } from './jig-canvas-selection';

/**
 * The selection's position, size and rotation, on a bar above the jig canvas
 * that shows only while something is selected (ADR-638). Selected artwork can
 * be centred on every piece again after it was moved.
 */
export function JigSelectionBar(props: {
  readonly project: Project;
  readonly selectedIds: ReadonlySet<string>;
  readonly outlineCount: number;
  readonly disabled: boolean;
  readonly onCommit: (project: Project) => void;
  readonly onCentre: () => void;
}): JSX.Element | null {
  const [preserveAspect, setPreserveAspect] = useState(true);
  const [error, setError] = useState('');
  const objects = jigEditableSelection(props.project, props.selectedIds);
  const metrics = selectionMetrics(objects);
  if (metrics === null) return null;
  const edit = (value: SelectionTransformEdit): void => {
    const result = buildSelectionTransformEdit(objects, value);
    if (result.kind === 'error') {
      setError('This selection cannot use that size. Keep proportions locked for rotated artwork.');
      return;
    }
    setError('');
    props.onCommit(withJigTransforms(props.project, result.transforms));
  };
  const hasArtwork = objects.some((object) => !isRegistrationBox(object));
  return (
    <fieldset
      aria-label="Jig selection properties"
      className="lf-jig-selection-bar"
      disabled={props.disabled}
    >
      <strong>{metrics.count} selected</strong>
      <JigNumber
        label="X (mm)"
        value={metrics.bbox.minX}
        onCommit={(x) => edit({ kind: 'position', anchor: 'nw', x })}
      />
      <JigNumber
        label="Y (mm)"
        value={metrics.bbox.minY}
        onCommit={(y) => edit({ kind: 'position', anchor: 'nw', y })}
      />
      <JigNumber
        label="Width (mm)"
        value={metrics.width}
        min={0.001}
        onCommit={(width) => edit({ kind: 'resize', anchor: 'c', width, preserveAspect })}
      />
      <JigNumber
        label="Height (mm)"
        value={metrics.height}
        min={0.001}
        onCommit={(height) => edit({ kind: 'resize', anchor: 'c', height, preserveAspect })}
      />
      <ProportionsLock
        locked={preserveAspect}
        onToggle={() => setPreserveAspect((current) => !current)}
      />
      {metrics.rotationDeg !== null && (
        <JigNumber
          label="Rotation (degrees)"
          value={metrics.rotationDeg}
          onCommit={(rotationDeg) => edit({ kind: 'rotate', rotationDeg })}
        />
      )}
      {hasArtwork && props.outlineCount > 0 && (
        <JigCentreButton outlineCount={props.outlineCount} onCentre={props.onCentre} />
      )}
      {error !== '' && <p role="alert">{error}</p>}
    </fieldset>
  );
}

function JigCentreButton(props: {
  readonly outlineCount: number;
  readonly onCentre: () => void;
}): JSX.Element {
  const every = props.outlineCount > 1;
  return (
    <Button
      title={
        every
          ? 'Fit the selected artwork into the first piece and copy it onto every piece'
          : 'Fit the selected artwork into the outline'
      }
      onClick={props.onCentre}
    >
      {every ? 'Centre on every piece' : 'Centre in outline'}
    </Button>
  );
}

function JigNumber(props: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <NumberInput
        key={props.value}
        aria-label={props.label}
        defaultValue={Number(props.value.toFixed(3))}
        min={props.min}
        step="any"
        onBlur={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (
            Number.isFinite(value) &&
            value !== Number(props.value.toFixed(3)) &&
            (props.min === undefined || value >= props.min)
          )
            props.onCommit(value);
          else event.currentTarget.value = String(Number(props.value.toFixed(3)));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function ProportionsLock(props: {
  readonly locked: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <IconButton
      icon={props.locked ? 'lock' : 'unlock'}
      label="Keep proportions"
      title={
        props.locked
          ? 'Proportions kept: changing width or height changes the other. Click to set them separately.'
          : 'Width and height are set separately. Click to keep the proportions.'
      }
      pressed={props.locked}
      size="sm"
      onClick={props.onToggle}
    />
  );
}
