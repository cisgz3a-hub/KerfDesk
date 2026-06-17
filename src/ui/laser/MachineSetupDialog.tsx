import { useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { ControllerSettingsPanel, FirmwareWritesPanel } from './MachineSetupController';
import { ImportExportPanel } from './MachineSetupImportExport';
import { OverviewPanel, ProfileCatalogPanel } from './MachineSetupProfiles';
import { SafetyZonesPanel } from './MachineSetupSafetyZones';

type SetupTab = 'overview' | 'catalog' | 'controller' | 'firmware' | 'zones' | 'import-export';

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
