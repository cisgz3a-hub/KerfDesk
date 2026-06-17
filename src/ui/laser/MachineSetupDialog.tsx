import { useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { DetectedSettingsBanner } from './DetectedSettingsBanner';
import { DeviceSettings } from './DeviceSettings';
import { GrblLaserSetupPanel } from './GrblLaserSetupPanel';
import { MachineProfileCatalogPanel } from './MachineProfileCatalogPanel';
import { MachineProfileImportExportPanel } from './MachineProfileImportExportPanel';
import { MachineProfileSuggestionPanel } from './MachineProfileSuggestionPanel';
import { MachineSettingsPanel } from './MachineSettingsPanel';
import { SafetyZonesPanel } from './SafetyZonesPanel';

type MachineSetupTab =
  | 'overview'
  | 'catalog'
  | 'controller'
  | 'firmware'
  | 'safety'
  | 'import-export';

const TABS: ReadonlyArray<{ readonly id: MachineSetupTab; readonly label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'catalog', label: 'Profile Catalog' },
  { id: 'controller', label: 'Controller Settings' },
  { id: 'firmware', label: 'Firmware Writes' },
  { id: 'safety', label: 'Safety Zones' },
  { id: 'import-export', label: 'Import / Export' },
];

export function MachineSetupDialog(props: {
  readonly onClose: () => void;
  readonly setupDisabled: boolean;
}): JSX.Element {
  const [activeTab, setActiveTab] = useState<MachineSetupTab>('overview');
  return (
    <Dialog title="Machine Setup" size="xl" onClose={props.onClose}>
      <div style={layoutStyle}>
        <nav aria-label="Machine setup sections" style={tabsStyle}>
          {TABS.map((tab) => (
            <Button
              key={tab.id}
              pressed={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
            >
              {tab.label}
            </Button>
          ))}
        </nav>
        <div style={contentStyle}>{renderTab(activeTab, props.setupDisabled)}</div>
      </div>
      <DialogActions>
        <Button onClick={props.onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function renderTab(tab: MachineSetupTab, setupDisabled: boolean): JSX.Element {
  if (tab === 'overview') {
    return (
      <div style={stackStyle}>
        <DeviceSettings />
        <MachineProfileSuggestionPanel />
        <DetectedSettingsBanner />
      </div>
    );
  }
  if (tab === 'catalog') return <MachineProfileCatalogPanel />;
  if (tab === 'controller') return <MachineSettingsPanel />;
  if (tab === 'firmware') return <GrblLaserSetupPanel disabled={setupDisabled} />;
  if (tab === 'safety') return <SafetyZonesPanel />;
  return <MachineProfileImportExportPanel />;
}

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '160px minmax(0, 1fr)',
  gap: 12,
  minHeight: 420,
};
const tabsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'stretch',
};
const contentStyle: React.CSSProperties = { minWidth: 0 };
const stackStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
