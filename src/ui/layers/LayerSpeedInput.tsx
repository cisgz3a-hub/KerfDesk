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
import { useLengthUnit } from '../state/display-units';
import { MM_PER_INCH, type DisplayLengthUnit } from '../display-length';
import { dimensionEntry, dimensionEntryError } from './dimension-entry';
import { clamp } from '../../core/math/clamp';

// Power and speed say what they do, not just their unit (UX audit U3-P3-1).
export const LASER_POWER_TITLE =
  'Power: how hard the laser fires, as a percentage of full power. More power, or a slower speed, burns darker and deeper.';
export const LASER_SPEED_LEAD =
  'Speed: how fast the head moves while the laser fires. Slower burns darker and deeper.';

const mmPerSecFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** Vendor material guides often give speed in mm/s; show the same speed that way. */
export function mmPerSecReading(mmPerMin: number): string {
  return `${mmPerSecFormat.format(mmPerMin / 60)} mm/s`;
}

const inPerSecFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

// ADR-629: with Inches the field shows in/min to one decimal and commits the
// typed value times 25.4. The saved speed stays in mm/min, and showing it
// never writes it back (useDebouncedCommit commits only an edited draft).
type SpeedDisplay = {
  readonly unit: string;
  readonly toDisplay: (mmPerMin: number) => number;
  readonly fromDisplay: (value: number) => number;
  readonly describe: (value: number) => string;
};

function speedDisplay(unit: DisplayLengthUnit): SpeedDisplay {
  if (unit === 'mm') {
    return {
      unit: 'mm/min',
      toDisplay: (v) => v,
      fromDisplay: (v) => v,
      describe: mmPerSecReading,
    };
  }
  return {
    unit: 'in/min',
    toDisplay: (mmPerMin) => Number((mmPerMin / MM_PER_INCH).toFixed(1)),
    // A micrometre per minute absorbs the 25.4 round trip's floating-point
    // noise, so the 100 mm/min stop commits 100, not 99.99999999999999.
    fromDisplay: (inPerMin) => Math.round(inPerMin * MM_PER_INCH * 1e3) / 1e3,
    describe: (inPerMin) => `${inPerSecFormat.format(inPerMin / 60)} in/s`,
  };
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
  const unit = useLengthUnit();
  const display = speedDisplay(unit);
  const reconcileKey = useMemo(
    () => ({ target: operationTarget.reconcileKey, unit }),
    [operationTarget.reconcileKey, unit],
  );
  const value = display.toDisplay(operationTarget.settings.speed);
  const min = unit === 'in' ? 1 / MM_PER_INCH : 1;
  const max = unit === 'in' ? maxFeed / MM_PER_INCH : maxFeed;
  return (
    <OperationSliderField
      label="Speed"
      unit={display.unit}
      ariaContext={targetAriaContext(layer, operationTarget)}
      value={value}
      mixed={operationTarget.mixedFields?.speed}
      reconcileKey={reconcileKey}
      inputType="text"
      validate={(text) => dimensionEntryError(text, unit, 'feed')}
      commit={(speed) =>
        operationTarget.commit({
          speed: clamp(display.fromDisplay(speed), 1, maxFeed),
        })
      }
      parse={(text) => {
        const parsed = dimensionEntry(text, unit, 'feed');
        const mmPerMin = parsed.kind === 'ok' ? parsed.value : operationTarget.settings.speed;
        return clamp(unit === 'in' ? mmPerMin / MM_PER_INCH : mmPerMin, min, max);
      }}
      // The ceiling note compares millimetres per minute.
      observe={(raw) => {
        const typed = dimensionEntry(raw, unit, 'feed');
        ceiling.observe(typed.kind === 'ok' ? String(typed.value) : '');
      }}
      min={min}
      max={max}
      // Exact converted stops: the slider lands on the very speed the stop
      // names; only the labels and the number box round it.
      stops={display.unit === 'mm/min' ? stops : stops.map((stop) => stop / MM_PER_INCH)}
      describe={display.describe}
      title={`${LASER_SPEED_LEAD} Feed rate in ${display.unit}. The slider covers this machine's usual working speeds, ${formatFeed(range.min)} to ${formatFeed(range.max)} mm/min; type any speed up to its Output max feed, ${formatFeed(maxFeed)} mm/min (Machine Setup).`}
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

export { clamp } from '../../core/math/clamp';
