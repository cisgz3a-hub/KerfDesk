import type { SerialTranscriptEntry } from '../state/laser-transcript';
import type { ControllerIncidentContext } from '../state/controller-incident-context';
import { redactSupportReportText } from './support-report-redaction';

/** Local, allowlisted event evidence, explicitly separate from current machine facts. */
export function incidentReportLines(
  entries: ReadonlyArray<SerialTranscriptEntry>,
): ReadonlyArray<string> {
  return entries.flatMap((entry) => [
    'Incident ' +
      entry.id +
      ': ' +
      new Date(entry.at).toISOString() +
      ' ' +
      entry.direction +
      '/' +
      entry.source +
      '/' +
      entry.kind,
    'Raw: ' + escapeCell(entry.raw),
    ...(entry.decoded === undefined ? [] : ['Decoded: ' + escapeCell(entry.decoded)]),
    ...contextLines(entry.incidentContext),
    '',
  ]);
}

function contextLines(context: ControllerIncidentContext | undefined): ReadonlyArray<string> {
  if (context === undefined) return ['Event-time context: not captured.'];
  const { build, controller: c, run } = context;
  return [
    'Event-time context (captured when this incident occurred):',
    '  Build: ' +
      escapeCell(build.version) +
      ' (commit ' +
      escapeCell(build.commit) +
      ', built ' +
      escapeCell(build.builtAt) +
      ')',
    '  Controller: selected ' +
      escapeCell(c.selectedKind) +
      ', detected ' +
      escapeCell(c.detectedKind ?? 'not reported') +
      ', command set ' +
      escapeCell(c.commandSet ?? 'default'),
    '  Connection: ' +
      c.connection +
      ', session ' +
      c.sessionEpoch +
      ', baud ' +
      (c.baudRate ?? 'not reported'),
    '  USB: vendor ' +
      (c.usb?.usbVendorId ?? 'not reported') +
      ', product ' +
      (c.usb?.usbProductId ?? 'not reported'),
    '  Qualification: ' + escapeCell(qualificationText(c.qualification)),
    '  Last observed controller status: ' +
      escapeCell(c.status ?? 'not reported') +
      ', sequence ' +
      c.statusSequence +
      ', observed at ' +
      (c.statusObservedAt === null ? 'not reported' : new Date(c.statusObservedAt).toISOString()),
    '  Last observed machine position: ' +
      JSON.stringify(c.machinePosition) +
      '; work position: ' +
      JSON.stringify(c.workPosition),
    '  Prior alarm/error: ' + c.alarmCode + '/' + c.lastError,
    ...c.firmwareLines.map((line) => '  Firmware: ' + escapeCell(line)),
    ...runContextLines(run),
  ];
}

function runContextLines(run: ControllerIncidentContext['run']): ReadonlyArray<string> {
  return [
    '  Run: ' +
      escapeCell(run.id ?? 'none') +
      ', machine ' +
      (run.machineKind ?? 'not recorded') +
      ', epoch ' +
      run.streamerEpoch +
      ', status ' +
      (run.status ?? 'none'),
    '  Progress: completed ' +
      run.completed +
      '/' +
      run.total +
      ', next queued index ' +
      run.queueIndex +
      ', in-flight lines/bytes ' +
      run.inFlightLines +
      '/' +
      run.inFlightBytes,
    '  Pending ACKs/transport writes: ' +
      run.pendingUntrackedAcks +
      '/' +
      run.pendingTransportWrites +
      ' (store ' +
      run.storePendingTransportWrites +
      ', refill ' +
      run.refillPendingTransportWrites +
      ')',
  ];
}

function qualificationText(
  value: ControllerIncidentContext['controller']['qualification'],
): string {
  if (value === null) return 'not captured';
  const prefix = value.kind + ' (epoch ' + value.epoch + ')';
  if (value.kind === 'failed') return prefix + ': ' + value.message;
  if (value.kind === 'qualifying') return prefix + ': ' + value.phase;
  if (value.kind === 'qualified') return prefix + ': settings ' + value.settings;
  return prefix;
}

function escapeCell(value: string): string {
  return redactSupportReportText(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t');
}
