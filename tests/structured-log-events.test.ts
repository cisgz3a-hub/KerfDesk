/**
 * T3-74: structured user-facing log events.
 *
 * Run: npx tsx tests/structured-log-events.test.ts
 */
import { readFileSync } from 'node:fs';
import { MachineService } from '../src/app/MachineService';
import {
  filterStructuredLogEvents,
  formatStructuredLogEventDetails,
  formatStructuredLogEventTime,
  legacyMessageToStructuredLogEvent,
  normalizeStructuredLogEvent,
  resetStructuredLogEventIdsForTests,
  severityMeetsMinimum,
  type StructuredLogEvent,
} from '../src/app/StructuredMessageLog';
import { type SerialPortLike } from '../src/communication/SerialPort';
import { type LaserController } from '../src/controllers/ControllerInterface';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

function event(input: Partial<StructuredLogEvent> & Pick<StructuredLogEvent, 'domain' | 'severity' | 'title'>): StructuredLogEvent {
  return normalizeStructuredLogEvent(
    {
      domain: input.domain,
      severity: input.severity,
      title: input.title,
      message: input.message ?? input.title,
      recoverySteps: input.recoverySteps,
      developerDetails: input.developerDetails,
      legacyText: input.legacyText,
    },
    input.timestamp ?? 1_800_000_000_000,
  );
}

console.log('\n=== T3-74 structured log events ===\n');

resetStructuredLogEventIdsForTests();

{
  const events = [
    event({ domain: 'machine', severity: 'warning', title: 'Frame warning' }),
    event({ domain: 'job', severity: 'info', title: 'Job started' }),
    event({ domain: 'machine', severity: 'error', title: 'Alarm state' }),
  ];

  const machineEvents = filterStructuredLogEvents(events, { domain: 'machine' });
  assert(machineEvents.length === 2, 'filtering by domain returns only matching events');
  assert(machineEvents.every(e => e.domain === 'machine'), 'domain filter excludes non-matching domains');

  const warningOrHigher = filterStructuredLogEvents(events, { minimumSeverity: 'warning' });
  assert(warningOrHigher.length === 2, 'severity filter returns warning-or-higher events');
  assert(warningOrHigher.every(e => severityMeetsMinimum(e.severity, 'warning')), 'severity filter excludes info entries');

  const machineErrors = filterStructuredLogEvents(events, { domain: 'machine', minimumSeverity: 'error' });
  assert(machineErrors.length === 1 && machineErrors[0].title === 'Alarm state', 'domain and severity filters compose');
}

{
  const expanded = formatStructuredLogEventDetails(event({
    domain: 'machine',
    severity: 'error',
    title: 'Frame failed',
    message: 'Command G1 X100 was blocked.',
    recoverySteps: ['Clear the alarm', 'Frame again'],
    developerDetails: { command: 'G1 X100', code: 7 },
  }));

  assert(expanded.includes('Command G1 X100 was blocked.'), 'expanded event details include the full message');
  assert(expanded.includes('Recovery'), 'expanded event details include the recovery heading');
  assert(expanded.includes('Clear the alarm'), 'expanded event details include recovery steps');
  assert(expanded.includes('Developer details'), 'expanded event details include developer details when present');
}

{
  const legacy = legacyMessageToStructuredLogEvent('Simulator connected', 1_800_000_000_000);
  assert(legacy.severity === 'info', 'legacy appendMessage events are info-level for compatibility');
  assert(legacy.domain === 'system', 'legacy appendMessage events default to the system domain');
  assert(legacy.title === 'Simulator connected', 'legacy event title preserves visible text');
  assert(formatStructuredLogEventTime(legacy.timestamp) === '08:00:00', 'event time formatter is stable UTC HH:MM:SS');
}

{
  const svc = new MachineService(
    { current: null } as unknown as { current: LaserController },
    { current: null } as { current: SerialPortLike | null },
  );

  svc.appendMessage('Simulator connected');
  const state = svc.getState();
  assert(state.messages.length === 1 && state.messages[0] === 'Simulator connected', 'appendMessage still appends the legacy string log');
  assert(state.messageEvents.length === 1, 'appendMessage also creates a structured event');
  assert(state.messageEvents[0].severity === 'info', 'appendMessage structured event is info-level');
  assert(state.messageEvents[0].legacyText === 'Simulator connected', 'appendMessage structured event retains legacy display text');

  svc.appendLogEvent({
    domain: 'machine',
    severity: 'error',
    title: 'Alarm state',
    message: 'Clear alarm before running.',
    recoverySteps: ['Unlock after inspecting the machine'],
  });
  const afterStructured = svc.getState();
  assert(afterStructured.messages[1] === 'Alarm state: Clear alarm before running.', 'appendLogEvent updates the legacy string log for old UI consumers');
  assert(afterStructured.messageEvents[1].domain === 'machine', 'appendLogEvent stores the structured domain');

  svc.setMessages(['Loaded old console line']);
  const afterReplace = svc.getState();
  assert(afterReplace.messageEvents.length === 1, 'setMessages rebuilds structured events from legacy strings');
  assert(afterReplace.messageEvents[0].legacyText === 'Loaded old console line', 'setMessages preserves loaded legacy text');
}

{
  const serviceSource = readFileSync('src/app/MachineService.ts', 'utf-8');
  assert(serviceSource.includes('appendLogEvent'), 'MachineService exposes appendLogEvent for new structured callers');
  const hookSource = readFileSync('src/ui/hooks/useMachineService.ts', 'utf-8');
  assert(hookSource.includes('messageEvents'), 'useMachineService exposes structured message events to the UI');
  const consolePanelSource = readFileSync('src/ui/components/ConsolePanel.tsx', 'utf-8');
  assert(consolePanelSource.includes('StructuredLogPanel'), 'ConsolePanel renders the structured log UI');
  const logPanelSource = readFileSync('src/ui/components/connection/StructuredLogPanel.tsx', 'utf-8');
  assert(logPanelSource.includes('localStorage'), 'structured log filters persist with localStorage');
  assert(logPanelSource.includes('structured-log-event-details'), 'structured log rows expose expandable details');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
