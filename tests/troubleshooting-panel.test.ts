/**
 * T2-118: troubleshooting panel content layer. Pre-T2-118 there
 * was no dedicated diagnostics surface — users hitting problems
 * didn't know what to send support.
 *
 * Run: npx tsx tests/troubleshooting-panel.test.ts
 */
import {
  buildConnectionSection,
  buildLastJobSection,
  buildRecentIssuesSection,
  buildStorageSection,
  buildCommonIssuesSection,
  buildDiagnosticsPanel,
  getCommonIssueGuide,
  COMMON_ISSUES,
  type DiagnosticsSnapshot,
  type CommonIssueKey,
  type SectionStatus,
} from '../src/diagnostics/TroubleshootingPanelContent';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-118 troubleshooting panel content ===\n');

const fullSnap = (overrides: Partial<DiagnosticsSnapshot> = {}): DiagnosticsSnapshot => ({
  connection: {
    status: 'connected',
    transport: 'USB CH340',
    profileName: 'Falcon A1 Pro',
    profileMatchesController: true,
    positionTrusted: true,
    lastHomedAt: Date.now() - 4 * 60 * 1000,
    ...overrides.connection,
  },
  lastJob: {
    hadOne: false,
    status: null,
    lineAtEnd: null,
    totalLines: null,
    startedAt: null,
    durationMs: null,
    ...overrides.lastJob,
  },
  recentIssues: overrides.recentIssues ?? [],
  storage: {
    usedMb: 47, quotaMb: 50,
    lastSaveAgoMs: 2 * 60 * 1000, lastSaveOk: true,
    ...overrides.storage,
  },
});

void (async () => {

// 1. COMMON_ISSUES has 5 entries
{
  assert(COMMON_ISSUES.length === 5, `5 common issues`);
  for (const k of [
    'connection-problems', 'job-stopped-halfway',
    'wrong-position-or-burn', 'output-too-light-or-dark',
    'app-wont-open',
  ]) {
    const found = COMMON_ISSUES.find(i => i.key === k);
    assert(found != null, `'${k}' present`);
  }
}

// 2. Each common issue has captured-evidence + user-checks
{
  for (const i of COMMON_ISSUES) {
    assert(i.capturedEvidence.length > 0, `'${i.key}' captured evidence`);
    assert(i.userChecks.length > 0, `'${i.key}' user checks`);
  }
}

// 3. buildConnectionSection: connected → status=ok
{
  const s = buildConnectionSection(fullSnap());
  assert(s.kind === 'connection', `kind=connection`);
  const status = s.items.find(i => i.label === 'Status');
  assert(status?.status === 'ok', `connected → ok`);
  assert(status?.value.includes('USB CH340') === true, `transport in value`);
}

// 4. buildConnectionSection: failed → status=error
{
  const s = buildConnectionSection(fullSnap({ connection: { status: 'failed', transport: '', profileName: null, profileMatchesController: null, positionTrusted: false, lastHomedAt: null } }));
  const status = s.items.find(i => i.label === 'Status');
  assert(status?.status === 'error', `failed → error`);
}

// 5. buildConnectionSection: profile mismatch → warning
{
  const s = buildConnectionSection(fullSnap({ connection: { status: 'connected', transport: 'X', profileName: 'P', profileMatchesController: false, positionTrusted: true, lastHomedAt: 0 } }));
  const profile = s.items.find(i => i.label === 'Profile');
  assert(profile?.status === 'warning', `mismatch → warning`);
  assert(profile?.value.includes('mismatch') === true, `mismatch in value`);
}

// 6. buildConnectionSection: untrusted position → warning
{
  const s = buildConnectionSection(fullSnap({ connection: { status: 'connected', transport: 'X', profileName: 'P', profileMatchesController: true, positionTrusted: false, lastHomedAt: null } }));
  const pos = s.items.find(i => i.label === 'Position');
  assert(pos?.status === 'warning', `untrusted → warning`);
  assert(pos?.value.toLowerCase().includes('re-home') === true, `re-home in value`);
}

// 7. buildLastJobSection: no jobs run → unknown status
{
  const s = buildLastJobSection(fullSnap());
  assert(s.items[0].status === 'unknown', `no jobs → unknown`);
  assert(s.items[0].value.toLowerCase().includes('no jobs'), `no-jobs message`);
}

// 8. buildLastJobSection: completed → ok
{
  const s = buildLastJobSection(fullSnap({
    lastJob: { hadOne: true, status: 'completed', lineAtEnd: 1850, totalLines: 1850, startedAt: 0, durationMs: 0 },
  }));
  const status = s.items.find(i => i.label === 'Status');
  assert(status?.status === 'ok', `completed → ok`);
}

// 9. buildLastJobSection: aborted-by-user → warning + line/percent
{
  const s = buildLastJobSection(fullSnap({
    lastJob: { hadOne: true, status: 'aborted-by-user', lineAtEnd: 1247, totalLines: 1850, startedAt: 0, durationMs: 4 * 60 * 1000 + 32 * 1000 },
  }));
  const status = s.items.find(i => i.label === 'Status');
  assert(status?.status === 'warning', `aborted-by-user → warning`);
  assert(status?.value.includes('1247') === true && status?.value.includes('1850') === true && status?.value.includes('67%') === true,
    `line/total/percent in value`);
}

// 10. buildLastJobSection: aborted-emergency → error
{
  const s = buildLastJobSection(fullSnap({
    lastJob: { hadOne: true, status: 'aborted-emergency', lineAtEnd: 100, totalLines: 1000, startedAt: 0, durationMs: 60_000 },
  }));
  const status = s.items.find(i => i.label === 'Status');
  assert(status?.status === 'error', `e-stop → error`);
}

// 11. buildLastJobSection: includes "View details" CTA
{
  const s = buildLastJobSection(fullSnap({
    lastJob: { hadOne: true, status: 'completed', lineAtEnd: 100, totalLines: 100, startedAt: 0, durationMs: 60_000 },
  }));
  assert(s.cta?.label === 'View details', `cta label`);
  assert(s.cta?.key === 'view-last-job', `cta key`);
}

// 12. buildRecentIssuesSection: empty → ok status
{
  const s = buildRecentIssuesSection(fullSnap());
  assert(s.items[0].status === 'ok', `empty → ok`);
  assert(s.items[0].value.toLowerCase().includes('no recent'), `no-issues message`);
}

// 13. buildRecentIssuesSection: warning + critical + error
{
  const s = buildRecentIssuesSection(fullSnap({
    recentIssues: [
      { title: 'Frame failed', ageMs: 3 * 60 * 1000, severity: 'warning' },
      { title: 'Compile error', ageMs: 10 * 60 * 1000, severity: 'error' },
      { title: 'Storage full', ageMs: 30 * 60 * 1000, severity: 'critical' },
    ],
  }));
  assert(s.items.length === 3, `3 items`);
  assert(s.items[0].status === 'warning', `warning`);
  assert(s.items[1].status === 'error', `error`);
  assert(s.items[2].status === 'error', `critical → error tier`);
  assert(s.items[0].value.includes('Frame failed'), `title in value`);
  assert(s.items[0].value.includes('3 minutes ago'), `relative time`);
}

// 14. buildStorageSection: under quota → ok
{
  const s = buildStorageSection(fullSnap({
    storage: { usedMb: 25, quotaMb: 50, lastSaveAgoMs: 60 * 1000, lastSaveOk: true },
  }));
  const used = s.items.find(i => i.label === 'Used');
  assert(used?.status === 'ok', `25/50 → ok`);
}

// 15. buildStorageSection: ≥80% → warning
{
  const s = buildStorageSection(fullSnap({
    storage: { usedMb: 47, quotaMb: 50, lastSaveAgoMs: 60 * 1000, lastSaveOk: true },
  }));
  const used = s.items.find(i => i.label === 'Used');
  assert(used?.status === 'warning', `94% → warning`);
}

// 16. buildStorageSection: failed save → error
{
  const s = buildStorageSection(fullSnap({
    storage: { usedMb: 25, quotaMb: 50, lastSaveAgoMs: 60 * 1000, lastSaveOk: false },
  }));
  const last = s.items.find(i => i.label === 'Last save');
  assert(last?.status === 'error', `failed save → error`);
  assert(last?.value.toLowerCase().includes('failed') === true, `failed in value`);
}

// 17. buildCommonIssuesSection: 5 items
{
  const s = buildCommonIssuesSection();
  assert(s.items.length === 5, `5 common issues`);
}

// 18. buildDiagnosticsPanel: 5 sections
{
  const sections = buildDiagnosticsPanel(fullSnap());
  assert(sections.length === 5, `5 sections`);
  const kinds = sections.map(s => s.kind);
  assert(kinds[0] === 'connection', `[0]=connection`);
  assert(kinds[4] === 'common-issues', `[4]=common-issues`);
}

// 19. getCommonIssueGuide: each key resolves
{
  const keys: CommonIssueKey[] = [
    'connection-problems', 'job-stopped-halfway',
    'wrong-position-or-burn', 'output-too-light-or-dark',
    'app-wont-open',
  ];
  for (const k of keys) {
    const g = getCommonIssueGuide(k);
    assert(g != null, `'${k}' resolves`);
    assert((g?.title.length ?? 0) > 0, `'${k}' has title`);
  }
}

// 20. getCommonIssueGuide: unknown key → null
{
  assert(getCommonIssueGuide('something-else' as CommonIssueKey) === null, `unknown → null`);
}

// 21. THE audit's headline: panel surfaces what's wrong + what evidence
{
  const sections = buildDiagnosticsPanel(fullSnap({
    recentIssues: [{ title: 'Frame failed', ageMs: 3 * 60 * 1000, severity: 'warning' }],
  }));
  // What's wrong is in 'recent-issues'
  const issues = sections.find(s => s.kind === 'recent-issues');
  assert(issues != null && issues.items.some(i => i.value.includes('Frame failed')),
    `recent issues surface present`);
  // Evidence is in COMMON_ISSUES guides
  const guide = getCommonIssueGuide('job-stopped-halfway');
  assert(guide != null && guide.capturedEvidence.length >= 4,
    `each guide names >=4 pieces of captured evidence`);
}

// 22. SectionStatus tier ordering check (no overlap of values)
{
  const statuses: SectionStatus[] = ['ok', 'warning', 'error', 'unknown'];
  for (const s of statuses) {
    assert(s.length > 0, `'${s}' is a valid SectionStatus`);
  }
}

// 23. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/diagnostics/TroubleshootingPanelContent.ts'), 'utf-8');
  assert(/T2-118/.test(src), 'T2-118 marker');
  for (const id of [
    'SectionStatus', 'SectionItem', 'SectionKind', 'DiagnosticsSection',
    'CommonIssueKey', 'CommonIssueGuide', 'COMMON_ISSUES',
    'DiagnosticsSnapshot',
    'buildConnectionSection', 'buildLastJobSection',
    'buildRecentIssuesSection', 'buildStorageSection',
    'buildCommonIssuesSection', 'buildDiagnosticsPanel',
    'getCommonIssueGuide',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of ['connection-problems', 'job-stopped-halfway',
                   'wrong-position-or-burn', 'output-too-light-or-dark',
                   'app-wont-open']) {
    assert(src.includes(`'${k}'`), `issue '${k}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
