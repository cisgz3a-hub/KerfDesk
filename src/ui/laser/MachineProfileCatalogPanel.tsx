import {
  duplicateProfileAsCustom,
  GRBL_MACHINE_PROFILE_CATALOG,
  type DeviceProfile,
} from '../../core/devices';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { Button } from '../kit';

export function MachineProfileCatalogPanel(): JSX.Element {
  const active = useStore((state) => state.project.device);
  const replaceDeviceProfile = useStore((state) => state.replaceDeviceProfile);
  const pushToast = useToastStore((state) => state.pushToast);
  return (
    <div style={stackStyle}>
      <section style={summaryStyle}>
        <strong>Active profile</strong>
        <div>{active.name}</div>
        <div style={mutedStyle}>{profileMeta(active)}</div>
      </section>
      {GRBL_MACHINE_PROFILE_CATALOG.map((entry) => (
        <section key={entry.profile.profileId} style={rowStyle}>
          <div>
            <strong>{entry.profile.name}</strong>
            <div style={mutedStyle}>{profileMeta(entry.profile)}</div>
            <ul style={notesStyle}>
              {entry.reviewNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
          <div style={actionsStyle}>
            <Button
              onClick={() => {
                replaceDeviceProfile(entry.profile);
                pushToast(`Active machine profile set to ${entry.profile.name}.`, 'success');
              }}
            >
              Use
            </Button>
            <Button
              onClick={() => {
                const custom = duplicateProfileAsCustom(entry.profile, {
                  profileId: `custom-${entry.profile.profileId ?? 'machine'}`,
                  name: `${entry.profile.name} Custom`,
                });
                replaceDeviceProfile(custom);
                pushToast(`Created custom profile from ${entry.profile.name}.`, 'success');
              }}
            >
              Duplicate
            </Button>
          </div>
        </section>
      ))}
    </div>
  );
}

function profileMeta(profile: DeviceProfile): string {
  const vendorModel = [profile.vendor, profile.model].filter(Boolean).join(' ');
  const dimensions = `${profile.bedWidth} x ${profile.bedHeight} mm`;
  const source = profile.profileSource ?? 'custom';
  return [vendorModel || profile.machineFamily, dimensions, source].filter(Boolean).join(' | ');
}

const stackStyle: React.CSSProperties = { display: 'grid', gap: 8 };
const summaryStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 8,
  background: 'var(--lf-bg-2)',
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 10,
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 8,
  alignItems: 'start',
};
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 6 };
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const notesStyle: React.CSSProperties = { margin: '4px 0 0', paddingLeft: 18, color: 'var(--lf-text-muted)' };
