/**
 * T1-67: ticket validation reasons must stay user-facing. Hash values remain
 * in console diagnostics for support, not in modal/message text.
 *
 * Run: npx tsx tests/ticket-validation-message-translation.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const ROOT = process.cwd();
// T1-135: the inline validation body moved to src/app/validateJobTicket.ts.
// MachineService.validateTicket now delegates to validateJobTicket; the
// reason strings + console.warn diagnostics live in the helper module,
// so the T1-67 user-facing-message pins scan the helper instead of the
// service. The service still owns the (private) wrapper method, so the
// "function exists" / "boundary located" pins remain.
const SOURCE = readFileSync(resolve(ROOT, 'src/app/MachineService.ts'), 'utf-8');
const HELPER_SOURCE = readFileSync(resolve(ROOT, 'src/app/validateJobTicket.ts'), 'utf-8');

console.log('\n=== T1-67 ticket validation messages ===\n');

const fnStart = SOURCE.indexOf('private validateTicket(');
const fnEnd = SOURCE.indexOf('async startValidatedJob(', fnStart);
assertContract(fnStart > -1, 'validateTicket function exists');
assertContract(fnEnd > fnStart, 'validateTicket function boundary located');
// Scan the helper for the reason strings + diagnostics, the service
// wrapper only stitches the inputs together (and is intentionally
// reason-free).
const fnBody = HELPER_SOURCE;

const reasonAssignments = [...fnBody.matchAll(/reason:\s*([\s\S]*?)(?=\n\s*};)/g)].map(match => match[1]);
assertContract(reasonAssignments.length >= 4, `validation reason assignments found (got ${reasonAssignments.length})`);

const hashLeaks = reasonAssignments.filter(reason => /\$\{[^}]*[Hh]ash[^}]*\}/.test(reason));
assertContract(hashLeaks.length === 0, 'no user-facing reason interpolates hash variables');

assertContract(
  fnBody.includes('The design changed after this G-code was created.')
    && fnBody.includes('Update G-code, then frame again before starting.'),
  'scene mismatch reason gives design-change action text',
);
assertContract(
  fnBody.includes('The device profile changed after this G-code was created.')
    && fnBody.includes('Update G-code before starting.'),
  'profile mismatch reason gives device-profile action text',
);
assertContract(
  fnBody.includes('The controller type changed after this G-code was created.'),
  'controller mismatch reason gives controller-type action text',
);

assertContract(
  fnBody.includes("console.warn('[ticket] scene hash mismatch'")
    && fnBody.includes('ticketHash: ticket.sceneHash')
    && fnBody.includes('currentHash: currentSceneHash'),
  'scene mismatch logs hashes for support diagnostics',
);
assertContract(
  fnBody.includes("console.warn('[ticket] profile hash mismatch'")
    && fnBody.includes('ticketHash: ticket.profileHash')
    && fnBody.includes('currentHash: currentProfileHash'),
  'profile mismatch logs hashes for support diagnostics',
);
assertContract(
  fnBody.includes("console.warn('[ticket] controller type mismatch'")
    && fnBody.includes('ticketControllerType: ticket.controllerType')
    && fnBody.includes('currentControllerType'),
  'controller mismatch logs controller types for support diagnostics',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
