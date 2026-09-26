// PresetCorrectionOffer — shown in Machine Setup when this profile is a copy of
// a built-in preset saved before the preset was corrected (ADR-322 Amendments 1
// and 2). One click applies the preset's corrected values through the same
// update path as the rows beside it. Nothing is applied on its own: a value the
// operator chose is never matched as stale, and one they want to keep can stay.
import type { DeviceProfile } from '../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import { stalePresetCorrections } from '../../core/devices/preset-corrections';
import { Row } from './device-settings-shared';

export function PresetCorrectionOffer(props: {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element | null {
  const corrections = stalePresetCorrections(props.device);
  if (corrections.length === 0) return null;
  return (
    <>
      {corrections.map((correction) => (
        <Row key={correction.now} label="Preset correction">
          <span role="note" style={noteStyle}>
            The {correction.presetName} preset was corrected to {correction.now}. This saved profile
            still has {correction.before}, so {correction.effect}.
          </span>
          <button
            type="button"
            onClick={() => props.update(correction.patch)}
            aria-label={`Use the corrected ${correction.now}`}
            title={`Set this profile to ${correction.now}, as the ${correction.presetName} preset now does.`}
          >
            Use {correction.now}
          </button>
        </Row>
      ))}
    </>
  );
}

const noteStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-muted)' };
