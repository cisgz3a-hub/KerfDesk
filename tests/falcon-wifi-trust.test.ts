/**
 * T2-126: Falcon WiFi treated as untrusted telemetry. Pre-T2-126
 * the connection panel showed Falcon WiFi state with the same UI
 * prominence as serial state — users couldn't tell which was
 * authenticated.
 *
 * Run: npx tsx tests/falcon-wifi-trust.test.ts
 */
import {
  classifyConnectionTrust,
  evaluateWiFiActionPolicy,
  checkFalconIdentity,
  buildConnectionBadge,
  startOverWiFiDialog,
  ACTIONS_REQUIRING_TRUST,
  ALWAYS_SAFE_ACTIONS,
  type ConnectionKind,
  type TrustTier,
  type FalconWiFiAction,
  type WiFiPolicyMode,
  type ActionPolicyKind,
} from '../src/security/FalconWiFiTrust';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-126 Falcon WiFi trust classification ===\n');

void (async () => {

// 1. classifyConnectionTrust: usb-serial → trusted
{
  const t = classifyConnectionTrust('usb-serial');
  assert(t.tier === 'trusted', `usb tier=trusted`);
  assert(t.label.toLowerCase().includes('usb'), `label names USB`);
  assert(t.hint === null, `no hint`);
}

// 2. classifyConnectionTrust: simulator → trusted with dev hint
{
  const t = classifyConnectionTrust('simulator');
  assert(t.tier === 'trusted', `simulator trusted`);
  assert(t.hint?.toLowerCase().includes('simulator') === true, `hint mentions simulator`);
}

// 3. classifyConnectionTrust: wifi → untrusted with explicit hint
{
  const t = classifyConnectionTrust('wifi');
  assert(t.tier === 'untrusted', `wifi untrusted`);
  assert(t.label.toLowerCase().includes('telemetry'), `label names telemetry`);
  assert(t.hint?.toLowerCase().includes('not authenticated') === true,
    `hint says not authenticated`);
  assert(t.hint?.toLowerCase().includes('usb') === true, `hint suggests USB`);
}

// 4. classifyConnectionTrust: unknown → partial
{
  const t = classifyConnectionTrust('unknown');
  assert(t.tier === 'partial', `unknown → partial`);
  assert(t.hint?.toLowerCase().includes('untrusted') === true, `hint says untrusted`);
}

// 5. ACTIONS_REQUIRING_TRUST + ALWAYS_SAFE_ACTIONS partition
{
  for (const a of ACTIONS_REQUIRING_TRUST) {
    assert(!ALWAYS_SAFE_ACTIONS.includes(a as never),
      `'${a}' in REQUIRING but not in ALWAYS_SAFE`);
  }
  for (const a of ALWAYS_SAFE_ACTIONS) {
    assert(!ACTIONS_REQUIRING_TRUST.includes(a as never),
      `'${a}' in ALWAYS_SAFE but not in REQUIRING`);
  }
}

// 6. evaluateWiFiActionPolicy: trusted connection allows everything
{
  const trust = classifyConnectionTrust('usb-serial');
  for (const a of [...ACTIONS_REQUIRING_TRUST, ...ALWAYS_SAFE_ACTIONS] as FalconWiFiAction[]) {
    const p = evaluateWiFiActionPolicy({ action: a, trust, policyMode: 'strictest' });
    assert(p.kind === 'allow' && p.allowed, `'${a}' on USB → allow plain`);
  }
}

// 7. evaluateWiFiActionPolicy: WiFi + always-safe → allow plain regardless of policy
{
  const trust = classifyConnectionTrust('wifi');
  for (const a of ALWAYS_SAFE_ACTIONS as readonly FalconWiFiAction[]) {
    for (const mode of ['strictest', 'medium', 'loosest'] as WiFiPolicyMode[]) {
      const p = evaluateWiFiActionPolicy({ action: a, trust, policyMode: mode });
      assert(p.kind === 'allow' && p.allowed,
        `'${a}' WiFi + ${mode} → allow plain (status/pause/stop always permitted)`);
    }
  }
}

// 8. evaluateWiFiActionPolicy: WiFi + start-job + strictest → block
{
  const trust = classifyConnectionTrust('wifi');
  const p = evaluateWiFiActionPolicy({ action: 'start-job', trust, policyMode: 'strictest' });
  assert(p.kind === 'block', `kind=block`);
  assert(!p.allowed, `not allowed`);
  assert(p.userMessage.toLowerCase().includes('telemetry'), `message mentions telemetry`);
}

// 9. evaluateWiFiActionPolicy: WiFi + start-job + medium → require-override
{
  const trust = classifyConnectionTrust('wifi');
  const p = evaluateWiFiActionPolicy({ action: 'start-job', trust, policyMode: 'medium' });
  assert(p.kind === 'require-override', `kind=require-override`);
  assert(p.allowed, `allowed (after override)`);
  assert(p.userMessage.toLowerCase().includes('not authenticated'), `names risk`);
  assert(p.userMessage.toLowerCase().includes('usb'), `recommends USB`);
}

// 10. evaluateWiFiActionPolicy: WiFi + start-job + loosest → allow-with-warning
{
  const trust = classifyConnectionTrust('wifi');
  const p = evaluateWiFiActionPolicy({ action: 'start-job', trust, policyMode: 'loosest' });
  assert(p.kind === 'allow-with-warning', `kind=allow-with-warning`);
  assert(p.allowed, `allowed`);
}

// 11. evaluateWiFiActionPolicy: WiFi + frame/jog/unlock/home/set-origin all gated
{
  const trust = classifyConnectionTrust('wifi');
  for (const a of ['frame', 'jog', 'unlock', 'home', 'set-origin'] as FalconWiFiAction[]) {
    const p = evaluateWiFiActionPolicy({ action: a, trust, policyMode: 'strictest' });
    assert(p.kind === 'block', `'${a}' strictest → block`);
  }
}

// 12. evaluateWiFiActionPolicy: 'unknown' connection treated like wifi
{
  const trust = classifyConnectionTrust('unknown');
  const p = evaluateWiFiActionPolicy({ action: 'start-job', trust, policyMode: 'strictest' });
  assert(!p.allowed, `unknown + start-job + strictest → blocked`);
}

// 13. checkFalconIdentity: first pairing with serial → ok
{
  const r = checkFalconIdentity({
    storedSerial: null, observedSerial: 'SN-123', isFirstPairing: true,
  });
  assert(r.ok, `first pairing ok`);
  if (r.ok) assert(r.reason === 'first-pairing', `reason=first-pairing`);
}

// 14. checkFalconIdentity: first pairing without serial → no-serial-reported
{
  const r = checkFalconIdentity({
    storedSerial: null, observedSerial: null, isFirstPairing: true,
  });
  assert(!r.ok, `no serial reported → not ok`);
  if (!r.ok) assert(r.reason === 'no-serial-reported', `reason`);
}

// 15. checkFalconIdentity: subsequent connect, serials match
{
  const r = checkFalconIdentity({
    storedSerial: 'SN-A', observedSerial: 'SN-A', isFirstPairing: false,
  });
  assert(r.ok, `match ok`);
  if (r.ok) assert(r.reason === 'serial-matches', `reason=serial-matches`);
}

// 16. checkFalconIdentity: serials mismatch → not ok
{
  const r = checkFalconIdentity({
    storedSerial: 'SN-A', observedSerial: 'SN-B', isFirstPairing: false,
  });
  assert(!r.ok, `mismatch not ok`);
  if (!r.ok) {
    assert(r.reason === 'serial-mismatch', `reason=serial-mismatch`);
    assert(r.detail.includes('SN-A') && r.detail.includes('SN-B'),
      `detail names both serials`);
  }
}

// 17. checkFalconIdentity: subsequent connect with no observed serial
{
  const r = checkFalconIdentity({
    storedSerial: 'SN-A', observedSerial: null, isFirstPairing: false,
  });
  assert(!r.ok, `no serial reported`);
  if (!r.ok) assert(r.reason === 'no-serial-reported', `reason`);
}

// 18. checkFalconIdentity: stored is null but pairing claimed → expected-but-no-stored
{
  const r = checkFalconIdentity({
    storedSerial: null, observedSerial: 'SN-X', isFirstPairing: false,
  });
  assert(!r.ok, `no stored after pairing → not ok`);
  if (!r.ok) {
    assert(r.reason === 'expected-but-no-stored', `reason`);
    assert(r.detail.toLowerCase().includes('re-pair'), `re-pair guidance`);
  }
}

// 19. buildConnectionBadge: WiFi telemetry label
{
  const trust = classifyConnectionTrust('wifi');
  const badge = buildConnectionBadge({
    modelName: 'Falcon A1 Pro', address: '192.168.1.42', trust,
  });
  assert(badge.includes('Falcon A1 Pro'), `model named`);
  assert(badge.includes('192.168.1.42'), `address named`);
  assert(badge.includes('telemetry'), `label says telemetry`);
}

// 20. buildConnectionBadge: USB without address
{
  const trust = classifyConnectionTrust('usb-serial');
  const badge = buildConnectionBadge({
    modelName: 'Falcon A1 Pro', address: null, trust,
  });
  assert(badge.includes('Falcon A1 Pro'), `model named`);
  assert(badge.includes('USB Serial'), `USB label`);
  assert(!badge.includes('('), `no parens for missing address`);
}

// 21. startOverWiFiDialog: matches audit copy
{
  const d = startOverWiFiDialog();
  assert(d.title === 'Start job over WiFi?', `title`);
  assert(d.body.toLowerCase().includes('not authenticated'), `body says risk`);
  assert(d.preferUsbLabel === 'Use USB instead', `audit's USB button`);
  assert(d.cancelLabel === 'Cancel', `audit's cancel`);
  assert(d.proceedLabel === 'Start over WiFi anyway', `audit's proceed`);
}

// 22. THE audit's headline: WiFi never silently authorizes a safety-critical action
{
  const trust = classifyConnectionTrust('wifi');
  // Across all 3 policy modes, WiFi + start-job is NEVER 'allow' (plain) —
  // user always sees either block, override, or warning.
  for (const mode of ['strictest', 'medium', 'loosest'] as WiFiPolicyMode[]) {
    const p = evaluateWiFiActionPolicy({ action: 'start-job', trust, policyMode: mode });
    const surfaced: ActionPolicyKind[] = ['block', 'require-override', 'allow-with-warning'];
    assert(surfaced.includes(p.kind), `'${mode}' surfaces WiFi risk (kind=${p.kind})`);
  }
}

// 23. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/security/FalconWiFiTrust.ts'), 'utf-8');
  assert(/T2-126/.test(src), 'T2-126 marker');
  for (const id of [
    'ConnectionKind', 'TrustTier', 'TrustClassification',
    'classifyConnectionTrust',
    'ActionPolicyKind', 'FalconWiFiAction', 'ActionPolicy',
    'WiFiPolicyMode', 'ACTIONS_REQUIRING_TRUST', 'ALWAYS_SAFE_ACTIONS',
    'evaluateWiFiActionPolicy',
    'IdentityCheckResult', 'checkFalconIdentity',
    'buildConnectionBadge', 'OverrideDialogCopy', 'startOverWiFiDialog',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of ['usb-serial', 'wifi', 'simulator', 'unknown']) {
    assert(src.includes(`'${k}'`), `kind '${k}' declared`);
  }
  for (const t of ['trusted', 'partial', 'untrusted']) {
    assert(src.includes(`'${t}'`), `tier '${t}' declared`);
  }
  for (const m of ['strictest', 'medium', 'loosest']) {
    assert(src.includes(`'${m}'`), `mode '${m}' declared`);
  }
  for (const a of ['start-job', 'frame', 'jog', 'unlock', 'home',
                   'set-origin', 'view-status', 'pause', 'stop']) {
    assert(src.includes(`'${a}'`), `action '${a}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
