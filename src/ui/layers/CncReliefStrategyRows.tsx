// Relief roughing allowance and finishing strategy rows (ADR-423): how much
// stock roughing leaves, how fine it steps on slopes (ADR-422 Amendment 1),
// which bit finishes the flats (ADR-450), whether steep walls get waterline
// passes, which way the raster runs, and,
// for layers whose cut type has no direction or ramp row of its own, whether
// the relief is climb or conventional cut and how roughing enters each level
// (ADR-424).

import type { CncCutType, CncLayerSettings, Layer } from '../../core/scene';
import { cutTypeShowsRampEntry } from '../../core/cnc/relief-ramp-field';
import { DEFAULT_RELIEF_ALLOWANCE_MM } from '../../core/relief';
import { NumberField, Row, selectStyle } from './CncLayerPrimitives';

const MAX_RELIEF_ALLOWANCE_MM = 10;
const MAX_RAMP_DEG = 45;
const MAX_FINE_STEP_MM = 10;

/** Cut types whose Cut direction row sits with the entry fields. */
export function cutTypeShowsCutDirection(cutType: CncCutType): boolean {
  return cutType === 'profile-outside' || cutType === 'profile-inside' || cutType === 'pocket';
}

type ReliefRowsProps = {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
};

export function ReliefStrategyRows(props: ReliefRowsProps): JSX.Element {
  return (
    <>
      <ReliefRoughingRows {...props} />
      <ReliefFinishRows {...props} />
      <ReliefMotionRows {...props} />
    </>
  );
}

// How much stock roughing leaves, how fine it steps down slopes, and whether
// it also finishes the flats.
function ReliefRoughingRows(props: ReliefRowsProps): JSX.Element {
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
      <NumberField
        layer={layer}
        label="Slope step"
        unit="mm"
        value={settings.reliefFineStepMm ?? 0}
        min={0}
        max={MAX_FINE_STEP_MM}
        step={0.05}
        title="Adds roughing levels this far apart between the depth-per-pass levels. They cut only the slopes between two levels, so the finishing bit meets steps no taller than this instead of a whole pass. Takes longer. 0 = off."
        onCommit={(mm) => {
          const { reliefFineStepMm: _removed, ...rest } = settings;
          props.onCommitSettings(mm > 0 ? { ...rest, reliefFineStepMm: mm } : rest);
        }}
      />
      <Row label="Flats">
        <select
          value={settings.reliefFlatFinish ?? 'finishing-bit'}
          onChange={(event) =>
            onCommit({
              reliefFlatFinish:
                event.target.value === 'roughing-bit' ? 'roughing-bit' : 'finishing-bit',
            })
          }
          aria-label={`Relief flats finished by for ${layer.color}`}
          title="Which bit finishes flat areas such as the background floor and flat tops. Roughing bit: an end mill cuts each flat to its exact height, usually on the roughing level above it, and the finishing raster skips it, so flats have no scallops and a wide background finishes much faster. Needs an end mill as the roughing bit."
          style={selectStyle}
        >
          <option value="finishing-bit">Finishing bit</option>
          <option value="roughing-bit">Roughing bit</option>
        </select>
      </Row>
    </>
  );
}

// Whether steep walls get waterline passes, and which way the raster runs.
function ReliefFinishRows(props: ReliefRowsProps): JSX.Element {
  const { layer, settings, onCommit } = props;
  return (
    <>
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
    </>
  );
}

// Cut direction and roughing ramp, for cut types without rows of their own.
function ReliefMotionRows(props: ReliefRowsProps): JSX.Element {
  const { layer, settings, onCommit } = props;
  return (
    <>
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
      {cutTypeShowsRampEntry(settings.cutType) ? null : (
        <NumberField
          layer={layer}
          label="Roughing ramp"
          unit="°"
          value={settings.rampEntryDeg ?? 0}
          min={0}
          max={MAX_RAMP_DEG}
          step={0.5}
          title="Enter each relief roughing level by descending along its first ring at this angle instead of plunging straight down. 0 = plunge."
          onCommit={(deg) => {
            const { rampEntryDeg: _removed, ...rest } = settings;
            props.onCommitSettings(deg > 0 ? { ...rest, rampEntryDeg: deg } : rest);
          }}
        />
      )}
    </>
  );
}
