/**
 * T2-118: troubleshooting panel content layer (`Help → Diagnostics`).
 * Pre-T2-118 there was no dedicated diagnostics surface — users
 * hitting problems didn't know what to send support, what evidence
 * the app captured, or what to check first. They pasted screenshots
 * and asked questions; support iterated.
 *
 * Audit 5C Required Priority 11.
 *
 * T2-118 ships the structured content that the React panel
 * (T2-118-followup) will render: typed sections, status indicators,
 * common-issues taxonomy, "what evidence is captured" report. The
 * UI itself is mechanical once the content is typed.
 */

export type SectionStatus = 'ok' | 'warning' | 'error' | 'unknown';

export interface SectionItem {
  readonly label: string;
  readonly value: string;
  readonly status: SectionStatus;
  readonly hint?: string;
}

export type SectionKind =
  | 'connection'
  | 'last-job'
  | 'recent-issues'
  | 'storage'
  | 'common-issues';

export interface DiagnosticsSection {
  readonly kind: SectionKind;
  readonly title: string;
  readonly items: readonly SectionItem[];
  readonly cta?: { label: string; key: string };
}

export type CommonIssueKey =
  | 'connection-problems'
  | 'job-stopped-halfway'
  | 'wrong-position-or-burn'
  | 'output-too-light-or-dark'
  | 'app-wont-open';

export interface CommonIssueGuide {
  readonly key: CommonIssueKey;
  readonly title: string;
  readonly capturedEvidence: readonly string[];
  readonly userChecks: readonly string[];
}

export const COMMON_ISSUES: readonly CommonIssueGuide[] = [
  {
    key: 'connection-problems',
    title: 'Connection problems',
    capturedEvidence: [
      'USB / WebSerial transport state',
      'Last successful handshake timestamp',
      'GRBL banner observed at last connect',
      'Recent transport errors (last 10)',
    ],
    userChecks: [
      'Cable: try a different USB cable + a known-good port.',
      'Power: confirm the machine is powered on before clicking Connect.',
      'Browser permissions: re-grant the WebSerial permission.',
      'Other software: close any other tool that might own the port (LightBurn, Candle).',
    ],
  },
  {
    key: 'job-stopped-halfway',
    title: 'Job stopped halfway',
    capturedEvidence: [
      'Last gcode line streamed before the stop',
      'Controller status at the time of stop',
      'Whether the user pressed Stop, an alarm fired, or the connection dropped',
      'Job log + RX/TX entries within 100 lines of the stop',
    ],
    userChecks: [
      'Air assist / fume hose did not snag the gantry.',
      'Material did not shift mid-job.',
      'No alarm/limit-switch contact left on the bed.',
    ],
  },
  {
    key: 'wrong-position-or-burn',
    title: 'Wrong position / burn',
    capturedEvidence: [
      'Active profile + bed dimensions',
      'Saved origin (if any) at job start',
      'Frame state at job start',
      'Compiled bounds vs. machine bounds',
    ],
    userChecks: [
      'Re-home before the next job (position trust is lost after E-stop / soft-reset).',
      'Frame the job before pressing Start (T1-59 gate).',
      'Confirm the active profile matches your physical machine.',
    ],
  },
  {
    key: 'output-too-light-or-dark',
    title: 'Output too light / dark',
    capturedEvidence: [
      'Layer settings (power %, feedrate, passes)',
      'Material preset snapshot (if applied) vs. live preset',
      'Maximum spindle ($30) — affects power scaling',
    ],
    userChecks: [
      'Lens / mirror cleanliness.',
      'Material is the type the preset assumes (basswood vs. plywood, 3mm vs. 4mm).',
      'Air assist on for cuts; off for engraves (varies by material).',
    ],
  },
  {
    key: 'app-wont-open',
    title: "App won't open",
    capturedEvidence: [
      'Last successful boot timestamp',
      'Crash count in the last 60 seconds (T2-105 crash-loop detector)',
      'Storage health summary (T2-116)',
    ],
    userChecks: [
      'Try Safe Mode (skips autosave + plugins).',
      'If safe mode boots, the autosave may be corrupt — restore from previous (T2-70).',
      'Last resort: clear user data via Help → Reset.',
    ],
  },
];

/** Sentinel — used by the React panel when it has no live data yet. */
export interface DiagnosticsSnapshot {
  readonly connection: {
    readonly status: 'connected' | 'disconnected' | 'connecting' | 'failed';
    readonly transport: string;
    readonly profileName: string | null;
    readonly profileMatchesController: boolean | null;
    readonly positionTrusted: boolean;
    readonly lastHomedAt: number | null;
  };
  readonly lastJob: {
    readonly hadOne: boolean;
    readonly status: 'completed' | 'aborted-by-user' | 'aborted-emergency' | 'failed' | 'unknown' | null;
    readonly lineAtEnd: number | null;
    readonly totalLines: number | null;
    readonly startedAt: number | null;
    readonly durationMs: number | null;
  };
  readonly recentIssues: readonly { title: string; ageMs: number; severity: 'warning' | 'error' | 'critical' }[];
  readonly storage: {
    readonly usedMb: number | null;
    readonly quotaMb: number | null;
    readonly lastSaveAgoMs: number | null;
    readonly lastSaveOk: boolean;
  };
}

export function buildConnectionSection(snap: DiagnosticsSnapshot): DiagnosticsSection {
  const items: SectionItem[] = [];
  items.push({
    label: 'Status',
    value: snap.connection.status === 'connected'
      ? `Connected (${snap.connection.transport})`
      : snap.connection.status,
    status: snap.connection.status === 'connected' ? 'ok' : snap.connection.status === 'failed' ? 'error' : 'warning',
  });
  if (snap.connection.profileName != null) {
    items.push({
      label: 'Profile',
      value: snap.connection.profileMatchesController === true
        ? `${snap.connection.profileName} (correct)`
        : snap.connection.profileMatchesController === false
          ? `${snap.connection.profileName} (mismatch)`
          : `${snap.connection.profileName} (unverified)`,
      status: snap.connection.profileMatchesController === true ? 'ok'
        : snap.connection.profileMatchesController === false ? 'warning' : 'unknown',
    });
  }
  items.push({
    label: 'Position',
    value: snap.connection.positionTrusted
      ? (snap.connection.lastHomedAt != null
          ? `Trusted (homed ${formatAgo(Date.now() - snap.connection.lastHomedAt)})`
          : 'Trusted')
      : 'Untrusted — re-home before next job',
    status: snap.connection.positionTrusted ? 'ok' : 'warning',
  });
  return {
    kind: 'connection',
    title: 'Connection',
    items,
  };
}

export function buildLastJobSection(snap: DiagnosticsSnapshot): DiagnosticsSection {
  if (!snap.lastJob.hadOne) {
    return {
      kind: 'last-job',
      title: 'Last Job',
      items: [{
        label: 'Status', value: 'No jobs run yet.', status: 'unknown',
      }],
    };
  }
  const items: SectionItem[] = [];
  const status = snap.lastJob.status ?? 'unknown';
  const sectionStatus: SectionStatus =
    status === 'completed' ? 'ok'
    : status === 'aborted-by-user' ? 'warning'
    : status === 'aborted-emergency' || status === 'failed' ? 'error'
    : 'unknown';
  const progress = snap.lastJob.lineAtEnd != null && snap.lastJob.totalLines != null && snap.lastJob.totalLines > 0
    ? ` at line ${snap.lastJob.lineAtEnd} of ${snap.lastJob.totalLines} (${Math.round(snap.lastJob.lineAtEnd / snap.lastJob.totalLines * 100)}%)`
    : '';
  items.push({ label: 'Status', value: status + progress, status: sectionStatus });
  if (snap.lastJob.durationMs != null) {
    items.push({
      label: 'Duration', value: formatDuration(snap.lastJob.durationMs), status: 'unknown',
    });
  }
  return { kind: 'last-job', title: 'Last Job', items, cta: { label: 'View details', key: 'view-last-job' } };
}

export function buildRecentIssuesSection(snap: DiagnosticsSnapshot): DiagnosticsSection {
  if (snap.recentIssues.length === 0) {
    return {
      kind: 'recent-issues',
      title: 'Recent Issues',
      items: [{ label: 'Status', value: 'No recent issues.', status: 'ok' }],
    };
  }
  return {
    kind: 'recent-issues',
    title: 'Recent Issues',
    items: snap.recentIssues.map(i => ({
      label: i.severity === 'warning' ? 'Warning' : i.severity === 'critical' ? 'Critical' : 'Error',
      value: `${i.title} (${formatAgo(i.ageMs)})`,
      status: i.severity === 'warning' ? 'warning' : 'error',
    })),
  };
}

export function buildStorageSection(snap: DiagnosticsSnapshot): DiagnosticsSection {
  const items: SectionItem[] = [];
  if (snap.storage.usedMb != null && snap.storage.quotaMb != null) {
    const pct = snap.storage.quotaMb > 0 ? snap.storage.usedMb / snap.storage.quotaMb : 0;
    items.push({
      label: 'Used',
      value: `${snap.storage.usedMb.toFixed(0)} MB / ~${snap.storage.quotaMb.toFixed(0)} MB`,
      status: pct >= 0.8 ? 'warning' : 'ok',
    });
  }
  if (snap.storage.lastSaveAgoMs != null) {
    items.push({
      label: 'Last save',
      value: snap.storage.lastSaveOk
        ? `${formatAgo(snap.storage.lastSaveAgoMs)}`
        : `${formatAgo(snap.storage.lastSaveAgoMs)} (failed)`,
      status: snap.storage.lastSaveOk ? 'ok' : 'error',
    });
  }
  return { kind: 'storage', title: 'Storage', items };
}

export function buildCommonIssuesSection(): DiagnosticsSection {
  return {
    kind: 'common-issues',
    title: 'Common issues',
    items: COMMON_ISSUES.map(issue => ({
      label: issue.title, value: 'Open guide', status: 'unknown',
    })),
  };
}

/** Compose the full panel from a snapshot. */
export function buildDiagnosticsPanel(snap: DiagnosticsSnapshot): readonly DiagnosticsSection[] {
  return [
    buildConnectionSection(snap),
    buildLastJobSection(snap),
    buildRecentIssuesSection(snap),
    buildStorageSection(snap),
    buildCommonIssuesSection(),
  ];
}

/** Look up an issue guide by key. */
export function getCommonIssueGuide(key: CommonIssueKey): CommonIssueGuide | null {
  return COMMON_ISSUES.find(i => i.key === key) ?? null;
}

function formatAgo(deltaMs: number): string {
  const sec = Math.max(0, Math.floor(deltaMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}:${remSec.toString().padStart(2, '0')}`;
}
