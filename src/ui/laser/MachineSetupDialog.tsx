import { useState } from 'react';
import { helpProps, type HelpTopicId } from '../help/help-topics';
import { Button, Dialog, DialogActions } from '../kit';
import { ControllerSettingsPanel, FirmwareWritesPanel } from './MachineSetupController';
import { ImportExportPanel } from './MachineSetupImportExport';
import { OverviewPanel, ProfileCatalogPanel } from './MachineSetupProfiles';
import { RasterDiagnosticsPanel } from './MachineSetupRasterDiagnostics';
import { SafetyZonesPanel } from './MachineSetupSafetyZones';

type SetupTab =
  | 'overview'
  | 'catalog'
  | 'controller'
  | 'firmware'
  | 'zones'
  | 'raster-diagnostics'
  | 'import-export';

const TABS: ReadonlyArray<{
  readonly id: SetupTab;
  readonly label: string;
  readonly helpId: HelpTopicId;
}> = [
  { id: 'overview', label: 'Overview', helpId: 'control:laser.machine-setup.tab.overview' },
  { id: 'catalog', label: 'Profile Catalog', helpId: 'control:laser.machine-setup.tab.catalog' },
  {
    id: 'controller',
    label: 'Controller Settings',
    helpId: 'control:laser.machine-setup.tab.controller',
  },
  {
    id: 'firmware',
    label: 'Firmware Writes',
    helpId: 'control:laser.machine-setup.tab.firmware',
  },
  { id: 'zones', label: 'Safety Zones', helpId: 'control:laser.machine-setup.tab.zones' },
  {
    id: 'raster-diagnostics',
    label: 'Raster Diagnostics',
    helpId: 'control:laser.machine-setup.tab.raster-diagnostics',
  },
  {
    id: 'import-export',
    label: 'Import / Export',
    helpId: 'control:laser.machine-setup.tab.import-export',
  },
];

export function MachineSetupDialog(props: {
  readonly onClose: () => void;
  // Cross-link back to the guided Device Setup wizard (ADR-092), so an
  // operator who opened this dialog on a fresh machine still finds the guided
  // path. Optional: only the Laser rail can host the wizard, so only it wires
  // this; standalone renders simply omit the row.
  readonly onRunGuidedSetup?: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<SetupTab>('overview');
  return (
    <Dialog title="Machine Setup" size="xl" onClose={props.onClose}>
      <div style={layoutStyle}>
        <nav aria-label="Machine Setup sections" style={tabListStyle}>
          {TABS.map((item) => (
            <Button
              key={item.id}
              {...helpProps(item.helpId)}
              pressed={tab === item.id}
              onClick={() => setTab(item.id)}
              aria-label={item.label}
            >
              {item.label}
            </Button>
          ))}
        </nav>
        <section style={tabPanelStyle}>
          {tab === 'overview' && props.onRunGuidedSetup !== undefined && (
            <div style={guidedSetupRowStyle}>
              <Button
                onClick={props.onRunGuidedSetup}
                {...helpProps('control:laser.device-setup.launch')}
              >
                Run guided setup
              </Button>
              <span style={guidedSetupHintStyle}>
                New machine? The wizard prefills this profile from what the controller reports.
              </span>
            </div>
          )}
          {renderTab(tab)}
        </section>
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
    case 'raster-diagnostics':
      return <RasterDiagnosticsPanel />;
    case 'import-export':
      return <ImportExportPanel />;
  }
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
const guidedSetupRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 12,
};
const guidedSetupHintStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
