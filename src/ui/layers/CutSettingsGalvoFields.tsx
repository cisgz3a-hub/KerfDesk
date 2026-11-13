// ADR-704: a JCZ galvo operation's own Q-switch / PWM frequency and MOPA pulse
// width. Blank uses the galvo machine's default; every other controller never
// shows or reads these fields. The hidden marker tells the form reader
// (cut-settings-galvo-patch.ts) the fields were shown.

import { selectControllerDriver } from '../../core/controllers';
import {
  GALVO_FREQUENCY_MAX_KHZ,
  GALVO_FREQUENCY_MIN_KHZ,
  MOPA_PULSE_WIDTHS_NS,
} from '../../core/devices/galvo-setup';
import type { Layer } from '../../core/scene';
import { useStore } from '../state';
import { Field } from './CutSettingsInputs';

export function CutSettingsGalvoFields(props: { readonly layer: Layer }): JSX.Element | null {
  const device = useStore((state) => state.project.device);
  if (selectControllerDriver(device.controllerKind).galvoUsb === undefined) return null;
  const setup = device.galvo;
  const mopa = setup?.source === 'mopa';
  const pulseWidths = withValue(MOPA_PULSE_WIDTHS_NS, props.layer.galvoPulseWidthNs);
  return (
    <fieldset className="lf-fieldset lf-cut-settings-group">
      <legend className="lf-legend">Galvo</legend>
      <input
        type="hidden"
        name="galvoShown"
        value="1"
        title="Hidden marker that the Galvo fields were shown, used when saving cut settings."
      />
      <Field label="Frequency">
        <input
          name="galvoFrequencyKhz"
          type="number"
          className="lf-input"
          min={GALVO_FREQUENCY_MIN_KHZ}
          max={GALVO_FREQUENCY_MAX_KHZ}
          step="any"
          defaultValue={props.layer.galvoFrequencyKhz ?? ''}
          placeholder={setup === undefined ? 'machine' : String(setup.frequencyKhz)}
          style={{ width: 96 }}
          aria-label="Cut settings galvo frequency"
          title="Q-switch (fiber) or PWM (CO2/UV) frequency for this operation. Leave blank for the machine's default."
        />
        <span className="lf-field-unit">kHz</span>
      </Field>
      {mopa ? (
        <Field label="Pulse width">
          <select
            name="galvoPulseWidthNs"
            className="lf-input"
            defaultValue={String(props.layer.galvoPulseWidthNs ?? '')}
            aria-label="Cut settings galvo pulse width"
            title="MOPA pulse width for this operation. Machine default uses the galvo setup's value."
          >
            <option value="">Machine default ({setup?.pulseWidthNs ?? '—'} ns)</option>
            {pulseWidths.map((width) => (
              <option key={width} value={String(width)}>
                {width} ns
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </fieldset>
  );
}

function withValue(
  values: ReadonlyArray<number>,
  value: number | undefined,
): ReadonlyArray<number> {
  if (value === undefined || values.includes(value)) return values;
  return [...values, value].sort((a, b) => a - b);
}
