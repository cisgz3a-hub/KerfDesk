// Relief roughing allowance and finishing strategy rows (ADR-423): how much
// stock roughing leaves, whether steep walls get waterline passes, which way
// the raster runs, and — for layers whose cut type has no direction row of its
// own — whether the relief is climb or conventional cut.

import type { CncCutType, CncLayerSettings, Layer } from '../../core/scene';
import { DEFAULT_RELIEF_ALLOWANCE_MM } from '../../core/relief';
import { NumberField, Row, selectStyle } from './CncLayerPrimitives';

const MAX_RELIEF_ALLOWANCE_MM = 10;

/** Cut types whose Cut direction row sits with the entry fields. */
export function cutTypeShowsCutDirection(cutType: CncCutType): boolean {
  return cutType === 'profile-outside' || cutType === 'profile-inside' || cutType === 'pocket';
}

export function ReliefStrategyRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { layer, settings, onCommit } = props;
  const sharesProfileAllowance =
    settings.cutType === 'profile-outside' || settings.cutType === 'profile-inside';
  return (
    <>
      <NumberField
        layer={layer}
        label="Rough allowance"
        unit="mm"
        value={settings.finishAllowanceMm ?? DEFAULT_RELIEF_ALLOWANCE_MM}
        min={0}
        max={MAX_RELIEF_ALLOWANCE_MM}
        step={0.1}
        title={
          `Stock the relief roughing leaves on the surface for the finishing bit. ` +
          `${DEFAULT_RELIEF_ALLOWANCE_MM} mm when unset.` +
          (sharesProfileAllowance ? ' Shared with Finish allowance for the profile cuts.' : '')
        }
        onCommit={(finishAllowanceMm) => onCommit({ finishAllowanceMm })}
      />
      <Row label="Finish strategy">
        <select
          value={settings.reliefFinishStrategy ?? 'raster'}
          onChange={(event) =>
            onCommit({
              reliefFinishStrategy:
                event.target.value === 'raster-waterline' ? 'raster-waterline' : 'raster',
            })
          }
          aria-label={`Relief finish strategy for ${layer.color}`}
          title="Raster rows the whole surface along one axis. Raster + waterline also circles every wall steeper than 45° level by level and packs the rows closer, so steep walls are finished as finely as flats; it takes longer. A relief with a mask outline finishes with the raster only."
          style={selectStyle}
        >
          <option value="raster">Raster</option>
          <option value="raster-waterline">Raster + waterline</option>
        </select>
      </Row>
      <Row label="Raster direction">
        <select
          value={settings.reliefRasterAxis ?? 'x'}
          onChange={(event) =>
            onCommit({ reliefRasterAxis: event.target.value === 'y' ? 'y' : 'x' })
          }
          aria-label={`Relief raster direction for ${layer.color}`}
          title="Which way the finishing rows run. Rows along the grain, or along the relief's long features, usually finish cleaner."
          style={selectStyle}
        >
          <option value="x">Along X</option>
          <option value="y">Along Y</option>
        </select>
      </Row>
      {cutTypeShowsCutDirection(settings.cutType) ? null : (
        <Row label="Cut direction">
          <select
            value={settings.cutDirection ?? 'climb'}
            onChange={(event) =>
              onCommit({
                cutDirection: event.target.value === 'conventional' ? 'conventional' : 'climb',
              })
            }
            aria-label={`Relief cut direction for ${layer.color}`}
            title="Climb or conventional for the relief roughing levels and the waterline passes."
            style={selectStyle}
          >
            <option value="climb">Climb</option>
            <option value="conventional">Conventional</option>
          </select>
        </Row>
      )}
    </>
  );
}
