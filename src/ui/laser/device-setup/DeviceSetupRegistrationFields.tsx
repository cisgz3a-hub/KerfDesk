import { useState } from 'react';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
} from '../../../core/scene';
import type { CncTileRegistration } from '../../../core/scene/machine';
import { NumberField } from '../../common/NumberField';
import { Row, unitStyle } from '../device-settings-shared';
import { CncToolPicture } from '../../machine/CncToolPicture';

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
          title="Create a separate registration cutting plan from the current default cutter and operation values, ready for review."
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
  return (
    <fieldset style={fieldStyle}>
      <legend>Registration cutting plan</legend>
      <RegistrationCutter
        tools={props.machine.tools}
        toolId={settings.toolId}
        onChange={(toolId) => edit({ toolId })}
      />
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

function RegistrationCutter(props: {
  readonly tools: ReadonlyArray<CncTool>;
  readonly toolId: string;
  readonly onChange: (toolId: string) => void;
}): JSX.Element {
  const [pictureRequested, setPictureRequested] = useState(false);
  const tool = props.tools.find((candidate) => candidate.id === props.toolId);
  const supported = props.tools.filter((candidate) => candidate.kind === 'end-mill');
  return (
    <>
      <Row label="Cutter">
        <select
          aria-label="Registration cutter"
          title="Choose the flat end mill used for registration holes. This choice stays independent of artwork operations."
          value={props.toolId}
          onChange={(event) => {
            props.onChange(event.target.value);
            setPictureRequested(true);
          }}
        >
          <option value="">Choose a flat end mill</option>
          {tool?.kind !== 'end-mill' && props.toolId !== '' ? (
            <option value={props.toolId}>Unavailable or unsupported cutter ({props.toolId})</option>
          ) : null}
          {supported.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({candidate.diameterMm} mm)
            </option>
          ))}
        </select>
      </Row>
      {tool?.kind === 'end-mill' ? (
        <CncToolPicture key={tool.id} tool={tool} initiallyOpen={pictureRequested} />
      ) : null}
    </>
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
