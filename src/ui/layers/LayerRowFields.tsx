import type { Layer, LayerOperationSettings } from '../../core/scene';
import { useStore } from '../state';
import { LayerImageFields } from './LayerImageFields';
import { useDebouncedCommit } from './use-debounced-commit';

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
const fieldLabelStyle: React.CSSProperties = {
  width: 96,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const fieldValueStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flex: 1,
};
const inputStyle: React.CSSProperties = { width: 70, padding: '2px 6px' };
const wideInputStyle: React.CSSProperties = { width: 80, padding: '2px 6px' };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };

export type LayerOperationControlTarget = {
  readonly settings: LayerOperationSettings;
  readonly selectedObjectCount: number;
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
      <FieldRow label="Power">
        <PowerInput layer={layer} operationTarget={operationTarget} />
        <span style={unitStyle}>%</span>
      </FieldRow>
      <FieldRow label="Speed">
        <SpeedInput layer={layer} operationTarget={operationTarget} />
        <span style={unitStyle}>mm/min</span>
      </FieldRow>
      <FieldRow label="Passes">
        <PassesInput layer={layer} operationTarget={operationTarget} />
      </FieldRow>
      {settings.mode === 'fill' && <FillFields layer={layer} operationTarget={operationTarget} />}
      {settings.mode === 'image' && (
        <LayerImageFields layer={layer} settings={settings} commit={operationTarget.commit} />
      )}
    </>
  );
}

function FieldRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{props.label}</span>
      <div style={fieldValueStyle}>{props.children}</div>
    </div>
  );
}

function FillFields(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  return (
    <>
      <FieldRow label="Hatch angle">
        <HatchAngleInput layer={layer} operationTarget={operationTarget} />
        <span style={unitStyle}>deg</span>
      </FieldRow>
      <FieldRow label="Hatch spacing">
        <HatchSpacingInput layer={layer} operationTarget={operationTarget} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="Overscan">
        <FillOverscanInput layer={layer} operationTarget={operationTarget} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="Bidirectional">
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
      checked={operationTarget.settings.fillBidirectional}
      onChange={(e) => operationTarget.commit({ fillBidirectional: e.target.checked })}
      aria-label={`Bidirectional fill for ${layer.color}`}
      title="Scan alternating fill lines in both directions to reduce travel time."
    />
  );
}

function HatchAngleInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const debounced = useDebouncedCommit<number>({
    value: operationTarget.settings.hatchAngleDeg,
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
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Hatch angle for ${layer.color}`}
      title="Fill scan angle in degrees for this layer."
    />
  );
}

function HatchSpacingInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const debounced = useDebouncedCommit<number>({
    value: operationTarget.settings.hatchSpacingMm,
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
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Hatch spacing for ${layer.color}`}
      title="Distance between fill hatch lines. Smaller spacing engraves denser fills."
    />
  );
}

function FillOverscanInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const debounced = useDebouncedCommit<number>({
    value: operationTarget.settings.fillOverscanMm,
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
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Fill overscan for ${layer.color}`}
      title="Extra travel beyond fill edges so the laser reaches speed before firing."
    />
  );
}

function PowerInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const debounced = useDebouncedCommit<number>({
    value: operationTarget.settings.power,
    commit: (power) =>
      operationTarget.commit({
        power,
        minPower: Math.min(operationTarget.settings.minPower, power),
      }),
    parse: (s) => clamp(numericValue(s, operationTarget.settings.power), 0, 100),
  });
  return (
    <input
      type="number"
      min={0}
      max={100}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Power for ${layer.color}`}
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
  const debounced = useDebouncedCommit<number>({
    value: operationTarget.settings.speed,
    commit: (speed) => operationTarget.commit({ speed }),
    parse: (s) => clamp(numericValue(s, operationTarget.settings.speed), 1, maxFeed),
  });
  return (
    <input
      type="number"
      min={1}
      max={maxFeed}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={wideInputStyle}
      aria-label={`Speed for ${layer.color}`}
      title="Feed rate in millimeters per minute for this layer."
    />
  );
}

function PassesInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  const debounced = useDebouncedCommit<number>({
    value: operationTarget.settings.passes,
    commit: (passes) => operationTarget.commit({ passes }),
    parse: (s) => Math.max(1, Math.floor(numericValue(s, operationTarget.settings.passes))),
  });
  return (
    <input
      type="number"
      min={1}
      step={1}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Passes for ${layer.color}`}
      title="Number of times this layer is repeated in the job."
    />
  );
}

function numericValue(s: string, fallback: number): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
