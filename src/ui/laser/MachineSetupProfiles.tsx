import {
  suggestMachineProfiles,
  profileConfidenceLabel,
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
  const activeId = useStore((s) => s.project.device.profileId);
  const profile = suggestion.profile;
  const isActive = activeId === profile.profileId && current === profile;
  const handleApplyProfile = (): void => {
    replaceDeviceProfile(profile);
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
      </ul>
      <CatalogApplyButton
        isActive={isActive}
        profileName={profile.name}
        onApply={handleApplyProfile}
      />
    </article>
  );
}

function CatalogApplyButton(props: {
  readonly isActive: boolean;
  readonly profileName: string;
  readonly onApply: () => void;
}): JSX.Element {
  const label = props.isActive ? 'Active profile' : `Use ${props.profileName}`;
  return (
    <Button
      variant={props.isActive ? 'default' : 'primary'}
      disabled={props.isActive}
      onClick={props.onApply}
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
