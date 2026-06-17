import { useMemo, useState } from 'react';
import type { GrblSettingCategory, GrblSettingRow } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { helpProps } from '../help/help-topics';

type SettingsGroup = {
  readonly id: GrblSettingCategory;
  readonly label: string;
};

const GROUPS: ReadonlyArray<SettingsGroup> = [
  { id: 'laser', label: 'Laser' },
  { id: 'motion', label: 'Motion' },
  { id: 'homing', label: 'Homing' },
  { id: 'limits', label: 'Limits' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'system', label: 'System' },
  { id: 'unknown', label: 'Unknown' },
];

export function MachineSettingsTable({
  rows,
}: {
  readonly rows: ReadonlyArray<GrblSettingRow>;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const tableHelp = helpProps('control:laser.machine-settings.table');
  const filtered = useMemo(() => filterRows(rows, query), [rows, query]);
  if (rows.length === 0) return <p style={emptyStyle}>No settings read yet.</p>;
  return (
    <div style={stackStyle}>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search settings"
        aria-label="Search controller settings"
        title="Search by setting code, value, category, unit, or description."
        style={searchStyle}
      />
      <div style={tableWrapStyle} title={tableHelp.title} data-help-id={tableHelp['data-help-id']}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Setting</th>
              <th style={cellStyle}>Value</th>
              <th style={cellStyle}>Meaning</th>
              <th style={cellStyle}>Risk</th>
              <th style={cellStyle}>Write</th>
            </tr>
          </thead>
          <tbody>{renderGroups(filtered)}</tbody>
        </table>
      </div>
    </div>
  );
}

function renderGroups(rows: ReadonlyArray<GrblSettingRow>): JSX.Element[] {
  return GROUPS.flatMap((group) => {
    const groupRows = rows.filter((row) => row.category === group.id);
    if (groupRows.length === 0) return [];
    return [
      <tr key={group.id}>
        <th colSpan={5} style={groupHeaderStyle}>
          {group.label}
        </th>
      </tr>,
      ...groupRows.map((row) => (
        <tr key={row.code}>
          <td style={cellStyle}>{row.code}</td>
          <td style={cellStyle}>
            {row.rawValue} <span style={unitStyle}>{row.unit ?? ''}</span>
          </td>
          <td style={cellStyle}>
            <strong>{row.name}</strong>
            <span style={descriptionStyle}> {row.description}</span>
          </td>
          <td style={cellStyle}>
            <RiskBadge row={row} />
          </td>
          <td style={cellStyle}>
            <SettingWriteControls row={row} />
          </td>
        </tr>
      )),
    ];
  });
}

function RiskBadge({ row }: { readonly row: GrblSettingRow }): JSX.Element {
  return <span style={riskStyle(row.writeRisk)}>{row.writeRisk}</span>;
}

function SettingWriteControls({ row }: { readonly row: GrblSettingRow }): JSX.Element {
  const writeGrblSetting = useLaserStore((state) => state.writeGrblSetting);
  const pushToast = useToastStore((state) => state.pushToast);
  const [value, setValue] = useState(row.rawValue);
  const [checked, setChecked] = useState(false);
  const [typedCommand, setTypedCommand] = useState('');
  if (row.writeRisk === 'unknown' || row.writeRisk === 'read-only' || !row.known) {
    return <span style={mutedStyle}>read-only</span>;
  }
  const command = `${row.code}=${value.trim()}`;
  return (
    <div style={writeStackStyle}>
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={`New value for ${row.code}`}
        title={`New value for ${row.code}. This does not write until the guarded Write button is pressed.`}
        style={valueInputStyle}
      />
      {row.writeRisk === 'common' ? (
        <label style={confirmStyle}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            title={`Confirm you want to write ${row.code}.`}
          />
          confirm
        </label>
      ) : (
        <input
          type="text"
          value={typedCommand}
          onChange={(event) => setTypedCommand(event.target.value)}
          placeholder={command}
          aria-label={`Type exact command ${command}`}
          title={`Type ${command} exactly to enable this machine-critical write.`}
          style={valueInputStyle}
        />
      )}
      <button
        type="button"
        title={`Write only ${row.code}, then re-read controller settings.`}
        onClick={() =>
          runWrite(writeGrblSetting, pushToast, row.id, value, {
            commonSettingChecked: checked,
            typedCommand,
          })
        }
      >
        Write
      </button>
    </div>
  );
}

function runWrite(
  writeGrblSetting: ReturnType<typeof useLaserStore.getState>['writeGrblSetting'],
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
  id: number,
  value: string,
  confirmation: Parameters<ReturnType<typeof useLaserStore.getState>['writeGrblSetting']>[2],
): void {
  void writeGrblSetting(id, value, confirmation)
    .then(() => pushToast(`Wrote $${id}; re-reading controller settings.`, 'success'))
    .catch((err: unknown) => pushToast(err instanceof Error ? err.message : String(err), 'error'));
}

function filterRows(
  rows: ReadonlyArray<GrblSettingRow>,
  query: string,
): ReadonlyArray<GrblSettingRow> {
  const needle = query.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter((row) =>
    [row.code, row.rawValue, row.name, row.description, row.category, row.unit ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
}

function riskStyle(risk: GrblSettingRow['writeRisk']): React.CSSProperties {
  const background =
    risk === 'common'
      ? 'var(--lf-success)'
      : risk === 'machine-critical'
        ? 'var(--lf-warning)'
        : 'var(--lf-text-faint)';
  return {
    display: 'inline-block',
    borderRadius: 3,
    padding: '1px 4px',
    color: 'var(--lf-on-fill)',
    background,
    fontSize: 10,
  };
}

const stackStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const searchStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };
const emptyStyle: React.CSSProperties = {
  margin: '6px 0 0',
  color: 'var(--lf-text-faint)',
  fontStyle: 'italic',
};
const tableWrapStyle: React.CSSProperties = {
  maxHeight: 260,
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
const groupHeaderStyle: React.CSSProperties = {
  ...cellStyle,
  background: 'var(--lf-bg-2)',
  position: 'sticky',
  top: 0,
};
const unitStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const descriptionStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const writeStackStyle: React.CSSProperties = { display: 'grid', gap: 3, minWidth: 100 };
const valueInputStyle: React.CSSProperties = { width: 88, boxSizing: 'border-box' };
const confirmStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 3,
  alignItems: 'center',
  color: 'var(--lf-text-muted)',
};
