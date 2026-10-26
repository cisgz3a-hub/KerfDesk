import { useId } from 'react';
import {
  artworkOperationName,
  sceneObjectUsesOperation,
  type Layer,
  type SceneObject,
} from '../../core/scene';
import {
  effectiveObjectMinPowerPercent,
  effectiveObjectPowerPercent,
  objectPowerScalePercent,
} from '../../core/effective-output';
import { Icon } from '../kit';
import { useStore } from '../state';
import { useMixedOperationNumber } from './mixed-operation-input';
import { parseEnglishDecimalInput } from './english-decimal-input';
import { artworkOutputRuns, runUsesMinPower } from './artwork-output-runs';
import { useSettingsEditGlow } from './use-settings-edit-glow';

export function AdvancedArtworkSettings(props: {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly layers: ReadonlyArray<Layer>;
  readonly selectionActive: boolean;
}): JSX.Element {
  const setObjectsPowerScale = useStore((state) => state.setObjectsPowerScale);
  const hintId = useId();
  const scales = props.objects.map(objectPowerScalePercent);
  const value = scales.every((scale) => scale === scales[0]) ? (scales[0] ?? 100) : null;
  const input = useMixedOperationNumber({
    value: value ?? 100,
    mixed: value === null,
    reconcileKey: props.objects
      .map((object) => `${object.id}:${objectPowerScalePercent(object)}`)
      .join('|'),
    parse: (text) => objectPowerScalePercent({ powerScale: Number(text) }),
    commit: (scale) => {
      if (scale !== null)
        setObjectsPowerScale(
          props.objects.map((object) => object.id),
          scale,
        );
    },
  });
  const draftScale = parseEnglishDecimalInput(input.displayValue);
  const results = powerResults(props.objects, props.layers, draftScale);
  // The multiplier scales every operation of the selected artwork (ADR-646).
  const glow = useSettingsEditGlow({
    owner: 'artwork-power-multiplier',
    objectIds: props.objects.map((object) => object.id),
    operationIds: props.layers
      .filter((layer) => props.objects.some((object) => sceneObjectUsesOperation(object, layer)))
      .map((layer) => layer.id),
  });
  return (
    <details className="lf-artwork-disclosure">
      <summary title="Adjust power for this artwork without changing its operation settings">
        <span>
          <strong>Advanced artwork settings</strong>
        </span>
        <Icon name="chevron-down" size={16} />
      </summary>
      {/* The glow covers the editor, not the toggle: opening or closing the
          disclosure changes nothing. */}
      <div className="lf-artwork-disclosure__body" onFocus={glow.onFocus} onBlur={glow.onBlur}>
        <label style={rowStyle}>
          <span>Power multiplier</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={input.displayValue}
              {...input.inputProps}
              lang="en"
              aria-invalid={input.errorMessage === null ? undefined : true}
              onChange={input.onChange}
              onBlur={input.onBlur}
              aria-label={`Power multiplier for ${props.selectionActive ? 'selected objects' : 'inspected artwork'}`}
              aria-describedby={hintId}
              title="Multiply each artwork operation's laser power by this percentage"
              style={{ width: 84, boxSizing: 'border-box' }}
            />
            <span>%</span>
          </span>
        </label>
        <p id={hintId} style={hintStyle}>
          100% keeps the operation power unchanged. Lower values reduce power for this artwork.
          {input.errorMessage === null ? null : <span role="alert"> {input.errorMessage}</span>}
        </p>
        <ResultingArtworkPower results={results} />
      </div>
    </details>
  );
}

function ResultingArtworkPower({
  results,
}: {
  readonly results: ReturnType<typeof powerResults>;
}): JSX.Element {
  return (
    <div aria-label="Resulting artwork power" aria-live="polite" style={{ fontSize: 12 }}>
      <strong>Resulting power</strong>
      {results.length === 0 ? (
        <p style={hintStyle}>No enabled laser operation for this artwork.</p>
      ) : (
        results.map((result) => (
          <p key={result.key} style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>
            {result.name}: {percent(result.base)} × {percent(result.scale)} ={' '}
            <strong>{percent(result.power)}</strong>
            {result.image ? ' maximum' : null}
            {result.minPower === null
              ? null
              : `; ${percent(result.minPower)} grayscale minimum (white pixels off)`}
          </p>
        ))
      )}
    </div>
  );
}

function powerResults(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
  draftScale: number | null,
) {
  return objects.flatMap((object) => {
    const powerSource = draftScale === null ? object : { powerScale: draftScale };
    const prefix = objects.length > 1 ? `${artworkOperationName(object)} · ` : '';
    return artworkOutputRuns(object, layers).map(({ run: operation, effective }) => ({
      key: `${object.id}:${operation.id}`,
      name: `${prefix}${operation.name}`,
      base: effectiveObjectPowerPercent(effective, {}),
      scale: objectPowerScalePercent(powerSource),
      power: effectiveObjectPowerPercent(effective, powerSource),
      image: effective.mode === 'image',
      minPower: runUsesMinPower(effective)
        ? effectiveObjectMinPowerPercent(effective, powerSource)
        : null,
    }));
  });
}

function percent(value: number): string {
  return `${Number(value.toFixed(3))}%`;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};
const hintStyle: React.CSSProperties = {
  margin: '8px 0',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
