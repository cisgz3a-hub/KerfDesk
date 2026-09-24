// The operation Speed field and the small parsing helpers the layer inputs
// share. Speed lives apart from the other essentials because it carries the
// Output max feed ceiling notice (feed-ceiling.tsx, controller audit speed-3).

import type { Layer } from '../../core/scene';
import type { FeedCeiling } from './feed-ceiling';
import type { LayerOperationControlTarget } from './LayerRowFields';
import { useMixedOperationNumber } from './mixed-operation-input';

const wideInputStyle: React.CSSProperties = { width: 100, minWidth: 0 };

export function SpeedInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
  readonly ceiling: FeedCeiling;
}): JSX.Element {
  const { layer, operationTarget, ceiling } = props;
  const maxFeed = ceiling.maxFeed;
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
      onChange={(event) => {
        ceiling.observe(event.target.value);
        debounced.onChange(event);
      }}
      onBlur={debounced.onBlur}
      style={wideInputStyle}
      aria-label={`Speed for ${targetAriaContext(layer, operationTarget)}`}
      title={`Feed rate in millimeters per minute for this layer. Capped at this machine's Output max feed, ${maxFeed} mm/min (Machine Setup).`}
    />
  );
}

export function targetAriaContext(layer: Layer, target: LayerOperationControlTarget): string {
  return target.ariaContext ?? layer.name;
}

export function numericValue(s: string, fallback: number): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
