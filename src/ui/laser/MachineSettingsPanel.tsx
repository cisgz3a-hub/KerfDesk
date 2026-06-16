import type { GrblSettingRow } from '../../core/controllers/grbl';
import { usePlatform } from '../app/platform-context';
import type { PlatformAdapter } from '../../platform/types';
import { helpProps } from '../help/help-topics';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { createMachineDiagnosticBundle } from '../state/machine-diagnostic-bundle';
import { useToastStore } from '../state/toast-store';
import { exportGrblSettingsBackup } from './export-grbl-settings-backup';
import { exportMachineDiagnosticBundle } from './export-machine-diagnostic-bundle';

type PushToast = ReturnType<typeof useToastStore.getState>['pushToast'];
type AsyncAction = () => Promise<void>;

export function MachineSettingsPanel(): JSX.Element {
  const platform = usePlatform();
  const connection = useLaserStore((s) => s.connection);
  const streamer = useLaserStore((s) => s.streamer);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const readMachineSettings = useLaserStore((s) => s.readMachineSettings);
  const runMachineDiagnostic = useLaserStore((s) => s.runMachineDiagnostic);
  const pushToast = useToastStore((s) => s.pushToast);
  const readDisabledReason = machineSettingsReadDisabledReason({
    connected: connection.kind === 'connected',
    activeJob: isActiveJob(streamer),
    motionOperationActive: motionOperation !== null,
    autofocusBusy,
  });
  const exportDisabledReason =
    rows.length === 0 ? 'Read machine settings before exporting a backup.' : null;
  const panelHelp = helpProps('control:laser.machine-settings');

  return (
    <details style={panelStyle} {...panelHelp}>
      <summary
        style={summaryStyle}
        title={panelHelp.title}
        data-help-id={panelHelp['data-help-id']}
      >
        Read / Backup Controller Settings
      </summary>
      <MachineSettingsNotice />
      <MachineSettingsButtons
        readDisabledReason={readDisabledReason}
        exportDisabledReason={exportDisabledReason}
        onRead={() => runRead(readMachineSettings, pushToast)}
        onExport={() => runSettingsExport(platform, rows, pushToast)}
        onDiagnostic={() => runDiagnostic(runMachineDiagnostic, pushToast)}
        onExportDiagnostic={() => runDiagnosticExport(platform, pushToast)}
      />
      {lastSettingsReadAt !== null ? (
        <div style={readAtStyle}>Last read: {new Date(lastSettingsReadAt).toLocaleString()}</div>
      ) : null}
      <SettingsTable rows={rows} />
    </details>
  );
}

function MachineSettingsButtons(props: {
  readonly readDisabledReason: string | null;
  readonly exportDisabledReason: string | null;
  readonly onRead: () => void;
  readonly onExport: () => void;
  readonly onDiagnostic: () => void;
  readonly onExportDiagnostic: () => void;
}): JSX.Element {
  const readHelp = helpProps(
    'control:laser.machine-settings.read',
    props.readDisabledReason ?? undefined,
  );
  const exportHelp = helpProps(
    'control:laser.machine-settings.export',
    props.exportDisabledReason ?? undefined,
  );
  const diagnosticHelp = helpProps(
    'control:laser.machine-settings.diagnostic',
    props.readDisabledReason ?? undefined,
  );
  const diagnosticExportHelp = helpProps('control:laser.machine-settings.export-diagnostic');
  return (
    <div style={buttonRowStyle}>
      <button
        type="button"
        onClick={props.onRead}
        disabled={props.readDisabledReason !== null}
        title={readHelp.title}
        data-help-id={readHelp['data-help-id']}
      >
        Read ($$)
      </button>
      <button
        type="button"
        onClick={props.onExport}
        disabled={props.exportDisabledReason !== null}
        title={exportHelp.title}
        data-help-id={exportHelp['data-help-id']}
      >
        Export backup
      </button>
      <button
        type="button"
        onClick={props.onDiagnostic}
        disabled={props.readDisabledReason !== null}
        title={diagnosticHelp.title}
        data-help-id={diagnosticHelp['data-help-id']}
      >
        Run diagnostic
      </button>
      <button
        type="button"
        onClick={props.onExportDiagnostic}
        title={diagnosticExportHelp.title}
        data-help-id={diagnosticExportHelp['data-help-id']}
      >
        Export diagnostic
      </button>
    </div>
  );
}

function runRead(readMachineSettings: AsyncAction, pushToast: PushToast): void {
  void readMachineSettings()
    .then(() => pushToast('Reading machine settings ($$)...', 'info'))
    .catch((err: unknown) => pushToast(errMsg(err), 'error'));
}

function runSettingsExport(
  platform: PlatformAdapter,
  rows: ReadonlyArray<GrblSettingRow>,
  pushToast: PushToast,
): void {
  void exportGrblSettingsBackup({ platform, rows }).then((result) => {
    if (result.ok) {
      pushToast(`Exported machine settings backup to ${result.displayName}`, 'success');
      return;
    }
    if (result.reason !== 'cancelled') pushToast(result.message, 'error');
  });
}

function runDiagnostic(runMachineDiagnostic: AsyncAction, pushToast: PushToast): void {
  void runMachineDiagnostic()
    .then(() => pushToast('Running machine diagnostic probes...', 'info'))
    .catch((err: unknown) => pushToast(errMsg(err), 'error'));
}

function runDiagnosticExport(platform: PlatformAdapter, pushToast: PushToast): void {
  const laser = useLaserStore.getState();
  const bundle = createMachineDiagnosticBundle({
    profile: useStore.getState().project.device,
    controllerSettings: laser.controllerSettings,
    grblSettingsRows: laser.grblSettingsRows,
    statusReport: laser.statusReport,
    wcoCache: laser.wcoCache,
    workOriginActive: laser.workOriginActive,
    streamer: laser.streamer,
    transcript: laser.transcript,
  });
  void exportMachineDiagnosticBundle({ platform, bundle }).then((result) => {
    if (result.ok) {
      pushToast(`Exported machine diagnostic to ${result.displayName}`, 'success');
      return;
    }
    if (result.reason !== 'cancelled') pushToast(result.message, 'error');
  });
}

function MachineSettingsNotice(): JSX.Element {
  return (
    <p style={noticeStyle}>
      Reads live controller settings with <code>$$</code> and read-only diagnostic probes. Export a
      backup before changing firmware.
    </p>
  );
}

function SettingsTable({ rows }: { readonly rows: ReadonlyArray<GrblSettingRow> }): JSX.Element {
  const tableHelp = helpProps('control:laser.machine-settings.table');
  if (rows.length === 0) {
    return <p style={emptyStyle}>No settings read yet.</p>;
  }
  return (
    <div style={tableWrapStyle} title={tableHelp.title} data-help-id={tableHelp['data-help-id']}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Setting</th>
            <th style={cellStyle}>Value</th>
            <th style={cellStyle}>Unit</th>
            <th style={cellStyle}>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <td style={cellStyle}>{row.code}</td>
              <td style={cellStyle}>{row.rawValue}</td>
              <td style={cellStyle}>{row.unit ?? '-'}</td>
              <td style={cellStyle}>
                <strong>{row.name}</strong>
                <span style={descriptionStyle}> {row.description}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function machineSettingsReadDisabledReason(state: {
  readonly connected: boolean;
  readonly activeJob: boolean;
  readonly motionOperationActive: boolean;
  readonly autofocusBusy: boolean;
}): string | null {
  if (!state.connected) return 'Connect to the laser before reading machine settings.';
  if (state.activeJob) return 'A job is active. Press Stop before reading machine settings.';
  if (state.motionOperationActive) {
    return 'A jog or frame operation is active. Wait for it to finish before reading settings.';
  }
  if (state.autofocusBusy) {
    return 'Auto-focus is active. Wait for it to finish before reading settings.';
  }
  return null;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-bg-input)',
  padding: 6,
};
const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontWeight: 700,
};
const noticeStyle: React.CSSProperties = {
  margin: '6px 0',
  color: 'var(--lf-text-muted)',
  lineHeight: 1.35,
};
const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  marginBottom: 6,
};
const readAtStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 11,
  marginBottom: 4,
};
const emptyStyle: React.CSSProperties = {
  margin: '6px 0 0',
  color: 'var(--lf-text-faint)',
  fontStyle: 'italic',
};
const tableWrapStyle: React.CSSProperties = {
  maxHeight: 180,
  overflow: 'auto',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg)',
};
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11,
};
const cellStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--lf-border)',
  padding: '3px 4px',
  textAlign: 'left',
  verticalAlign: 'top',
};
const descriptionStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
};
