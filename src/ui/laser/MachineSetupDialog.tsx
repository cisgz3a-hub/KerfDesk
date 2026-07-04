import { useState } from 'react';
import { helpProps, type HelpTopicId } from '../help/help-topics';
import { Button, Dialog, DialogActions } from '../kit';
import { ControllerSettingsPanel, FirmwareWritesPanel } from './MachineSetupController';
import { CameraPanel } from './MachineSetupCamera';
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
  | 'camera'
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
    id: 'camera',
    label: 'Camera',
    helpId: 'control:laser.machine-setup.tab.camera',
  },
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

export function MachineSetupDialog(props: { readonly onClose: () => void }): JSX.Element {
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
    case 'camera':
      return <CameraPanel />;
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
