import {
  GRBL_MACHINE_PROFILE_CATALOG,
  type DeviceProfile,
  type MachineProfileCatalogEntry,
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
  return (
    <div style={catalogGridStyle}>
      {GRBL_MACHINE_PROFILE_CATALOG.map((entry) => (
        <CatalogCard key={entry.profile.profileId ?? entry.profile.name} entry={entry} />
      ))}
    </div>
  );
}

function CatalogCard({ entry }: { readonly entry: MachineProfileCatalogEntry }): JSX.Element {
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
      catalogProfileWithControllerFacts({
        profile,
        current,
        detectedSettings,
        controllerSettings,
        detectedControllerKind,
        lastSettingsReadAt,
      }),
    );
  };
  return (
    <article style={cardStyle}>
      <div style={cardHeaderStyle}>
        <strong>{profile.name}</strong>
        <span style={badgeStyle}>{profile.profileSource ?? 'built-in'}</span>
      </div>
      <p style={mutedStyle}>
        {profile.bedWidth} x {profile.bedHeight} mm
        {profile.laserSubProfile?.opticalPowerW !== undefined
          ? `, ${profile.laserSubProfile.opticalPowerW}W`
          : ''}
      </p>
      <ul style={notesStyle}>
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

function catalogProfileWithControllerFacts(args: {
  readonly profile: DeviceProfile;
  readonly current: DeviceProfile;
  readonly detectedSettings: Partial<DeviceProfile> | null;
  readonly controllerSettings: Partial<DeviceProfile> | null;
  readonly detectedControllerKind: DeviceProfile['controllerKind'] | null;
  readonly lastSettingsReadAt: number | null;
}): DeviceProfile {
  const controllerRead = args.lastSettingsReadAt !== null;
  const machinePatch = {
    ...(controllerRead ? machineReportedProfilePatch(args.current) : {}),
    ...machineReportedProfilePatch(args.controllerSettings),
    ...machineReportedProfilePatch(args.detectedSettings),
  };
  const controllerKind =
    args.detectedControllerKind ?? (controllerRead ? args.current.controllerKind : undefined);
  return {
    ...args.profile,
    ...machinePatch,
    ...(controllerRead ? { framingFeedMmPerMin: args.current.framingFeedMmPerMin } : {}),
    ...(controllerKind === undefined ? {} : { controllerKind }),
  };
}

function machineReportedProfilePatch(
  source: Partial<DeviceProfile> | null,
): Partial<DeviceProfile> {
  if (source === null) return {};
  return {
    ...(source.bedWidth === undefined ? {} : { bedWidth: source.bedWidth }),
    ...(source.bedHeight === undefined ? {} : { bedHeight: source.bedHeight }),
    ...(source.maxFeed === undefined ? {} : { maxFeed: source.maxFeed }),
    ...(source.maxPowerS === undefined ? {} : { maxPowerS: source.maxPowerS }),
    ...(source.minPowerS === undefined ? {} : { minPowerS: source.minPowerS }),
    ...(source.laserModeEnabled === undefined ? {} : { laserModeEnabled: source.laserModeEnabled }),
    ...(source.accelMmPerSec2 === undefined ? {} : { accelMmPerSec2: source.accelMmPerSec2 }),
    ...(source.junctionDeviationMm === undefined
      ? {}
      : { junctionDeviationMm: source.junctionDeviationMm }),
    ...(source.zTravelMm === undefined ? {} : { zTravelMm: source.zTravelMm }),
  };
}
