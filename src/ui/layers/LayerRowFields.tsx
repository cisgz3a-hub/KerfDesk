import type { Layer, LayerOperationSettings } from '../../core/scene';
import { useStore } from '../state';
import { genericRunwayFallbackText } from './fill-overscan-fallback';
import { LayerImageFields } from './LayerImageFields';
import { mixedCheckboxProps, useMixedOperationNumber } from './mixed-operation-input';
import type { MixedOperationFields } from './selected-operation-mixed';
import './laser-operation-settings.css';

const inputStyle: React.CSSProperties = { width: 88, minWidth: 0 };
const wideInputStyle: React.CSSProperties = { width: 100, minWidth: 0 };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
const FALLBACK_TEXT_STYLE: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

export type LayerOperationControlTarget = {
  readonly settings: LayerOperationSettings;
  readonly selectedObjectCount: number;
  readonly ariaContext?: string;
  readonly mixedFields?: MixedOperationFields;
  readonly reconcileKey?: unknown;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
};

export function LayerRowSettingsFields(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const { settings } = operationTarget;
  return (
    <>
      <section className="lf-laser-essentials" aria-label="Power, speed and passes">
        <h4 className="lf-laser-section-title">Essential settings</h4>
        <div className="lf-laser-essentials__grid">
          <FieldRow label="Power" unit="%">
            <PowerInput layer={layer} operationTarget={operationTarget} />
          </FieldRow>
          <FieldRow label="Speed" unit="mm/min">
            <SpeedInput layer={layer} operationTarget={operationTarget} />
          </FieldRow>
          <FieldRow label="Passes" unit="times">
            <PassesInput layer={layer} operationTarget={operationTarget} />
          </FieldRow>
        </div>
      </section>
      {!operationTarget.mixedFields?.mode ? (
        <details className="lf-laser-options">
          <summary title="Show extra settings for the selected laser process">
            <span>
              {settings.mode === 'line' ? 'Line' : settings.mode === 'fill' ? 'Fill' : 'Image'}{' '}
              options
            </span>
            <span className="lf-laser-help">
              {settings.mode === 'line'
                ? 'Entry motion'
                : settings.mode === 'fill'
                  ? 'Spacing & scan direction'
                  : 'Image treatment & detail'}
            </span>
          </summary>
          <div className="lf-laser-options__body">
            {settings.mode === 'line' ? (
              <>
                <p className="lf-laser-help">
                  Tune the laser-off entry before a contour on profiles that support it.
                </p>
                <FieldRow label="Contour entry">
                  <SharedRunwayInput
                    layer={layer}
                    operationTarget={operationTarget}
                    purpose="contour entry"
                  />
                  <span style={unitStyle}>mm</span>
                </FieldRow>
              </>
            ) : null}
            {settings.mode === 'fill' ? (
              <FillFields layer={layer} operationTarget={operationTarget} />
            ) : null}
            {settings.mode === 'image' ? (
              <LayerImageFields
                layer={layer}
                reconcileKey={operationTarget.reconcileKey}
                settings={settings}
                commit={operationTarget.commit}
                labelContext={operationTarget.ariaContext ?? layer.name}
                {...(operationTarget.mixedFields === undefined
                  ? {}
                  : { mixedFields: operationTarget.mixedFields })}
              />
            ) : null}
          </div>
        </details>
      ) : null}
    </>
  );
}

function FieldRow(props: {
  readonly label: string;
  readonly unit?: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="lf-laser-field">
      <span className="lf-laser-field__label">
        {props.label}
        {props.unit ? <small>{props.unit}</small> : null}
      </span>
      <span className="lf-laser-field__value">{props.children}</span>
    </label>
  );
}

function FillFields(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  return (
    <>
      <p className="lf-laser-help">
        Closer lines create a denser fill. Scan in both directions to reduce travel.
      </p>
      <FieldRow label="Scan angle">
        <HatchAngleInput layer={layer} operationTarget={operationTarget} />
        <span style={unitStyle}>deg</span>
      </FieldRow>
      <FieldRow label="Line spacing">
        <HatchSpacingInput layer={layer} operationTarget={operationTarget} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="Overscan">
        <SharedRunwayInput
          layer={layer}
          operationTarget={operationTarget}
          purpose="fill overscan"
        />
        <span style={unitStyle}>mm</span>
        {!operationTarget.mixedFields?.fillOverscanMm &&
        operationTarget.settings.fillStyle === 'scanline' &&
        operationTarget.settings.fillOverscanMm <= 0 ? (
          <span style={FALLBACK_TEXT_STYLE}>
            {genericRunwayFallbackText(operationTarget.settings.fillOverscanMm)}
          </span>
        ) : null}
      </FieldRow>
      <FieldRow label="Scan both ways">
        <BidirectionalInput layer={layer} operationTarget={operationTarget} />
      </FieldRow>
    </>
  );
}

function BidirectionalInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  return (
    <input
      type="checkbox"
      {...mixedCheckboxProps(
        operationTarget.settings.fillBidirectional,
        operationTarget.mixedFields?.fillBidirectional,
      )}
      onChange={(e) => operationTarget.commit({ fillBidirectional: e.target.checked })}
      aria-label={`Bidirectional fill for ${targetAriaContext(layer, operationTarget)}`}
      title="Scan alternating fill lines in both directions to reduce travel time."
    />
  );
}

function HatchAngleInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const debounced = useMixedOperationNumber({
    value: operationTarget.settings.hatchAngleDeg,
    mixed: operationTarget.mixedFields?.hatchAngleDeg,
    reconcileKey: operationTarget.reconcileKey,
    commit: (hatchAngleDeg) => operationTarget.commit({ hatchAngleDeg }),
    parse: (s) => clamp(numericValue(s, operationTarget.settings.hatchAngleDeg), 0, 180),
  });
  return (
    <input
      type="number"
      min={0}
      max={180}
      step={5}
      value={debounced.displayValue}
      {...debounced.inputProps}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Hatch angle for ${targetAriaContext(layer, operationTarget)}`}
      title="Fill scan angle in degrees for this layer."
    />
  );
}

function HatchSpacingInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const debounced = useMixedOperationNumber({
    value: operationTarget.settings.hatchSpacingMm,
    mixed: operationTarget.mixedFields?.hatchSpacingMm,
    reconcileKey: operationTarget.reconcileKey,
    commit: (hatchSpacingMm) => operationTarget.commit({ hatchSpacingMm }),
    parse: (s) => clamp(numericValue(s, operationTarget.settings.hatchSpacingMm), 0.05, 10),
  });
  return (
    <input
      type="number"
      min={0.05}
      max={10}
      step={0.05}
      value={debounced.displayValue}
      {...debounced.inputProps}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Hatch spacing for ${targetAriaContext(layer, operationTarget)}`}
      title="Distance between fill hatch lines. Smaller spacing engraves denser fills."
    />
  );
}

function SharedRunwayInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
  readonly purpose: 'contour entry' | 'fill overscan';
}): JSX.Element {
  const { layer, operationTarget, purpose } = props;
  const debounced = useMixedOperationNumber({
    value: operationTarget.settings.fillOverscanMm,
    mixed: operationTarget.mixedFields?.fillOverscanMm,
    reconcileKey: operationTarget.reconcileKey,
    commit: (fillOverscanMm) => operationTarget.commit({ fillOverscanMm }),
    parse: (s) => clamp(numericValue(s, operationTarget.settings.fillOverscanMm), 0, 25),
  });
  return (
    <input
      type="number"
      min={0}
      max={25}
      step={0.5}
      value={debounced.displayValue}
      {...debounced.inputProps}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`${capitalize(purpose)} for ${targetAriaContext(layer, operationTarget)}`}
      title={
        purpose === 'contour entry'
          ? 'Shared with Fill overscan. On 4040-safe, Line contours use up to 5 mm of laser-off feed-matched entry; other profiles may not apply it.'
          : 'Extra travel beyond fill edges so the laser reaches speed before firing. This stored value is also the Line contour-entry target.'
      }
    />
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function PowerInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const debounced = useMixedOperationNumber({
    value: operationTarget.settings.power,
    mixed: operationTarget.mixedFields?.power,
    reconcileKey: operationTarget.reconcileKey,
    commit: (power) =>
      operationTarget.commit({
        power,
        ...(operationTarget.selectedObjectCount > 0
          ? {}
          : { minPower: Math.min(operationTarget.settings.minPower, power) }),
      }),
    parse: (s) => clamp(numericValue(s, operationTarget.settings.power), 0, 100),
  });
  return (
    <input
      type="number"
      min={0}
      max={100}
      value={debounced.displayValue}
      {...debounced.inputProps}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Power for ${targetAriaContext(layer, operationTarget)}`}
      title="Laser power percentage for this layer."
    />
  );
}

function SpeedInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const debounced = useMixedOperationNumber({
    value: operationTarget.settings.speed,
    mixed: operationTarget.mixedFields?.speed,
    reconcileKey: operationTarget.reconcileKey,
    commit: (speed) => operationTarget.commit({ speed }),
    parse: (s) => clamp(numericValue(s, operationTarget.settings.speed), 1, maxFeed),
  });
  return (
    <input
      type="number"
      min={1}
      max={maxFeed}
      value={debounced.displayValue}
      {...debounced.inputProps}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={wideInputStyle}
      aria-label={`Speed for ${targetAriaContext(layer, operationTarget)}`}
      title="Feed rate in millimeters per minute for this layer."
    />
  );
}

function PassesInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const debounced = useMixedOperationNumber({
    value: operationTarget.settings.passes,
    mixed: operationTarget.mixedFields?.passes,
    reconcileKey: operationTarget.reconcileKey,
    commit: (passes) => operationTarget.commit({ passes }),
    parse: (s) => Math.max(1, Math.floor(numericValue(s, operationTarget.settings.passes))),
  });
  return (
    <input
      type="number"
      min={1}
      step={1}
      value={debounced.displayValue}
      {...debounced.inputProps}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Passes for ${targetAriaContext(layer, operationTarget)}`}
      title="Number of times this layer is repeated in the job."
    />
  );
}

function targetAriaContext(layer: Layer, target: LayerOperationControlTarget): string {
  return target.ariaContext ?? layer.name;
}

function numericValue(s: string, fallback: number): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
