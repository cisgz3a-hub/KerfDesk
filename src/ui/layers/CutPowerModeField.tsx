import type { ControllerKind } from '../../core/devices';
import type { Layer } from '../../core/scene';

/** Present the power behaviour the selected firmware can actually express. */
export function CutPowerModeField(props: {
  readonly controllerKind: ControllerKind | undefined;
  readonly layer: Layer;
}): JSX.Element {
  if (props.controllerKind === 'marlin') {
    return (
      <p className="lf-subheading">
        Marlin power follows the requested setting on each move. Acceleration compensation is
        controlled by the firmware build, not a per-layer Constant/Dynamic switch.
      </p>
    );
  }
  if (props.controllerKind === 'ruida') {
    return (
      <p className="lf-subheading">
        Experimental Ruida export uses this layer power for both Min and Max power.
      </p>
    );
  }
  const smoothie = props.controllerKind === 'smoothieware';
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--md">Power mode</span>
      <select
        name="powerMode"
        className="lf-select"
        defaultValue={props.layer.powerMode ?? 'auto'}
        aria-label="Cut settings power mode"
        title={
          smoothie
            ? 'Constant keeps the requested power while cutting. Proportional scales it with motion speed using the Smoothieware laser module.'
            : 'Auto uses the active controller profile. Constant emits M3; Dynamic emits M4 and scales power with speed on compatible laser firmware.'
        }
      >
        <option value="auto">Auto (device default)</option>
        <option value="constant">{smoothie ? 'Constant' : 'Constant (M3)'}</option>
        <option value="dynamic">{smoothie ? 'Proportional to speed' : 'Dynamic (M4)'}</option>
      </select>
    </label>
  );
}
