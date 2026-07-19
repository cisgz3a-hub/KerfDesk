import type { GrblSettingRow } from '../../../core/controllers/grbl';
import type { DeviceProfile } from '../../../core/devices';
import type { MachineConfig } from '../../../core/scene';
import {
  fillRunwayPolicyForDevice,
  shouldAdvise4040FillPolicySelection,
} from '../../../core/job/fill-runway-policy';
import {
  buildSuperConsoleSettingsDiagnostics,
  type SuperConsoleDiagnosticSection,
  type SuperConsoleDiagnosticStatus,
  type SuperConsoleSettingDiagnostic,
} from './super-console-settings-diagnostics';

export function SuperConsoleDiagnostics(props: {
  readonly profile: DeviceProfile;
  readonly machine: MachineConfig | undefined;
  readonly rows: ReadonlyArray<GrblSettingRow>;
}): JSX.Element {
  const diagnostics = buildSuperConsoleSettingsDiagnostics(props.profile, props.rows, {
    ...(props.machine === undefined ? {} : { machine: props.machine }),
  });
  const fillPolicyActive = fillRunwayPolicyForDevice(props.profile) !== undefined;
  const fillPolicyNeedsReview = shouldAdvise4040FillPolicySelection(props.profile);

  return (
    <section aria-label="Controller diagnostics" style={panelStyle}>
      <div style={headingRowStyle}>
        <strong>Motion &amp; output diagnostics</strong>
        <span style={readOnlyBadgeStyle}>Read-only</span>
      </div>
      <p style={noticeStyle}>
        Selected software profile: <strong>{props.profile.name}</strong>. Profile references are
        context for investigation; they do not identify the attached hardware and a difference is
        not automatically wrong.
      </p>
      {fillPolicyActive ? (
        <p role="status" style={policyActiveStyle}>
          4040 fill-quality policy active: Scanline Fill uses feed-matched laser-off entries.
        </p>
      ) : fillPolicyNeedsReview ? (
        <p role="alert" style={policyWarningStyle}>
          4040 fill-quality policy inactive. Controller settings and a 400 x 400 work area do not
          identify the attached machine. If this is a Neotronics 4040, open Machine Setup, choose
          the Neotronics 4040 profile, review it, and Save before the next Scanline Fill.
        </p>
      ) : null}
      {diagnostics.length === 0 ? (
        <p style={emptyStyle}>Diagnostics appear after the controller returns a settings dump.</p>
      ) : (
        SECTION_ORDER.map((section) => {
          const sectionRows = diagnostics.filter((row) => row.section === section);
          return sectionRows.length === 0 ? null : (
            <DiagnosticSection key={section} section={section} rows={sectionRows} />
          );
        })
      )}
      <p style={safetyNoteStyle}>
        No value on this card is written to firmware. Physical quality still requires a controlled
        scrap test and a mechanical inspection.
      </p>
    </section>
  );
}

function DiagnosticSection(props: {
  readonly section: SuperConsoleDiagnosticSection;
  readonly rows: ReadonlyArray<SuperConsoleSettingDiagnostic>;
}): JSX.Element {
  return (
    <details open style={sectionStyle}>
      <summary
        style={summaryStyle}
        title={`Expand or collapse ${SECTION_LABELS[props.section].toLowerCase()} diagnostics.`}
      >
        {SECTION_LABELS[props.section]}
      </summary>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Setting</th>
              <th style={cellStyle}>Controller</th>
              <th style={cellStyle}>Profile context</th>
              <th style={cellStyle}>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.code}>
                <td style={cellStyle}>
                  <strong>{row.code}</strong> {row.label}
                </td>
                <td style={valueCellStyle}>
                  {row.current}
                  {row.unit === null ? '' : ` ${row.unit}`}
                </td>
                <td style={cellStyle}>
                  {row.reference === null ? (
                    <span style={mutedStyle}>Not represented in the profile</span>
                  ) : (
                    <>
                      <strong>{row.reference}</strong>
                      <span style={contextLabelStyle}>{row.referenceLabel}</span>
                    </>
                  )}
                </td>
                <td style={cellStyle}>
                  <span style={statusStyle(row.status)}>{statusLabel(row.status)}</span>
                  <span style={noteStyle}>{row.note}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function statusLabel(status: SuperConsoleDiagnosticStatus): string {
  switch (status) {
    case 'matches-contract':
      return 'Matches active output contract';
    case 'differs-from-contract':
      return 'Differs from active output contract';
    case 'same-as-reference':
      return 'Same as profile reference';
    case 'different-from-reference':
      return 'Different from profile reference (informational)';
    case 'live-only':
      return 'Live controller value';
    case 'not-comparable':
      return 'Could not compare numeric values';
  }
}

function statusStyle(status: SuperConsoleDiagnosticStatus): React.CSSProperties {
  if (status === 'differs-from-contract') return dangerStatusStyle;
  if (status === 'matches-contract') return successStatusStyle;
  return neutralStatusStyle;
}

const SECTION_ORDER: ReadonlyArray<SuperConsoleDiagnosticSection> = ['motion', 'output', 'machine'];
const SECTION_LABELS: Readonly<Record<SuperConsoleDiagnosticSection, string>> = {
  motion: 'Motion behavior',
  output: 'Laser / spindle output contract',
  machine: 'Limits, homing & travel',
};

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border-strong)',
  borderRadius: 4,
  background: 'var(--lf-bg-input)',
  padding: 8,
  marginBottom: 8,
};
const headingRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
};
const readOnlyBadgeStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '0 5px',
  color: 'var(--lf-text-muted)',
  fontSize: 10,
  textTransform: 'uppercase',
};
const noticeStyle: React.CSSProperties = {
  margin: '6px 0',
  color: 'var(--lf-text-muted)',
  lineHeight: 1.35,
};
const policyActiveStyle: React.CSSProperties = {
  margin: '6px 0',
  color: 'var(--lf-success-fg)',
  fontWeight: 600,
  lineHeight: 1.35,
};
const policyWarningStyle: React.CSSProperties = {
  margin: '6px 0',
  padding: 6,
  border: '1px solid var(--lf-warning)',
  borderRadius: 4,
  color: 'var(--lf-warning-fg)',
  lineHeight: 1.35,
};
const emptyStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontStyle: 'italic',
};
const sectionStyle: React.CSSProperties = { marginTop: 6 };
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontWeight: 600 };
const tableWrapStyle: React.CSSProperties = {
  overflowX: 'auto',
  marginTop: 4,
  border: '1px solid var(--lf-border)',
};
const tableStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 640,
  borderCollapse: 'collapse',
  fontSize: 11,
};
const cellStyle: React.CSSProperties = {
  padding: '4px 5px',
  borderBottom: '1px solid var(--lf-border)',
  textAlign: 'left',
  verticalAlign: 'top',
};
const valueCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontFamily: 'ui-monospace, Menlo, monospace',
  whiteSpace: 'nowrap',
};
const contextLabelStyle: React.CSSProperties = {
  display: 'block',
  color: 'var(--lf-text-muted)',
};
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const neutralStatusStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  color: 'var(--lf-text)',
};
const successStatusStyle: React.CSSProperties = {
  ...neutralStatusStyle,
  color: 'var(--lf-success-fg)',
};
const dangerStatusStyle: React.CSSProperties = {
  ...neutralStatusStyle,
  color: 'var(--lf-danger-fg)',
};
const noteStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 2,
  color: 'var(--lf-text-muted)',
};
const safetyNoteStyle: React.CSSProperties = {
  margin: '7px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
