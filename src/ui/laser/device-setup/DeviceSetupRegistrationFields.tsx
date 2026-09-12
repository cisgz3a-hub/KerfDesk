import {
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTileRegistration,
} from '../../../core/scene';
import { NumberField } from '../../common/NumberField';
import { Row, unitStyle } from '../device-settings-shared';

export function registrationDraftFromCurrentSettings(
  machine: CncMachineConfig,
  settings: CncLayerSettings = DEFAULT_CNC_LAYER_SETTINGS,
): CncTileRegistration {
  const tool = machine.tools.find((candidate) => candidate.id === machine.toolId);
  return {
    toolId: tool?.kind === 'end-mill' ? tool.id : '',
    holeDiameterMm: tool?.diameterMm ?? DEFAULT_CNC_LAYER_SETTINGS.depthMm,
    depthMm: settings.depthMm,
    depthPerPassMm: settings.depthPerPassMm,
    feedMmPerMin: settings.feedMmPerMin,
    plungeMmPerMin: settings.plungeMmPerMin,
    spindleRpm: settings.spindleRpm,
  };
}

export function DeviceSetupRegistrationFields(props: {
  readonly machine: CncMachineConfig;
  readonly settings: CncTileRegistration | undefined;
  readonly referenceSettings?: CncLayerSettings;
  readonly onChange: (settings: CncTileRegistration) => void;
}): JSX.Element {
  const settings = props.settings;
  if (settings === undefined)
    return (
      <div style={stackStyle}>
        <p style={hintStyle}>
          Registration needs its own saved cutting plan. Start from the current default bit and
          operation values, then review the hole size, depth and feeds.
        </p>
        <button
          type="button"
          onClick={() =>
            props.onChange(
              registrationDraftFromCurrentSettings(props.machine, props.referenceSettings),
            )
          }
        >
          Configure registration
        </button>
      </div>
    );
  const edit = (patch: Partial<CncTileRegistration>): void =>
    props.onChange({ ...settings, ...patch });
  const tool = props.machine.tools.find((candidate) => candidate.id === settings.toolId);
  const supported = props.machine.tools.filter((candidate) => candidate.kind === 'end-mill');
  return (
    <fieldset style={fieldStyle}>
      <legend>Registration cutting plan</legend>
      <Row label="Cutter">
        <select
          aria-label="Registration cutter"
          value={settings.toolId}
          onChange={(event) => edit({ toolId: event.target.value })}
        >
          <option value="">Choose a flat end mill</option>
          {tool?.kind !== 'end-mill' && settings.toolId !== '' ? (
            <option value={settings.toolId}>
              Unavailable or unsupported cutter ({settings.toolId})
            </option>
          ) : null}
          {supported.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({candidate.diameterMm} mm)
            </option>
          ))}
        </select>
      </Row>
      {REGISTRATION_FIELDS.map(([key, label, unit]) => (
        <Row key={key} label={label}>
          <NumberField
            ariaLabel={label}
            value={settings[key]}
            positiveOnly
            step={0.1}
            debounceMs={0}
            onCommit={(value) => edit({ [key]: value })}
            style={{ width: 90 }}
          />
          <span style={unitStyle}>{unit}</span>
        </Row>
      ))}
      <RegistrationGuidance
        cutterTooWide={tool !== undefined && tool.diameterMm > settings.holeDiameterMm}
      />
    </fieldset>
  );
}

function RegistrationGuidance(props: { readonly cutterTooWide: boolean }): JSX.Element {
  return (
    <>
      <p style={hintStyle}>
        These values belong to registration and stay unchanged when artwork operations change. A
        matching cutter pecks; a smaller cutter clears concentric circles at each depth step. Check
        the selected cutter and feeds for your material.
      </p>
      {props.cutterTooWide ? (
        <p role="status" style={hintStyle}>
          The cutter is wider than the hole. Increase the hole diameter or choose a smaller cutter
          to produce this bore.
        </p>
      ) : null}
      <p style={hintStyle}>
        Registration and clearing run before profiles within each tile file. Earlier tile files may
        already have completed profiles; indexed export does not establish an order across
        separately run files.
      </p>
    </>
  );
}

const REGISTRATION_FIELDS = [
  ['holeDiameterMm', 'Registration hole diameter', 'mm'],
  ['depthMm', 'Registration depth', 'mm'],
  ['depthPerPassMm', 'Registration depth per pass', 'mm'],
  ['feedMmPerMin', 'Registration feed', 'mm/min'],
  ['plungeMmPerMin', 'Registration plunge', 'mm/min'],
  ['spindleRpm', 'Registration spindle speed', 'RPM'],
] as const;
const stackStyle: React.CSSProperties = { display: 'grid', gap: 6 };
const fieldStyle: React.CSSProperties = {
  ...stackStyle,
  border: '1px solid var(--lf-border)',
  padding: 8,
  minWidth: 0,
};
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.4,
};
