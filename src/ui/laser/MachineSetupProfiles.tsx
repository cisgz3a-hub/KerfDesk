import {
  GRBL_MACHINE_PROFILE_CATALOG,
  type MachineProfileCatalogEntry,
} from '../../core/devices';
import { Button } from '../kit';
import { useStore } from '../state';
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
  const activeId = useStore((s) => s.project.device.profileId);
  const profile = entry.profile;
  const active = activeId === profile.profileId;
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
      <Button
        variant={active ? 'default' : 'primary'}
        disabled={active}
        onClick={() => replaceDeviceProfile(profile)}
      >
        {active ? 'Active profile' : `Use ${profile.name}`}
      </Button>
    </article>
  );
}
