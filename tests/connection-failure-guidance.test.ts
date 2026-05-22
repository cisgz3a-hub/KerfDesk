/**
 * LF-EXT-K40-005: device permission failures are product behavior,
 * not just raw exception text.
 *
 * Run: npx tsx tests/connection-failure-guidance.test.ts
 */
import { readFileSync } from 'node:fs';
import { classifyConnectionFailure, formatConnectionFailureMessage } from '../src/app/ConnectionFailureGuidance';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

function guidanceText(input: unknown): string {
  const guidance = classifyConnectionFailure(input);
  return `${guidance.title}\n${guidance.message}\n${guidance.actions.join('\n')}`;
}

console.log('\n=== connection failure guidance ===\n');

{
  const guidance = classifyConnectionFailure(new Error('Failed to open serial port: NotAllowedError: permission denied'));
  const text = formatConnectionFailureMessage(guidance);
  assert(guidance.kind === 'permission-denied', 'permission denied is classified distinctly');
  assert(/permission/i.test(text), 'permission guidance names permission');
  assert(/browser/i.test(text) && /USB/i.test(text), 'permission guidance mentions browser USB permission');
  assert(/close other laser or CNC software/i.test(text), 'permission guidance includes safe port-conflict action');
}

{
  const text = guidanceText(new Error('Failed to open serial port: NotFoundError: no port selected by the user'));
  assert(/No USB laser selected/i.test(text), 'cancelled/no-port picker gets no-device guidance');
  assert(/choose the laser port/i.test(text), 'no-device guidance tells user to choose the laser port');
}

{
  const text = guidanceText(new Error('Failed to open serial port: NetworkError: port busy or already open'));
  assert(/USB serial port is busy/i.test(text), 'busy serial port gets port-busy guidance');
  assert(/Close LightBurn/i.test(text), 'busy guidance names common competing sender software');
}

{
  const text = guidanceText(new Error('Web Serial not supported in this browser'));
  assert(/not available/i.test(text), 'unsupported browser gets unavailable guidance');
  assert(/Chrome|Edge|packaged LaserForge app/i.test(text), 'unsupported browser guidance gives supported runtime options');
}

{
  const text = guidanceText(new Error('handshake timeout waiting for GRBL welcome'));
  assert(/Laser did not complete the GRBL handshake/i.test(text), 'handshake timeout gets wrong-device/baud guidance');
  assert(/baud/i.test(text) && /firmware/i.test(text), 'handshake guidance names baud and firmware checks');
}

{
  const panel = readFileSync('src/ui/components/ConnectionPanelMain.tsx', 'utf8');
  assert(panel.includes('classifyConnectionFailure'), 'ConnectionPanelMain imports classifyConnectionFailure');
  assert(panel.includes('formatConnectionFailureMessage'), 'ConnectionPanelMain formats connection guidance for the user-facing log');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
