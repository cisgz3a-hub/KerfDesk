// The operation Speed field and the small parsing helpers the layer inputs
// share. Speed lives apart from the other essentials because it carries the
// Output max feed ceiling notice (feed-ceiling.tsx, controller audit speed-3).

import { useMemo } from 'react';
import { speedSliderRange, speedSliderStops } from '../../core/devices/working-speed-range';
import type { Layer } from '../../core/scene';
import { useStore } from '../state';
import { formatFeed, type FeedCeiling } from './feed-ceiling';
import type { LayerOperationControlTarget } from './LayerRowFields';
import { OperationSliderField } from './OperationSliderField';

const mmPerSecFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** Vendor material guides often give speed in mm/s; show the same speed that way. */
export function mmPerSecReading(mmPerMin: number): string {
  return `${mmPerSecFormat.format(mmPerMin / 60)} mm/s`;
}

export function SpeedInput(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
  readonly ceiling: FeedCeiling;
}): JSX.Element {
  const { layer, operationTarget, ceiling } = props;
  const maxFeed = ceiling.maxFeed;
  const profileId = useStore((state) => state.project.device.profileId);
  const laserSubProfile = useStore((state) => state.project.device.laserSubProfile);
  // Slider over this machine's working speeds (ADR-615); typing still reaches maxFeed.
  const range = useMemo(
    () => speedSliderRange({ profileId, laserSubProfile, maxFeed }),
    [profileId, laserSubProfile, maxFeed],
  );
  const stops = useMemo(() => speedSliderStops(range), [range]);
  return (
    <OperationSliderField
      label="Speed"
      unit="mm/min"
      ariaContext={targetAriaContext(layer, operationTarget)}
      value={operationTarget.settings.speed}
      mixed={operationTarget.mixedFields?.speed}
      reconcileKey={operationTarget.reconcileKey}
      commit={(speed) => operationTarget.commit({ speed })}
      parse={(s) => clamp(numericValue(s, operationTarget.settings.speed), 1, maxFeed)}
      observe={ceiling.observe}
      min={1}
      max={maxFeed}
      stops={stops}
      describe={mmPerSecReading}
      title={`Feed rate in millimeters per minute for this layer. The slider covers this machine's usual working speeds, ${formatFeed(range.min)} to ${formatFeed(range.max)} mm/min; type any speed up to its Output max feed, ${formatFeed(maxFeed)} mm/min (Machine Setup).`}
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
