import { finite, keys, record } from './validation';
import { RemoteFault } from './fault';
import type { MachineCommand } from './machine-types';

export const MACHINE_COMMANDS = new Set([
  'get_machine_status',
  'get_control_operation',
  'jog_machine',
  'frame_job',
  'review_machine_job',
  'start_job',
  'abort_job',
  'connect_machine',
  'disconnect_machine',
  'home_machine',
  'set_work_origin',
  'pause_job',
  'resume_job',
  'jog_hold_start',
  'jog_hold_stop',
]);
/** Reachable after artwork edits, like Abort: they act on the running job, not the document. */
const NO_REVISION = new Set(['abort_job', 'pause_job', 'resume_job']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export function validateMachineCommand(command: string, args: unknown): MachineCommand {
  if (!MACHINE_COMMANDS.has(command)) throw new RemoteFault('unsupported_command');
  if (!record(args)) throw new RemoteFault('invalid_arguments');
  if (!valid(command, args)) throw new RemoteFault('invalid_arguments');
  return JSON.parse(JSON.stringify({ command, args })) as MachineCommand;
}
function valid(command: string, args: Record<string, unknown>): boolean {
  if (command === 'get_machine_status') return keys(args, []);
  if (command === 'get_control_operation') return validReceipt(args);
  if (!uuid(args['requestId'])) return false;
  if (NO_REVISION.has(command)) return keys(args, ['requestId']);
  if (command === 'jog_hold_stop')
    return keys(args, ['requestId', 'operationId']) && uuid(args['operationId']);
  if (!validRevision(args['expectedRevision'])) return false;
  return validAction(command, args);
}
function validRevision(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200;
}
function validReceipt(args: Record<string, unknown>): boolean {
  const page = args['reviewPage'];
  return (
    keys(args, ['operationId', ...(page === undefined ? [] : ['reviewPage'])]) &&
    uuid(args['operationId']) &&
    (page === undefined || validReviewPage(page))
  );
}
function validReviewPage(page: unknown): boolean {
  return (
    record(page) &&
    keys(page, ['reviewId', 'offset']) &&
    uuid(page['reviewId']) &&
    Number.isSafeInteger(page['offset']) &&
    (page['offset'] as number) >= 0
  );
}
function validAction(command: string, args: Record<string, unknown>): boolean {
  const admission = ['expectedRevision', 'requestId'];
  if (
    [
      'frame_job',
      'review_machine_job',
      'connect_machine',
      'disconnect_machine',
      'home_machine',
    ].includes(command)
  )
    return keys(args, admission);
  if (command === 'start_job')
    return keys(args, [...admission, 'reviewId']) && uuid(args['reviewId']);
  if (command === 'set_work_origin')
    return keys(args, [...admission, 'axes']) && (args['axes'] === 'xy' || args['axes'] === 'z');
  if (command === 'jog_hold_start') return validHold(args, admission);
  return validJog(args, admission);
}
function validHold(args: Record<string, unknown>, admission: readonly string[]): boolean {
  return (
    keys(args, [
      ...admission,
      'axis',
      'direction',
      ...(args['feedMmPerMin'] === undefined ? [] : ['feedMmPerMin']),
    ]) &&
    ['x', 'y', 'z'].includes(String(args['axis'])) &&
    (args['direction'] === -1 || args['direction'] === 1) &&
    (args['feedMmPerMin'] === undefined || finite(args['feedMmPerMin'], 1, 100_000))
  );
}
function validJog(args: Record<string, unknown>, admission: readonly string[]): boolean {
  return (
    keys(args, [
      ...admission,
      'axis',
      'direction',
      'distanceMm',
      ...(args['feedMmPerMin'] === undefined ? [] : ['feedMmPerMin']),
    ]) &&
    ['x', 'y', 'z'].includes(String(args['axis'])) &&
    (args['direction'] === -1 || args['direction'] === 1) &&
    finite(args['distanceMm'], 0.01, 100) &&
    (args['feedMmPerMin'] === undefined || finite(args['feedMmPerMin'], 1, 100_000))
  );
}
