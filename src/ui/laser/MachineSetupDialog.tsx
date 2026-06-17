import { useState } from 'react';
import {
  GRBL_MACHINE_PROFILE_CATALOG,
  type DeviceProfile,
  type MachineProfileCatalogEntry,
  type NoGoZone,
} from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
  type MachineProfileDocument,
} from '../../io/machine-profile';
import {
  importLightBurnDeviceProfile,
  type LightBurnDeviceImportReview,
} from '../../io/lightburn';
import { usePlatform } from '../app/platform-context';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { DetectedSettingsBanner } from './DetectedSettingsBanner';
import { DeviceSettings } from './DeviceSettings';
import { GrblLaserSetupPanel } from './GrblLaserSetupPanel';
import { MachineSettingsPanel } from './MachineSettingsPanel';

type SetupTab =
  | 'overview'
  | 'catalog'
  | 'controller'
  | 'firmware'
  | 'zones'
  | 'import-export';

type ImportReview =
  | { readonly kind: 'machine'; readonly document: MachineProfileDocument }
  | { readonly kind: 'lightburn'; readonly review: LightBurnDeviceImportReview }
  | { readonly kind: 'error'; readonly message: string };

const TABS: ReadonlyArray<{ readonly id: SetupTab; readonly label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'catalog', label: 'Profile Catalog' },
  { id: 'controller', label: 'Controller Settings' },
  { id: 'firmware', label: 'Firmware Writes' },
  { id: 'zones', label: 'Safety Zones' },
  { id: 'import-export', label: 'Import / Export' },
];

export function MachineSetupDialog(props: { readonly onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<SetupTab>('overview');
  return (
    <Dialog title="Machine Setup" size="xl" onClose={props.onClose}>
      <div style={layoutStyle}>
        <nav aria-label="Machine Setup sections" style={tabListStyle}>
          {TABS.map((item) => (
            <Button
              key={item.id}
              pressed={tab === item.id}
              onClick={() => setTab(item.id)}
              aria-label={item.label}
            >
              {item.label}
            </Button>
          ))}
        </nav>
        <section style={tabPanelStyle}>{renderTab(tab)}</section>
      </div>
      <DialogActions>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function renderTab(tab: SetupTab): JSX.Element {
  switch (tab) {
    case 'overview':
      return <OverviewPanel />;
    case 'catalog':
      return <ProfileCatalogPanel />;
    case 'controller':
      return <ControllerSettingsPanel />;
    case 'firmware':
      return <FirmwareWritesPanel />;
    case 'zones':
      return <SafetyZonesPanel />;
    case 'import-export':
      return <ImportExportPanel />;
  }
}

function OverviewPanel(): JSX.Element {
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

function ProfileCatalogPanel(): JSX.Element {
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

function ControllerSettingsPanel(): JSX.Element {
  return (
    <div style={stackStyle}>
      <GrblSetupSlot />
      <MachineSettingsPanel />
      <DetectedSettingsBanner />
    </div>
  );
}

function GrblSetupSlot(): JSX.Element {
  const connection = useLaserStore((s) => s.connection);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const streamer = useLaserStore((s) => s.streamer);
  const disabled = connection.kind !== 'connected' || autofocusBusy || motionOperation !== null || streamer !== null;
  return <GrblLaserSetupPanel disabled={disabled} />;
}

function FirmwareWritesPanel(): JSX.Element {
  return (
    <div style={sectionStyle}>
      <h3 style={sectionHeadingStyle}>Guarded Writes</h3>
      <p style={mutedStyle}>
        Firmware writes are limited to one setting at a time and require a current controller
        backup. Unknown settings stay read-only.
      </p>
    </div>
  );
}

function SafetyZonesPanel(): JSX.Element {
  const device = useStore((s) => s.project.device);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const zones = device.noGoZones;
  const updateZones = (noGoZones: ReadonlyArray<NoGoZone>): void => updateDeviceProfile({ noGoZones });
  return (
    <div style={stackStyle}>
      <div style={buttonRowStyle}>
        <Button onClick={() => updateZones([...zones, defaultZone(zones.length)])}>Add zone</Button>
      </div>
      {zones.length === 0 ? <p style={mutedStyle}>No safety zones configured.</p> : null}
      {zones.map((zone, index) => (
        <ZoneEditor
          key={zone.id}
          zone={zone}
          index={index}
          onChange={(next) => updateZones(zones.map((item) => (item.id === zone.id ? next : item)))}
          onRemove={() => updateZones(zones.filter((item) => item.id !== zone.id))}
        />
      ))}
    </div>
  );
}

function ZoneEditor(props: {
  readonly zone: NoGoZone;
  readonly index: number;
  readonly onChange: (zone: NoGoZone) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const { zone } = props;
  return (
    <article style={cardStyle}>
      <div style={zoneGridStyle}>
        <label>
          <span>Name</span>
          <input
            aria-label={`Safety zone ${props.index + 1} name`}
            value={zone.name}
            onChange={(event) => props.onChange({ ...zone, name: event.target.value })}
          />
        </label>
        <label>
          <span>X</span>
          <NumberField
            label={`Safety zone ${props.index + 1} x`}
            value={zone.x}
            onChange={(x) => props.onChange({ ...zone, x })}
          />
        </label>
        <label>
          <span>Y</span>
          <NumberField
            label={`Safety zone ${props.index + 1} y`}
            value={zone.y}
            onChange={(y) => props.onChange({ ...zone, y })}
          />
        </label>
        <label>
          <span>W</span>
          <NumberField
            label={`Safety zone ${props.index + 1} width`}
            value={zone.width}
            min={0.1}
            onChange={(width) => props.onChange({ ...zone, width: Math.max(0.1, width) })}
          />
        </label>
        <label>
          <span>H</span>
          <NumberField
            label={`Safety zone ${props.index + 1} height`}
            value={zone.height}
            min={0.1}
            onChange={(height) => props.onChange({ ...zone, height: Math.max(0.1, height) })}
          />
        </label>
        <label style={inlineLabelStyle}>
          <input
            type="checkbox"
            checked={zone.enabled}
            onChange={(event) => props.onChange({ ...zone, enabled: event.target.checked })}
          />
          Enabled
        </label>
        <Button variant="danger" onClick={props.onRemove}>
          Remove
        </Button>
      </div>
    </article>
  );
}

function NumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <input
      type="number"
      min={props.min ?? 0}
      step={1}
      value={props.value}
      aria-label={props.label}
      onChange={(event) => {
        const value = Number(event.target.value);
        if (Number.isFinite(value)) props.onChange(Math.max(props.min ?? 0, value));
      }}
      style={numberInputStyle}
    />
  );
}

function ImportExportPanel(): JSX.Element {
  const platform = usePlatform();
  const device = useStore((s) => s.project.device);
  const replaceDeviceProfile = useStore((s) => s.replaceDeviceProfile);
  const pushToast = useToastStore((s) => s.pushToast);
  const [review, setReview] = useState<ImportReview | null>(null);

  const exportActive = (): void => {
    void platform
      .pickFileForSave({
        suggestedName: `${slugify(device.name)}.lfmachine.json`,
        extensions: ['.lfmachine.json'],
      })
      .then((target) => {
        if (target === null) return;
        return target.write(serializeMachineProfileDocument(activeProfileDocument(device)));
      })
      .then(() => pushToast('Machine profile exported.', 'success'))
      .catch((error: unknown) => pushToast(errorMessage(error), 'error'));
  };

  const importLaserForge = (): void => {
    void platform
      .pickFilesForOpen({ accept: ['.lfmachine.json'], multiple: false })
      .then(async ([file]) => {
        if (file === undefined) return;
        const result = deserializeMachineProfileDocument(await file.text());
        if (result.kind === 'ok') setReview({ kind: 'machine', document: result.document });
        else setReview({ kind: 'error', message: importError(result) });
      })
      .catch((error: unknown) => setReview({ kind: 'error', message: errorMessage(error) }));
  };

  const importLightBurn = (): void => {
    void platform
      .pickFilesForOpen({ accept: ['.lbdev', '.lbzip'], multiple: false })
      .then(async ([file]) => {
        if (file === undefined) return;
        const result = importLightBurnDeviceProfile(await file.text(), { fileName: file.name });
        if (result.kind === 'review') setReview({ kind: 'lightburn', review: result });
        else setReview({ kind: 'error', message: result.reason });
      })
      .catch((error: unknown) => setReview({ kind: 'error', message: errorMessage(error) }));
  };

  return (
    <div style={stackStyle}>
      <div style={buttonRowStyle}>
        <Button onClick={exportActive}>Export active profile</Button>
        <Button onClick={importLaserForge}>Import LaserForge profile</Button>
        <Button onClick={importLightBurn}>Import LightBurn .lbdev</Button>
      </div>
      {review === null ? null : (
        <ImportReviewCard
          review={review}
          onApply={(profile) => {
            replaceDeviceProfile(profile);
            setReview(null);
          }}
        />
      )}
    </div>
  );
}

function ImportReviewCard(props: {
  readonly review: ImportReview;
  readonly onApply: (profile: DeviceProfile) => void;
}): JSX.Element {
  const review = props.review;
  if (review.kind === 'error') return <p role="alert" style={errorStyle}>{review.message}</p>;
  if (review.kind === 'machine') {
    return (
      <article style={cardStyle}>
        <h3 style={sectionHeadingStyle}>LaserForge profile review</h3>
        <p style={mutedStyle}>{review.document.profile.name}</p>
        <ul style={notesStyle}>
          {review.document.reviewNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <Button variant="primary" onClick={() => props.onApply(review.document.profile)}>
          Apply imported profile
        </Button>
      </article>
    );
  }
  return (
    <article style={cardStyle}>
      <h3 style={sectionHeadingStyle}>LightBurn review</h3>
      <p style={mutedStyle}>{review.review.profile.name}</p>
      <ReviewList title="Applied" items={review.review.applied} />
      <ReviewList title="Needs Review" items={review.review.needsReview} />
      <ReviewList title="Ignored" items={review.review.ignored} />
      <Button
        variant="primary"
        disabled={!review.review.canCreateProfile}
        onClick={() => props.onApply(review.review.profile)}
      >
        Apply LightBurn profile
      </Button>
    </article>
  );
}

function ReviewList(props: {
  readonly title: string;
  readonly items: ReadonlyArray<{ readonly label: string; readonly value: string }>;
}): JSX.Element | null {
  if (props.items.length === 0) return null;
  return (
    <>
      <h4 style={smallHeadingStyle}>{props.title}</h4>
      <ul style={notesStyle}>
        {props.items.map((item) => (
          <li key={`${item.label}:${item.value}`}>
            <strong>{item.label}:</strong> {item.value}
          </li>
        ))}
      </ul>
    </>
  );
}

function activeProfileDocument(profile: DeviceProfile): MachineProfileDocument {
  return {
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile,
    source: {
      kind: profile.profileSource ?? 'custom',
      label: profile.name,
      ...(profile.catalogVersion !== undefined ? { catalogVersion: profile.catalogVersion } : {}),
    },
    reviewNotes: profile.evidence?.map((item) => item.note) ?? [],
  };
}

function defaultZone(index: number): NoGoZone {
  return {
    id: `zone-${Date.now()}-${index + 1}`,
    name: `Safety zone ${index + 1}`,
    enabled: true,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
  };
}

function importError(result: Exclude<ReturnType<typeof deserializeMachineProfileDocument>, { kind: 'ok' }>): string {
  if (result.kind === 'invalid') return result.reason;
  return `Unsupported machine profile schema: ${result.sawVersion}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'machine-profile'
  );
}

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '170px minmax(0, 1fr)',
  gap: 14,
  minHeight: 520,
};
const tabListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'stretch',
};
const tabPanelStyle: React.CSSProperties = { overflow: 'auto', maxHeight: 560, paddingRight: 4 };
const stackStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 10,
  background: 'var(--lf-bg-2)',
};
const sectionHeadingStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 14 };
const smallHeadingStyle: React.CSSProperties = { margin: '8px 0 4px', fontSize: 12 };
const definitionGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px minmax(0, 1fr)',
  gap: '4px 10px',
  margin: 0,
};
const catalogGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
};
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 10,
  background: 'var(--lf-bg)',
};
const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  alignItems: 'center',
};
const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '1px 4px',
};
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', margin: '4px 0' };
const notesStyle: React.CSSProperties = { margin: '6px 0', paddingLeft: 18 };
const buttonRowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const errorStyle: React.CSSProperties = { color: 'var(--lf-danger-fg)' };
const zoneGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 1fr) repeat(4, 72px) auto auto',
  gap: 8,
  alignItems: 'end',
};
const inlineLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};
const numberInputStyle: React.CSSProperties = { width: 68 };
