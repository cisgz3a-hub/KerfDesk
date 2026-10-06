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
]);
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
  if (command === 'abort_job') return keys(args, ['requestId']);
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
  if (command === 'frame_job' || command === 'review_machine_job') return keys(args, admission);
  if (command === 'start_job')
    return keys(args, [...admission, 'reviewId']) && uuid(args['reviewId']);
  return validJog(args, admission);
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
