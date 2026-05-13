/**
 * T1-244: recovery-card actions must not acknowledge reconnect/recompile
 * before the real work has succeeded. Otherwise a recovery checklist can
 * be cleared while the machine is still disconnected or while G-code is
 * still missing after a failed compile.
 *
 * Run: npx tsx tests/recovery-card-actions-ack-after-work.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function extractSwitchCase(source: string, label: string): string {
  const marker = `case '${label}':`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const afterStart = start + marker.length;
  const nextCase = source.indexOf('\n        case ', afterStart);
  const end = nextCase >= 0 ? nextCase : source.indexOf('\n    }', afterStart);
  return source.slice(afterStart, end >= 0 ? end : source.length);
}

function extractConstFunction(source: string, name: string): string {
  const marker = `const ${name} = async () => {`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const bodyStart = start + marker.length - 1;
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

const root = process.cwd();
const panel = readFileSync(resolve(root, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf8');
const handlers = readFileSync(resolve(root, 'src/ui/hooks/useConnectionHandlers.ts'), 'utf8');

console.log('\n=== T1-244 recovery acknowledgement waits for real work ===\n');

const reconnectCase = extractSwitchCase(panel, 'reconnect');
const compileCase = extractSwitchCase(panel, 'compile');
const connectSimulatorBody = extractConstFunction(panel, 'connectSimulator');
const connectRealLaserBody = extractConstFunction(panel, 'connectRealLaser');
const reconnectAckHelper = /const acknowledgeReconnectRecovery = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[appendMessage, machineService\]\);/.exec(panel)?.[1] ?? '';

assert(reconnectCase.length > 0, 'reconnect recovery action case exists');
assert(!/applyRecoveryAck\('reconnect'\)/.test(reconnectCase),
  'reconnect action does not directly acknowledge reconnect');
assert(/case 'reconnect':[\s\S]*machineService\.disconnect\(\)/.test(panel),
  'reconnect action sends the user through an actual reconnect path');
assert(/acknowledgeReconnectRecovery\(\)/.test(connectSimulatorBody),
  'simulator connect success acknowledges reconnect recovery');
assert(/acknowledgeReconnectRecovery\(\)/.test(connectRealLaserBody),
  'USB connect success acknowledges reconnect recovery');
assert(/applyRecoveryAck\('reconnect'\)/.test(reconnectAckHelper),
  'reconnect acknowledgement helper applies reconnect ack');
assert(/recovery\.status === 'disconnectDuringJob' \|\| recovery\.status === 'emergencyStopped'/.test(reconnectAckHelper),
  'reconnect acknowledgement helper only handles reconnect recovery statuses');

assert(compileCase.length > 0, 'compile recovery action case exists');
assert(/await\s+onRecompile\?\.\(\)/.test(compileCase),
  'compile recovery action awaits the recompile callback');
assert(/recompileOk\s*!==\s*false[\s\S]*applyRecoveryAck\('recompile'\)/.test(compileCase),
  'compile recovery action acknowledges only a non-failed recompile');
assert(/handleConnectionRecompile:\s*\(\)\s*=>\s*Promise<boolean>/.test(handlers),
  'connection recompile handler reports success/failure');
assert(/return\s+gc\s*!==\s*null/.test(handlers),
  'connection recompile handler returns false when compile produced no G-code');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
