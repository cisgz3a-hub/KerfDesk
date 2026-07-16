import { Fragment, useState } from 'react';
import type { GrblSettingRow } from '../../core/controllers/grbl';
import { usePlatform } from '../app/platform-context';
import { helpProps } from '../help/help-topics';
import { useStore } from '../state';
import {
  controllerOperationCommandBlockMessage,
  type LaserControllerOperation,
} from '../state/laser-controller-operation';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import { exportGrblSettingsBackup } from './export-grbl-settings-backup';
import {
  machineSettingsContextForProfile,
  machineSettingsContextNotice,
  presentGrblSetting,
  type GrblSettingPresentation,
  type MachineSettingsPresentationContext,
} from './machine-settings-presentation';

type MachineSettingsPanelProps = {
  readonly defaultOpen?: boolean;
  readonly context?: MachineSettingsPresentationContext;
};

type PresentedSettingRow = {
  readonly row: GrblSettingRow;
  readonly presentation: GrblSettingPresentation;
};

export function MachineSettingsPanel(props: MachineSettingsPanelProps = {}): JSX.Element {
  const platform = usePlatform();
  const project = useStore((s) => s.project);
  const connection = useLaserStore((s) => s.connection);
  const streamer = useLaserStore((s) => s.streamer);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const readMachineSettings = useLaserStore((s) => s.readMachineSettings);
  const pushToast = useToastStore((s) => s.pushToast);
  const context =
    props.context ?? machineSettingsContextForProfile(project.device, project.machine);
  const readDisabledReason = machineSettingsReadDisabledReason({
    connected: connection.kind === 'connected',
    activeJob: isActiveJob(streamer),
    motionOperationActive: motionOperation !== null,
    controllerOperation,
    autofocusBusy,
  });
  const exportDisabledReason =
    rows.length === 0 ? 'Read machine settings before exporting a backup.' : null;
  const panelHelp = helpProps('control:laser.machine-settings');

  const handleRead = (): void => {
    void readMachineSettings()
      .then(() => pushToast('Reading machine settings ($$)...', 'info'))
      .catch((err: unknown) => pushToast(errMsg(err), 'error'));
  };

  const handleExport = (): void => {
    void exportGrblSettingsBackup({ platform, rows }).then((result) => {
      if (result.ok) {
        pushToast(`Exported machine settings backup to ${result.displayName}`, 'success');
        return;
      }
      if (result.reason !== 'cancelled') pushToast(result.message, 'error');
    });
  };

  return (
    <details open={props.defaultOpen} style={panelStyle} {...panelHelp}>
      <summary
        style={summaryStyle}
        title={panelHelp.title}
        data-help-id={panelHelp['data-help-id']}
      >
        Read / Backup Controller Settings
      </summary>
      <MachineSettingsNotice context={context} />
      <MachineSettingsActions
        onRead={handleRead}
        onExport={handleExport}
        readDisabledReason={readDisabledReason}
        exportDisabledReason={exportDisabledReason}
      />
      {lastSettingsReadAt !== null ? (
        <div style={readAtStyle}>Last read: {new Date(lastSettingsReadAt).toLocaleString()}</div>
      ) : null}
      <SettingsTable rows={rows} context={context} />
    </details>
  );
}

function MachineSettingsActions(props: {
  readonly onRead: () => void;
  readonly onExport: () => void;
  readonly readDisabledReason: string | null;
  readonly exportDisabledReason: string | null;
}): JSX.Element {
  const readHelp = helpProps(
    'control:laser.machine-settings.read',
    props.readDisabledReason ?? undefined,
  );
  const exportHelp = helpProps(
    'control:laser.machine-settings.export',
    props.exportDisabledReason ?? undefined,
  );
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
    </div>
  );
}

function MachineSettingsNotice(props: {
  readonly context: MachineSettingsPresentationContext;
}): JSX.Element {
  return (
    <p style={noticeStyle}>
      Reads live controller settings with <code>$$</code>. Read-only in this version; export a
      backup before changing firmware.
      <br />
      {machineSettingsContextNotice(props.context)}
    </p>
  );
}

function SettingsTable(props: {
  readonly rows: ReadonlyArray<GrblSettingRow>;
  readonly context: MachineSettingsPresentationContext;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const tableHelp = helpProps('control:laser.machine-settings.table');
  const presentedRows = props.rows.map((row) => ({
    row,
    presentation: presentGrblSetting(row, props.context),
  }));
  const filteredRows = filterRows(presentedRows, search);
  if (props.rows.length === 0) {
    return <p style={emptyStyle}>No settings read yet.</p>;
  }
  return (
    <>
      <input
        type="search"
        aria-label="Search controller settings"
        title="Search controller settings by code, name, unit, category, or value."
        placeholder="Search settings"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        style={searchStyle}
      />
      {filteredRows.length === 0 ? (
        <p style={emptyStyle}>No settings match.</p>
      ) : (
        <div
          style={tableWrapStyle}
          title={tableHelp.title}
          data-help-id={tableHelp['data-help-id']}
        >
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellStyle}>Setting</th>
                <th style={cellStyle}>Value</th>
                <th style={cellStyle}>Unit</th>
                <th style={cellStyle}>Risk</th>
                <th style={cellStyle}>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {groupRows(filteredRows).map((group) => (
                <Fragment key={group.category}>
                  <tr>
                    <th colSpan={5} style={groupCellStyle}>
                      {group.rows[0]?.presentation.categoryLabel}
                    </th>
                  </tr>
                  {group.rows.map(({ row, presentation }) => (
                    <tr key={row.code}>
                      <td style={cellStyle}>{row.code}</td>
                      <td style={cellStyle}>{row.rawValue}</td>
                      <td style={cellStyle}>{presentation.unit ?? '-'}</td>
                      <td style={cellStyle}>
                        <span style={riskBadgeStyle}>{riskLabel(row.writeRisk)}</span>
                      </td>
                      <td style={cellStyle}>
                        <strong>{presentation.name}</strong>
                        <span style={descriptionStyle}> {presentation.description}</span>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const CATEGORY_ORDER = [
  'laser',
  'motion',
  'homing',
  'limits',
  'reporting',
  'system',
  'unknown',
] as const;

function filterRows(
  rows: ReadonlyArray<PresentedSettingRow>,
  search: string,
): ReadonlyArray<PresentedSettingRow> {
  const needle = search.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter(({ row, presentation }) =>
    [
      row.code,
      row.rawValue,
      presentation.name,
      presentation.unit ?? '',
      presentation.description,
      presentation.categoryLabel,
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
}

function groupRows(rows: ReadonlyArray<PresentedSettingRow>): ReadonlyArray<{
  readonly category: GrblSettingRow['category'];
  readonly rows: ReadonlyArray<PresentedSettingRow>;
}> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter(({ row }) => row.category === category),
  })).filter((group) => group.rows.length > 0);
}

function riskLabel(risk: GrblSettingRow['writeRisk']): string {
  switch (risk) {
    case 'common':
      return 'Common';
    case 'machine-critical':
      return 'Critical';
    case 'read-only':
      return 'Read-only';
    case 'unknown':
      return 'Unknown';
  }
}

function machineSettingsReadDisabledReason(state: {
  readonly connected: boolean;
  readonly activeJob: boolean;
  readonly motionOperationActive: boolean;
  readonly controllerOperation: LaserControllerOperation | null;
  readonly autofocusBusy: boolean;
}): string | null {
  if (!state.connected) return 'Connect to the controller before reading machine settings.';
  if (state.activeJob) return 'A job is active. Request ABORT before reading machine settings.';
  if (state.motionOperationActive) {
    return 'A jog or frame operation is active. Wait for it to finish before reading settings.';
  }
  const controllerOperationMessage = controllerOperationCommandBlockMessage(
    state.controllerOperation,
  );
  if (controllerOperationMessage !== null) return controllerOperationMessage;
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
const searchStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  margin: '0 0 6px',
  padding: '4px 6px',
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
const groupCellStyle: React.CSSProperties = {
  ...cellStyle,
  background: 'var(--lf-bg-2)',
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  textTransform: 'uppercase',
};
const riskBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '0 4px',
  color: 'var(--lf-text-muted)',
  whiteSpace: 'nowrap',
};
const descriptionStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
};
