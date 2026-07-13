import {
  suggestMachineProfiles,
  profileConfidenceLabel,
  profileWithControllerFactsResult,
  controllerProfilesAreCompatible,
  type MachineProfileSuggestion,
} from '../../core/devices';
import { Button } from '../kit';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { DeviceSettings } from './DeviceSettings';
import {
  badgeStyle,
  buttonRowStyle,
  cardHeaderStyle,
  cardStyle,
  catalogGridStyle,
  definitionGridStyle,
  mutedStyle,
  notesStyle,
  sectionHeadingStyle,
  sectionStyle,
  stackStyle,
} from './MachineSetupStyles';

export function OverviewPanel(): JSX.Element {
  const device = useStore((s) => s.project.device);
  const connection = useLaserStore((s) => s.connection);
  const activeControllerKind = useLaserStore((s) => s.activeControllerKind);
  const detectedControllerKind = useLaserStore((s) => s.detectedControllerKind);
  const connected = connection.kind === 'connected';
  const configuredControllerKind = device.controllerKind ?? 'grbl-v1.1';
  const mismatch =
    connected &&
    (configuredControllerKind !== activeControllerKind ||
      (detectedControllerKind !== null && detectedControllerKind !== activeControllerKind));
  return (
    <div style={stackStyle}>
      <section style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Active Profile</h3>
        <dl style={definitionGridStyle}>
          <dt>Name</dt>
          <dd>{device.name}</dd>
          <dt>Work area</dt>
          <dd>
            {device.bedWidth} x {device.bedHeight} mm
          </dd>
          <dt>Source</dt>
          <dd>{device.profileSource ?? 'custom'}</dd>
          <dt>Capabilities</dt>
          <dd>{device.capabilities?.join(', ') ?? 'GRBL'}</dd>
          <dt>Controller</dt>
          <dd>{configuredControllerKind}</dd>
          <dt>Connection</dt>
          <dd>{connected ? activeControllerKind : 'Disconnected'}</dd>
          <dt>Detected</dt>
          <dd>{detectedControllerKind ?? 'Not detected'}</dd>
          <dt>Streaming</dt>
          <dd>
            {device.streamingMode}
            {device.streamingMode === 'char-counted' ? `, ${device.rxBufferBytes} bytes` : ''}
          </dd>
        </dl>
        {mismatch ? (
          <p role="alert" style={warningStyle}>
            Controller mismatch. Apply the detected firmware profile, then disconnect and reconnect.
          </p>
        ) : null}
      </section>
      <DeviceSettings />
    </div>
  );
}

export function ProfileCatalogPanel(): JSX.Element {
  const detectedSettings = useLaserStore((s) => s.detectedSettings);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const detectedControllerKind = useLaserStore((s) => s.detectedControllerKind);
  const grblSettingsRows = useLaserStore((s) => s.grblSettingsRows);
  const suggestions = suggestMachineProfiles({
    detectedControllerKind,
    detectedProfilePatch: detectedSettings,
    controllerSettings,
    settingsRows: grblSettingsRows,
  });
  return (
    <div style={catalogGridStyle}>
      {suggestions.map((suggestion) => (
        <CatalogCard key={suggestion.profileId} suggestion={suggestion} />
      ))}
    </div>
  );
}

function CatalogCard({
  suggestion,
}: {
  readonly suggestion: MachineProfileSuggestion;
}): JSX.Element {
  const replaceDeviceProfile = useStore((s) => s.replaceDeviceProfile);
  const current = useStore((s) => s.project.device);
  const detectedSettings = useLaserStore((s) => s.detectedSettings);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const detectedControllerKind = useLaserStore((s) => s.detectedControllerKind);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const connectionKind = useLaserStore((s) => s.connection.kind);
  const activeControllerKind = useLaserStore((s) => s.activeControllerKind);
  const activeId = useStore((s) => s.project.device.profileId);
  const profile = suggestion.profile;
  const active = activeId === profile.profileId;
  const knownControllerKind =
    detectedControllerKind ??
    (connectionKind === 'connected' && lastSettingsReadAt !== null ? activeControllerKind : null);
  const controllerMismatch = !controllerProfilesAreCompatible(
    profile.controllerKind,
    knownControllerKind,
  );
  const application = profileWithControllerFactsResult({
    profile,
    current,
    detectedSettings,
    controllerSettings,
    detectedControllerKind,
    lastSettingsReadAt,
  });
  const applyProfile = (): void => {
    replaceDeviceProfile(application.profile);
  };
  return (
    <article style={cardStyle}>
      <div style={cardHeaderStyle}>
        <strong>{profile.name}</strong>
        <span style={buttonRowStyle}>
          <span style={badgeStyle}>{suggestionConfidenceLabel(suggestion.confidence)}</span>
          <span style={badgeStyle}>{profileConfidenceLabel(profile)}</span>
        </span>
      </div>
      <p style={mutedStyle}>
        {profile.bedWidth} x {profile.bedHeight} mm
        {profile.laserSubProfile?.opticalPowerW !== undefined
          ? `, ${profile.laserSubProfile.opticalPowerW}W`
          : ''}
      </p>
      <ul style={notesStyle}>
        {suggestion.entry.reviewNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
        {suggestion.reasons.slice(0, 2).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
        {suggestion.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
        {application.corrections.map((item) => (
          <li key={`${item.field}-${item.to}`}>
            Will set {item.field} to {item.to}: {item.reason}
          </li>
        ))}
      </ul>
      <CatalogApplyButton
        active={active}
        controllerMismatch={controllerMismatch}
        profileName={profile.name}
        onApply={applyProfile}
      />
    </article>
  );
}

function CatalogApplyButton(props: {
  readonly active: boolean;
  readonly controllerMismatch: boolean;
  readonly profileName: string;
  readonly onApply: () => void;
}): JSX.Element {
  const title = props.controllerMismatch
    ? 'This profile uses a different controller family than the connected firmware.'
    : undefined;
  const label = props.active
    ? 'Active profile'
    : props.controllerMismatch
      ? 'Firmware mismatch'
      : `Use ${props.profileName}`;
  return (
    <Button
      variant={props.active ? 'default' : 'primary'}
      disabled={props.active || props.controllerMismatch}
      onClick={props.onApply}
      title={title}
    >
      {label}
    </Button>
  );
}

function suggestionConfidenceLabel(confidence: MachineProfileSuggestion['confidence']): string {
  if (confidence === 'suggested') return 'Suggested match';
  if (confidence === 'possible') return 'Possible match';
  return 'Manual choice';
}

const warningStyle: React.CSSProperties = {
  margin: '8px 0 0',
  color: 'var(--lf-warning)',
  fontSize: 12,
  fontWeight: 600,
};
