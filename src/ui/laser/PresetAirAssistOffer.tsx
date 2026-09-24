// PresetAirAssistOffer — shown under Air output when a saved copy of a
// built-in preset still has air Disabled while the preset now defines an air
// command (ADR-366). One click applies the preset's air settings through the
// same update path as the rows beside it; nothing is applied on its own, so an
// operator who disabled air on purpose can ignore it.
import type { DeviceProfile } from '../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import { presetAirAssistUpdate } from '../../core/devices/preset-air-assist';
import { Row } from './device-settings-shared';

export function PresetAirAssistOffer(props: {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element | null {
  const offer = presetAirAssistUpdate(props.device);
  if (offer === null) return null;
  const { airAssistCommand, airAssistRestartUnreliable } = offer.patch;
  const settings =
    airAssistRestartUnreliable === true ? `${airAssistCommand} with Air restart` : airAssistCommand;
  return (
    <Row label="Preset air">
      <span role="note" style={noteStyle}>
        The {offer.presetName} preset uses {settings}. This saved profile has Air output Disabled,
        so jobs send no air command.
      </span>
      <button
        type="button"
        onClick={() => props.update(offer.patch)}
        aria-label="Use the preset's air settings"
        title={`Set Air output to ${settings}, as the ${offer.presetName} preset does.`}
      >
        Use preset air settings
      </button>
    </Row>
  );
}

const noteStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-muted)' };
