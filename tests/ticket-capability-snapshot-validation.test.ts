/**
 * T2-37: capability snapshot in ValidatedJobTicket. Pre-T2-37 the
 * ticket carried sceneHash + profileHash + gcodeHash but NO snapshot
 * of the live $$ settings or the capability values used during
 * compile. Audit 3C Finding 7.2 + Required Priority 5.
 *
 * Run: npx tsx tests/ticket-capability-snapshot-validation.test.ts
 */
import {
  buildTicketCapabilitySnapshot,
  detectCapabilityMismatch,
  ticketStillValid,
  hashCapabilitiesValue,
  type TicketCapabilitySnapshot,
  type CurrentMachineState,
} from '../src/core/job/TicketCapabilitySnapshot';
import { grblCapabilities } from '../src/controllers/ControllerCapabilities';
import type { ControllerCapabilities } from '../src/controllers/ControllerCapabilities';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-37 Ticket capability snapshot ===\n');

void (async () => {

// 1. buildTicketCapabilitySnapshot: shape
{
  const snap = buildTicketCapabilitySnapshot({
    capabilities: grblCapabilities,
    settingsRaw: '$30=1000\n$32=1\n',
    identityRaw: '[VER:1.1h.20190825:][OPT:VL,15,128]',
  });
  assert(/^[0-9a-f]{8}$/.test(snap.capabilitySnapshotHash),
    `capabilitySnapshotHash is 8-char hex (got ${snap.capabilitySnapshotHash})`);
  assert(snap.settingsHash != null && /^[0-9a-f]{8}$/.test(snap.settingsHash),
    `settingsHash hashed`);
  assert(snap.controllerIdentityHash != null && /^[0-9a-f]{8}$/.test(snap.controllerIdentityHash),
    `controllerIdentityHash hashed`);
  assert(snap.capabilitiesUsed === grblCapabilities,
    `capabilitiesUsed carried`);
}

// 2. buildTicketCapabilitySnapshot: null + empty raw → null hash
{
  const a = buildTicketCapabilitySnapshot({
    capabilities: grblCapabilities,
    settingsRaw: null,
    identityRaw: null,
  });
  assert(a.settingsHash === null && a.controllerIdentityHash === null,
    `null raw → null hashes`);
  const b = buildTicketCapabilitySnapshot({
    capabilities: grblCapabilities,
    settingsRaw: '   ',
    identityRaw: '',
  });
  assert(b.settingsHash === null && b.controllerIdentityHash === null,
    `whitespace raw → null hashes`);
}

// 3. hashCapabilitiesValue: stable across key-order
{
  const a = hashCapabilitiesValue({ x: 1, y: 2, z: 3 });
  const b = hashCapabilitiesValue({ z: 3, x: 1, y: 2 });
  assert(a === b, `key-order independent (got ${a} vs ${b})`);
}

// 4. hashCapabilitiesValue: null/undefined → 'none'
{
  assert(hashCapabilitiesValue(null) === 'none', `null → 'none'`);
  assert(hashCapabilitiesValue(undefined) === 'none', `undefined → 'none'`);
}

// 5. detectCapabilityMismatch: identical snapshot + state → null
{
  const snap = buildTicketCapabilitySnapshot({
    capabilities: grblCapabilities,
    settingsRaw: '$30=1000',
    identityRaw: '[VER:1.1h]',
  });
  const r = detectCapabilityMismatch(snap, {
    capabilities: grblCapabilities,
    settingsRaw: '$30=1000',
    identityRaw: '[VER:1.1h]',
  });
  assert(r === null, `identical → null`);
}

// 6. ticketStillValid: convenience boolean
{
  const snap = buildTicketCapabilitySnapshot({
    capabilities: grblCapabilities,
    settingsRaw: '$30=1000',
  });
  assert(ticketStillValid(snap, { capabilities: grblCapabilities, settingsRaw: '$30=1000' }) === true,
    `match → ticketStillValid=true`);
  assert(ticketStillValid(snap, { capabilities: grblCapabilities, settingsRaw: '$30=255' }) === false,
    `mismatch → ticketStillValid=false`);
}

// 7. Identity change → controller-identity-changed
{
  const snap = buildTicketCapabilitySnapshot({
    capabilities: grblCapabilities,
    settingsRaw: '$30=1000',
    identityRaw: '[VER:1.1h]',
  });
  const r = detectCapabilityMismatch(snap, {
    capabilities: grblCapabilities,
    settingsRaw: '$30=1000',
    identityRaw: '[VER:1.1z]',  // different
  });
  assert(r != null && r.kind === 'controller-identity-changed',
    `identity change → controller-identity-changed`);
}

// 8. Settings change → controller-settings-changed
{
  const snap = buildTicketCapabilitySnapshot({
    capabilities: grblCapabilities,
    settingsRaw: '$30=1000',
    identityRaw: '[VER:1.1h]',
  });
  const r = detectCapabilityMismatch(snap, {
    capabilities: grblCapabilities,
    settingsRaw: '$30=255',
    identityRaw: '[VER:1.1h]',  // identity same
  });
  assert(r != null && r.kind === 'controller-settings-changed',
    `settings change → controller-settings-changed`);
}

// 9. $30 maxPowerValue change with no settings/identity hash
//    → max-spindle-changed (per-field message)
{
  const snap = buildTicketCapabilitySnapshot({ capabilities: grblCapabilities });
  const altered: ControllerCapabilities = {
    ...grblCapabilities,
    laser: { ...grblCapabilities.laser, maxPowerValue: 255 },
  };
  const r = detectCapabilityMismatch(snap, { capabilities: altered });
  assert(r != null && r.kind === 'max-spindle-changed',
    `$30 1000→255: max-spindle-changed (got ${r?.kind})`);
  assert(r != null && r.detail?.before === 1000 && r.detail?.after === 255,
    `before/after carried in detail`);
  assert(r != null && r.message.includes('1000') && r.message.includes('255'),
    `message names both values`);
}

// 10. Bed dimensions change
{
  const snap = buildTicketCapabilitySnapshot({ capabilities: grblCapabilities });
  const altered: ControllerCapabilities = {
    ...grblCapabilities,
    motion: { ...grblCapabilities.motion, bedWidthMm: 600 },
  };
  const r = detectCapabilityMismatch(snap, { capabilities: altered });
  assert(r != null && r.kind === 'bed-dimensions-changed',
    `bed change → bed-dimensions-changed (got ${r?.kind})`);
}

// 11. Laser mode change (powerUnit)
{
  const snap = buildTicketCapabilitySnapshot({ capabilities: grblCapabilities });
  const altered: ControllerCapabilities = {
    ...grblCapabilities,
    laser: { ...grblCapabilities.laser, powerUnit: 'pwm-byte' },
  };
  const r = detectCapabilityMismatch(snap, { capabilities: altered });
  assert(r != null && r.kind === 'laser-mode-changed',
    `powerUnit change → laser-mode-changed`);
}

// 12. Execution model change
{
  const snap = buildTicketCapabilitySnapshot({ capabilities: grblCapabilities });
  const altered: ControllerCapabilities = {
    ...grblCapabilities,
    output: { ...grblCapabilities.output, jobExecution: 'file-upload' },
  };
  const r = detectCapabilityMismatch(snap, { capabilities: altered });
  assert(r != null && r.kind === 'execution-model-changed',
    `execution-model change`);
  assert(r != null && r.message.includes('line-stream') && r.message.includes('file-upload'),
    `message names both modes`);
}

// 13. Catch-all capability hash mismatch (when no high-impact field
//     changed but something else did)
{
  const snap = buildTicketCapabilitySnapshot({ capabilities: grblCapabilities });
  const altered: ControllerCapabilities = {
    ...grblCapabilities,
    transport: { ...grblCapabilities.transport, ackModel: 'device-progress' },
  };
  const r = detectCapabilityMismatch(snap, { capabilities: altered });
  assert(r != null && r.kind === 'capabilities-changed',
    `non-specific capability change → capabilities-changed (got ${r?.kind})`);
}

// 14. Order: identity change reported BEFORE settings change
//     (when both differ, identity is the more specific cause)
{
  const snap = buildTicketCapabilitySnapshot({
    capabilities: grblCapabilities,
    settingsRaw: '$30=1000',
    identityRaw: '[VER:1.1h]',
  });
  const r = detectCapabilityMismatch(snap, {
    capabilities: grblCapabilities,
    settingsRaw: '$30=255',
    identityRaw: '[VER:1.1z]',
  });
  assert(r != null && r.kind === 'controller-identity-changed',
    `both diverge: identity reported first`);
}

// 15. Order: settings change reported BEFORE per-field check
{
  const snap = buildTicketCapabilitySnapshot({
    capabilities: grblCapabilities,
    settingsRaw: '$30=1000',
  });
  const altered: ControllerCapabilities = {
    ...grblCapabilities,
    laser: { ...grblCapabilities.laser, maxPowerValue: 255 },
  };
  const r = detectCapabilityMismatch(snap, {
    capabilities: altered,
    settingsRaw: '$30=255',
  });
  assert(r != null && r.kind === 'controller-settings-changed',
    `settings hash present + change: settings reported first (not max-spindle)`);
}

// 16. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/core/job/TicketCapabilitySnapshot.ts'), 'utf-8');
  assert(/T2-37/.test(src), 'T2-37 marker in TicketCapabilitySnapshot.ts');
  for (const id of [
    'TicketCapabilitySnapshot', 'CapabilityMismatchKind',
    'CapabilityMismatchReason', 'buildTicketCapabilitySnapshot',
    'detectCapabilityMismatch', 'ticketStillValid', 'hashCapabilitiesValue',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of [
    'capabilities-changed', 'controller-settings-changed',
    'controller-identity-changed', 'max-spindle-changed',
    'bed-dimensions-changed', 'laser-mode-changed',
    'execution-model-changed',
  ]) {
    assert(src.includes(`'${k}'`), `mismatch kind '${k}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

// Suppress unused-import warnings for re-exports test scaffolds.
type _Unused = TicketCapabilitySnapshot | CurrentMachineState;
