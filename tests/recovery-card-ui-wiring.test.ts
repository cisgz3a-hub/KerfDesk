/**
 * T2-62/T2-44 follow-up: recovery-card content should have a real React
 * surface, and ConnectionPanelMain should render it from MachineService's
 * canonical safety state.
 *
 * Run: npx tsx tests/recovery-card-ui-wiring.test.ts
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RecoveryCard } from '../src/ui/recovery/RecoveryCard';
import { emergencyStopRecoveryCard } from '../src/ui/recovery/RecoveryCardContent';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  fail - ${message}`);
  }
}

console.log('\n=== recovery card UI wiring ===\n');

{
  const html = renderToStaticMarkup(React.createElement(RecoveryCard, {
    content: emergencyStopRecoveryCard(),
  }));

  assert(/Emergency Stop Complete/.test(html), 'RecoveryCard renders the card title');
  assert(/Machine reset and connection closed/.test(html), 'RecoveryCard renders what happened');
  assert(/Position is lost/.test(html), 'RecoveryCard renders what it means');
  assert(/Inspect the machine/.test(html), 'RecoveryCard renders recovery steps');
  assert(/Reconnect and immediately Start/.test(html), 'RecoveryCard renders do-not warning');
  assert(/data-recovery-card="emergency-stop"/.test(html), 'RecoveryCard carries a variant marker');
}

{
  const source = readFileSync(
    resolve(process.cwd(), 'src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );

  assert(/onSafetyStateChange/.test(source), 'ConnectionPanelMain subscribes to MachineService safety state');
  assert(/getSafetyState/.test(source), 'ConnectionPanelMain initializes from MachineService safety state');
  assert(/buildRecoveryCard\(\{\s*variant:\s*'alarm'/.test(source), 'ConnectionPanelMain builds alarm recovery content');
  assert(/alarmCode:\s*machineState\?\.alarmCode/.test(source), 'ConnectionPanelMain threads GRBL alarm code into the alarm recovery card');
  assert(/buildRecoveryCard\(\{\s*variant:\s*'emergency-stop'/.test(source), 'ConnectionPanelMain builds emergency-stop recovery content');
  assert(/React\.createElement\(RecoveryCard/.test(source), 'ConnectionPanelMain renders RecoveryCard');
  assert(/handleRecoveryAction/.test(source), 'ConnectionPanelMain wires recovery-card actions');
  assert(!/Machine halted \(alarm state\)/.test(source), 'ConnectionPanelMain no longer renders the legacy alarm banner copy');
  assert(/safetyRecoveryCard/.test(source), 'ConnectionPanelMain threads safetyRecoveryCard into the panel');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
