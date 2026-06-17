import type { ProfileSuggestionIssue } from '../../core/devices';
import { inferProfileFromDiagnostic } from '../../core/devices';
import { Button } from '../kit';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { describePatch } from './DetectedSettingsBanner';

export function MachineProfileSuggestionPanel(): JSX.Element {
  const profile = useStore((s) => s.project.device);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const statusReport = useLaserStore((s) => s.statusReport);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const transcript = useLaserStore((s) => s.transcript);
  const suggestion = inferProfileFromDiagnostic({
    profile,
    controllerSettings,
    statusReport,
    wcoCache,
    workOriginActive,
    transcript,
  });
  const rows = describePatch(suggestion.patch, profile);
  const canApply = suggestion.confidence !== 'low' && rows.length > 0;

  return (
    <section style={panelStyle} aria-label="Diagnostic profile suggestion">
      <strong>Diagnostic profile suggestion</strong>
      <p style={copyStyle}>
        Reviews read-only controller evidence and proposes local profile changes. This does not
        write firmware settings.
      </p>
      <div style={metaStyle}>Confidence: {suggestion.confidence}</div>
      <IssueList title="Blockers" issues={suggestion.blockers} />
      <IssueList title="Warnings" issues={suggestion.warnings} />
      <PatchRows rows={rows} />
      <EvidenceSummary
        buildInfo={suggestion.evidence.buildInfo}
        modalState={suggestion.evidence.modalState}
        wcoKnown={suggestion.evidence.wcoKnown}
      />
      <Button
        variant="primary"
        disabled={!canApply}
        onClick={() => updateDeviceProfile(suggestion.patch)}
        title={
          canApply
            ? 'Apply these read-only diagnostic values to the local LaserForge device profile.'
            : 'Run diagnostic or read controller settings before applying a local profile suggestion.'
        }
      >
        Apply local profile suggestion
      </Button>
    </section>
  );
}

function IssueList(props: {
  readonly title: string;
  readonly issues: ReadonlyArray<ProfileSuggestionIssue<string>>;
}): JSX.Element | null {
  if (props.issues.length === 0) return null;
  return (
    <div style={issueBlockStyle}>
      <strong>{props.title}</strong>
      <ul style={listStyle}>
        {props.issues.map((issue) => (
          <li key={issue.code}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}

function PatchRows({ rows }: { readonly rows: ReturnType<typeof describePatch> }): JSX.Element {
  if (rows.length === 0) {
    return <p style={emptyStyle}>No local profile changes suggested yet.</p>;
  }
  return (
    <table style={tableStyle}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th style={cellStyle}>{row.label}</th>
            <td style={cellStyle}>{row.oldText}</td>
            <td style={cellStyle}>{row.newText}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EvidenceSummary(props: {
  readonly buildInfo: string | null;
  readonly modalState: string | null;
  readonly wcoKnown: boolean;
}): JSX.Element {
  return (
    <div style={metaStyle}>
      Evidence: {props.buildInfo ?? 'build info unknown'};{' '}
      {props.modalState ?? 'modal state unknown'}; WCO {props.wcoKnown ? 'known' : 'unknown'}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 8,
  background: 'var(--lf-bg-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const copyStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.35,
};
const metaStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const issueBlockStyle: React.CSSProperties = { fontSize: 12 };
const listStyle: React.CSSProperties = { margin: '4px 0 0', paddingLeft: 18 };
const emptyStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-faint)' };
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
};
const cellStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--lf-border)',
  padding: '4px 6px',
  textAlign: 'left',
};
