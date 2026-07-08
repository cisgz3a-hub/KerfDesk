import {
  GRBL_MACHINE_PROFILE_CATALOG,
  profileConfidenceLabel,
  profileSupportsCapability,
  profileWithControllerFacts,
  suggestMachineProfiles,
  type ControllerKind,
  type DeviceProfile,
  type MachineProfileCatalogEntry,
  type MachineProfileSuggestion,
} from '../../core/devices';
import { Button } from '../kit';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { DeviceSettings } from './DeviceSettings';
import {
  badgeStyle,
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
  const suggestions = suggestMachineProfiles({
    detectedControllerKind,
    detectedSettings,
    controllerSettings,
  });
  const suggestionByProfileId = new Map(
    suggestions.map((suggestion) => [suggestion.profileId, suggestion]),
  );
  const entries = hasSuggestionFacts(detectedControllerKind, detectedSettings, controllerSettings)
    ? suggestions.map((suggestion) => suggestion.entry)
    : GRBL_MACHINE_PROFILE_CATALOG;
  return (
    <div style={catalogGridStyle}>
      {entries.map((entry) => (
        <CatalogCard
          key={entry.profile.profileId ?? entry.profile.name}
          entry={entry}
          suggestion={suggestionByProfileId.get(entry.profile.profileId)}
        />
      ))}
    </div>
  );
}

function CatalogCard({
  entry,
  suggestion,
}: {
  readonly entry: MachineProfileCatalogEntry;
  readonly suggestion: MachineProfileSuggestion | undefined;
}): JSX.Element {
  const replaceDeviceProfile = useStore((s) => s.replaceDeviceProfile);
  const current = useStore((s) => s.project.device);
  const detectedSettings = useLaserStore((s) => s.detectedSettings);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const detectedControllerKind = useLaserStore((s) => s.detectedControllerKind);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const activeId = useStore((s) => s.project.device.profileId);
  const profile = entry.profile;
  const active = activeId === profile.profileId;
  const applyProfile = (): void => {
    replaceDeviceProfile(
      profileWithControllerFacts({
        profile,
        current,
        detectedSettings,
        controllerSettings,
        detectedControllerKind,
        hasControllerRead: lastSettingsReadAt !== null,
      }),
    );
  };
  return (
    <article style={cardStyle}>
      <div style={cardHeaderStyle}>
        <strong>{profile.name}</strong>
        <span style={badgeStyle}>{profileConfidenceLabel(entry.confidence)}</span>
      </div>
      <p style={mutedStyle}>
        {profile.bedWidth} x {profile.bedHeight} mm
        {profile.laserSubProfile?.opticalPowerW !== undefined
          ? `, ${profile.laserSubProfile.opticalPowerW}W`
          : ''}
      </p>
      <p style={mutedStyle}>Air-assist hardware: {airHardwareLabel(profile)}</p>
      <p style={mutedStyle}>Software air output: {airOutputLabel(profile.airAssistCommand)}</p>
      {suggestion !== undefined && suggestion.rank !== 'manual-only' ? (
        <p style={mutedStyle}>Profile match: {suggestionRankLabel(suggestion.rank)}</p>
      ) : null}
      <ul style={notesStyle}>
        {suggestion?.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
        {suggestion?.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
        {entry.reviewNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <Button variant={active ? 'default' : 'primary'} disabled={active} onClick={applyProfile}>
        {active ? 'Active profile' : `Use ${profile.name}`}
      </Button>
    </article>
  );
}

function hasSuggestionFacts(
  detectedControllerKind: ControllerKind | null,
  detectedSettings: Partial<DeviceProfile> | null,
  controllerSettings: Partial<DeviceProfile> | null,
): boolean {
  return (
    detectedControllerKind !== null ||
    hasDetectedProfilePatch(detectedSettings) ||
    hasDetectedProfilePatch(controllerSettings)
  );
}

function hasDetectedProfilePatch(source: Partial<DeviceProfile> | null): boolean {
  if (source === null) return false;
  return Object.keys(source).length > 0;
}

function airHardwareLabel(profile: DeviceProfile): string {
  return profileSupportsCapability(profile, 'air-assist') ? 'Supported' : 'Not listed';
}

function airOutputLabel(command: DeviceProfile['airAssistCommand']): string {
  return command === 'none' ? 'Disabled' : `Enabled (${command})`;
}

function suggestionRankLabel(rank: MachineProfileSuggestion['rank']): string {
  switch (rank) {
    case 'suggested':
      return 'Suggested';
    case 'possible':
      return 'Possible';
    case 'manual-only':
      return 'Manual only';
  }
}
