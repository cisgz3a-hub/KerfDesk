import { useState } from 'react';
import { Button } from '../kit';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { MachineSetupDialog } from './MachineSetupDialog';

export function MachineSetupEntry(props: { readonly setupDisabled: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const deviceName = useStore((s) => s.project.device.name);
  const settingsCount = useLaserStore((s) => s.grblSettingsRows.length);
  const detected = useLaserStore((s) => s.detectedSettings);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  return (
    <section style={panelStyle} aria-label="Machine setup summary">
      <div>
        <strong>Machine Setup</strong>
        <p style={summaryStyle}>
          {deviceName} - {settingsSummary(settingsCount, lastSettingsReadAt)}
          {detected === null ? '' : ' - detected changes ready'}
        </p>
      </div>
      <Button onClick={() => setOpen(true)} variant="primary">
        Machine Setup
      </Button>
      {open ? (
        <MachineSetupDialog onClose={() => setOpen(false)} setupDisabled={props.setupDisabled} />
      ) : null}
    </section>
  );
}

function settingsSummary(count: number, lastReadAt: number | null): string {
  if (lastReadAt === null) return 'controller settings not read';
  return `${count} controller settings read`;
}

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-bg-2)',
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const summaryStyle: React.CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.35,
};
