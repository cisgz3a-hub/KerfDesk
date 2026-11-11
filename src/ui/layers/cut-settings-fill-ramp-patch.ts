// ADR-699: the Ramp fields of Cut Settings → Fill detail, read back into the
// operation. Split out of cut-settings-draft.ts to keep it under the size cap.

import type { Layer, LayerMode } from '../../core/scene';
import { numberField } from './cut-settings-number-field';
import { MAX_FILL_RAMP_LENGTH_MM } from './CutSettingsFillRampFields';

type FillRampPatch = Partial<Pick<Layer, 'fillRampLengthMm' | 'fillRampOuterEdge' | 'minPower'>>;

/** Only a form showing the Ramp fields changes them. Ramp min power is the
 * operation's Min power, which a Fill reads only for its ramp. A form left
 * alone adds no ramp keys: absent means off. */
export function readFillRampPatch(
  data: FormData,
  layer: Layer,
  mode: LayerMode,
  power: number,
): FillRampPatch {
  if (mode !== 'fill' || !data.has('fillRampShown')) return {};
  const lengthMm = numberField(
    data,
    'fillRampLengthMm',
    layer.fillRampLengthMm ?? 0,
    0,
    Math.max(MAX_FILL_RAMP_LENGTH_MM, layer.fillRampLengthMm ?? 0),
  );
  const outerEdge = data.has('fillRampOuterEdge');
  return {
    ...(lengthMm === (layer.fillRampLengthMm ?? 0) ? {} : { fillRampLengthMm: lengthMm }),
    ...(outerEdge === (layer.fillRampOuterEdge === true) ? {} : { fillRampOuterEdge: outerEdge }),
    minPower: numberField(data, 'fillRampMinPower', layer.minPower, 0, power),
  };
}
