/**
 * T2-46: user-facing safety outcome messages. Pre-T2-46 the UI
 * showed generic "Disconnected" / "Stopped" without distinguishing
 * verified-safe vs commanded-unverified vs unknown-unsafe.
 *
 * Run: npx tsx tests/safety-outcome-messages.test.ts
 */
import {
  formatSafetyOutcome,
  buildActivityLogRow,
  isPersistentSeverity,
  isIncidentWorthy,
  type UserSafetyMessage,
  type SafetyOutcomeSeverity,
  type ActivityLogRow,
} from '../src/ui/safety/SafetyOutcomeMessages';
import type { SafetyActionResult, SafetyAction } from '../src/app/SafetyActionResult';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-46 SafetyOutcome user messages ===\n');

const baseResult = (overrides: Partial<SafetyActionResult> = {}): SafetyActionResult => ({
  action: 'pause',
  accepted: true,
  motionState: 'paused',
  laserState: 'commandedOff',
  positionTrusted: true,
  requiresRehome: false,
  requiresReconnect: false,
  requiresInspection: false,
  timestamp: 1000,
  ...overrides,
});

void (async () => {

// 1. accepted=false → 'unsupported' severity
{
  const r = baseResult({ accepted: false, action: 'pause', message: 'no pause' });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'unsupported', `accepted=false → unsupported`);
  assert(msg.title === 'Pause not supported', `title names op`);
  assert(msg.body === 'no pause', `body uses message`);
}

// 2. accepted=false: title varies per action
{
  const titles = new Set<string>();
  const actions: SafetyAction[] = [
    'laserOff', 'pause', 'resume', 'abortJob',
    'emergencyStop', 'disconnectSafe',
    'beginTestFire', 'endTestFire',
  ];
  for (const a of actions) {
    const r = baseResult({ accepted: false, action: a });
    titles.add(formatSafetyOutcome(r).title);
  }
  assert(titles.size === 8, `8 distinct refusal titles`);
}

// 3. requiresInspection → unknown-unsafe + 'Inspect machine'
{
  const r = baseResult({
    requiresInspection: true,
    action: 'emergencyStop',
    message: 'state unknown',
  });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'unknown-unsafe', `severity=unknown-unsafe`);
  assert(msg.title === 'Inspect machine', `title=Inspect machine`);
  assert(msg.actionable !== null, `actionable instruction set`);
}

// 4. requiresReconnect → unknown-unsafe + 'Reconnect required'
{
  const r = baseResult({ requiresReconnect: true });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'unknown-unsafe', `severity=unknown-unsafe`);
  assert(msg.title === 'Reconnect required', `reconnect title`);
}

// 5. requiresInspection wins over requiresReconnect
{
  const r = baseResult({ requiresInspection: true, requiresReconnect: true });
  const msg = formatSafetyOutcome(r);
  assert(msg.title === 'Inspect machine', `inspection > reconnect`);
}

// 6. laserOff with commandedOff → 'commanded-unverified' + verification-unavailable
{
  const r = baseResult({
    action: 'laserOff',
    laserState: 'commandedOff',
  });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'commanded-unverified', `commanded-unverified`);
  assert(msg.body.toLowerCase().includes('verification'),
    `body names verification unavailable`);
}

// 7. abortJob with requiresRehome=true → commanded-unverified + 'Re-home' actionable
{
  const r = baseResult({
    action: 'abortJob',
    requiresRehome: true,
  });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'commanded-unverified', `severity`);
  assert(msg.title === 'Job aborted', `title=Job aborted`);
  assert(msg.actionable?.includes('Re-home') === true,
    `actionable mentions re-home`);
}

// 8. emergencyStop with requiresRehome=true → 'Emergency stop sent' title
{
  const r = baseResult({
    action: 'emergencyStop',
    requiresRehome: true,
  });
  const msg = formatSafetyOutcome(r);
  assert(msg.title === 'Emergency stop sent', `e-stop title`);
}

// 9. abortJob with requiresRehome=false → 'confirmed-safe'
{
  const r = baseResult({
    action: 'abortJob',
    requiresRehome: false,
    motionState: 'stopped',
  });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'confirmed-safe', `position retained → safe`);
}

// 10. pause → confirmed-safe + 'Paused'
{
  const r = baseResult({ action: 'pause' });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'confirmed-safe', `pause confirmed-safe`);
  assert(msg.title === 'Paused', `title=Paused`);
}

// 11. resume → confirmed-safe + 'Resumed'
{
  const r = baseResult({ action: 'resume' });
  const msg = formatSafetyOutcome(r);
  assert(msg.title === 'Resumed', `resume title`);
}

// 12. disconnectSafe → confirmed-safe
{
  const r = baseResult({ action: 'disconnectSafe' });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'confirmed-safe', `disconnect confirmed-safe`);
  assert(msg.title === 'Disconnected', `title=Disconnected`);
}

// 13. beginTestFire → commanded-unverified + deadman instruction
{
  const r = baseResult({ action: 'beginTestFire' });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'commanded-unverified', `test fire commanded-unverified`);
  assert(msg.actionable?.toLowerCase().includes('deadman') === true,
    `actionable mentions deadman`);
}

// 14. endTestFire → confirmed-safe
{
  const r = baseResult({ action: 'endTestFire' });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'confirmed-safe', `endTestFire confirmed-safe`);
}

// 15. THE audit's headline messages match
{
  // "Job aborted. GRBL soft reset sent. Position may be lost. Re-home before next job."
  const r = baseResult({
    action: 'abortJob',
    requiresRehome: true,
    message: 'Job aborted. GRBL soft reset sent. Position may be lost.',
  });
  const msg = formatSafetyOutcome(r);
  assert(msg.body.includes('soft reset') && msg.body.includes('Position may be lost'),
    `audit copy preserved`);
  assert(msg.actionable?.includes('Re-home') === true,
    `re-home guidance in actionable`);
}

// 16. Audit headline: "Laser-off command sent; verification unavailable."
{
  const r = baseResult({ action: 'laserOff', laserState: 'commandedOff' });
  const msg = formatSafetyOutcome(r);
  assert(msg.body.toLowerCase().includes('verification'),
    `audit's verification-unavailable copy`);
}

// 17. Audit headline: "Inspect machine before reconnecting."
{
  const r = baseResult({ requiresInspection: true });
  const msg = formatSafetyOutcome(r);
  assert(msg.body.toLowerCase().includes('inspect'),
    `audit's 'inspect' copy`);
}

// 18. Audit headline: "Pause unsupported for this controller."
{
  const r = baseResult({
    accepted: false,
    action: 'pause',
    message: 'Pause unsupported for this controller.',
  });
  const msg = formatSafetyOutcome(r);
  assert(msg.severity === 'unsupported',
    `audit's 'unsupported' classification`);
}

// 19. buildActivityLogRow: shape
{
  const r = baseResult({ action: 'pause', timestamp: 5000 });
  const row = buildActivityLogRow(r);
  assert(row.timestamp === 5000, `timestamp from result`);
  assert(row.action === 'pause', `action carried`);
  assert(row.accepted === true, `accepted carried`);
  assert(row.severity === 'confirmed-safe', `severity computed`);
  assert(row.id === '5000-pause', `default id = ts-action`);
}

// 20. buildActivityLogRow: caller-supplied id
{
  const r = baseResult({ action: 'pause' });
  const row = buildActivityLogRow(r, 'caller-id-99');
  assert(row.id === 'caller-id-99', `caller id used`);
}

// 21. isPersistentSeverity: only unknown-unsafe persists
{
  assert(isPersistentSeverity('unknown-unsafe'), `unknown-unsafe persists`);
  for (const s of ['confirmed-safe', 'commanded-unverified',
                   'unsupported'] as SafetyOutcomeSeverity[]) {
    assert(!isPersistentSeverity(s), `'${s}' is dismissable`);
  }
}

// 22. isIncidentWorthy: unknown-unsafe always counts
{
  const row: ActivityLogRow = {
    id: 'x', timestamp: 0, action: 'pause', accepted: true,
    severity: 'unknown-unsafe', title: '-', body: '-', actionable: null,
  };
  assert(isIncidentWorthy(row), `unknown-unsafe → incident`);
}

// 23. isIncidentWorthy: commanded-unverified + abortJob counts
{
  const row: ActivityLogRow = {
    id: 'x', timestamp: 0, action: 'abortJob', accepted: true,
    severity: 'commanded-unverified', title: '-', body: '-', actionable: null,
  };
  assert(isIncidentWorthy(row), `commanded-unverified abort → incident`);
}

// 24. isIncidentWorthy: commanded-unverified + e-stop counts
{
  const row: ActivityLogRow = {
    id: 'x', timestamp: 0, action: 'emergencyStop', accepted: true,
    severity: 'commanded-unverified', title: '-', body: '-', actionable: null,
  };
  assert(isIncidentWorthy(row), `commanded-unverified e-stop → incident`);
}

// 25. isIncidentWorthy: commanded-unverified + laserOff does NOT count alone
{
  const row: ActivityLogRow = {
    id: 'x', timestamp: 0, action: 'laserOff', accepted: true,
    severity: 'commanded-unverified', title: '-', body: '-', actionable: null,
  };
  assert(!isIncidentWorthy(row),
    `commanded-unverified laserOff alone is not an incident`);
}

// 26. isIncidentWorthy: confirmed-safe never counts
{
  const row: ActivityLogRow = {
    id: 'x', timestamp: 0, action: 'abortJob', accepted: true,
    severity: 'confirmed-safe', title: '-', body: '-', actionable: null,
  };
  assert(!isIncidentWorthy(row), `confirmed-safe is not incident`);
}

// 27. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/ui/safety/SafetyOutcomeMessages.ts'), 'utf-8');
  assert(/T2-46/.test(src), 'T2-46 marker');
  for (const id of [
    'SafetyOutcomeSeverity', 'UserSafetyMessage', 'formatSafetyOutcome',
    'ActivityLogRow', 'buildActivityLogRow',
    'isPersistentSeverity', 'isIncidentWorthy',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const s of ['confirmed-safe', 'commanded-unverified',
                   'unknown-unsafe', 'unsupported']) {
    assert(src.includes(`'${s}'`), `severity '${s}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
