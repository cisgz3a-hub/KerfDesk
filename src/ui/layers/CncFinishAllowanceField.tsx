// CncFinishAllowanceField — "stock to leave" for profile cuts: the roughing
// passes stay this far proud of the wall, then one full-depth finishing pass
// cleans the true contour. An Advanced refinement, shown only for the two
// side-offset profile cut types (not pocket / on-path / relief). 0 = off.

import type { CncLayerSettings, Layer } from '../../core/scene';
import { NumberField } from './CncLayerPrimitives';

const MAX_FINISH_ALLOWANCE_MM = 10;

export function CncFinishAllowanceField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  const { cutType } = props.settings;
  if (cutType !== 'profile-outside' && cutType !== 'profile-inside') return null;
  return (
    <NumberField
      layer={props.layer}
      label="Finish allowance"
      unit="mm"
      value={props.settings.finishAllowanceMm ?? 0}
      min={0}
      max={MAX_FINISH_ALLOWANCE_MM}
      step={0.1}
      title="Stock left by the roughing passes and removed by one full-depth finishing pass at the true wall. 0 = off (no separate finishing pass)."
      onCommit={(finishAllowanceMm) => props.onCommit({ finishAllowanceMm })}
    />
  );
}
