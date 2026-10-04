import type { RemoteWriteCommand, RemoteReadCommand, RemoteWrite } from './types';
import { validTextPatch } from './text-validation';
import { RemoteFault } from './fault';

const READS = new Set([
  'get_workspace',
  'get_workspace_preview',
  'list_fonts',
  'get_text',
  'get_machine',
  'get_app_status',
  'list_material_recipes',
  'review_job',
]);
const WRITES = new Set([
  'set_selection',
  'add_text',
  'add_rectangle',
  'transform_artwork',
  'update_operation',
  'update_text',
  'arrange_artwork',
  'undo',
  'redo',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RecordValue = Record<string, unknown>;
export type ValidatedCommand =
  | {
      readonly command: Exclude<RemoteReadCommand, 'get_text'>;
      readonly args: Record<string, never>;
    }
  | { readonly command: 'get_text'; readonly args: { readonly artworkId: string } }
  | RemoteWrite;

export function record(value: unknown): value is RecordValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
export function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
export function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
export function keys(value: RecordValue, expected: readonly string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function ids(value: unknown, min = 0): boolean {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= 200 &&
    value.every(identifier) &&
    new Set(value).size === value.length
  );
}
const coordinate = (value: unknown) => finite(value, -100_000, 100_000);
const size = (value: unknown) => finite(value, Number.MIN_VALUE, 100_000);
const admissionKeys = ['expectedRevision', 'requestId'];

/** Strict, bounded JSON contract; never echo user keys or values in errors. */
export function validateCommand(command: string, args: unknown): ValidatedCommand {
  if (!READS.has(command) && !WRITES.has(command)) throw new RemoteFault('unsupported_command');
  if (!record(args)) throw new RemoteFault('invalid_arguments');
  const valid = READS.has(command)
    ? command === 'get_text'
      ? keys(args, ['artworkId']) && identifier(args['artworkId'])
      : keys(args, [])
    : validWrite(command as RemoteWriteCommand, args);
  if (!valid) throw new RemoteFault('invalid_arguments');
  // Detach from callers before any async font work or dedup bookkeeping.
  return JSON.parse(JSON.stringify({ command, args })) as ValidatedCommand;
}

const WRITE_FIELDS: Record<RemoteWriteCommand, readonly string[]> = {
  set_selection: ['artworkIds'],
  add_rectangle: ['xMm', 'yMm', 'widthMm', 'heightMm'],
  add_text: ['xMm', 'yMm', 'widthMm', 'text', 'fontSizeMm'],
  transform_artwork: ['artworkIds', 'transform'],
  update_operation: ['operationId', 'patch'],
  update_text: ['artworkId', 'patch'],
  arrange_artwork: ['artworkIds', 'action'],
  undo: [],
  redo: [],
};
function validWrite(command: RemoteWriteCommand, args: RecordValue): boolean {
  if (
    typeof args['expectedRevision'] !== 'string' ||
    args['expectedRevision'].length < 1 ||
    args['expectedRevision'].length > 200 ||
    typeof args['requestId'] !== 'string' ||
    !UUID.test(args['requestId']) ||
    !keys(args, [
      ...admissionKeys,
      ...WRITE_FIELDS[command],
      ...(command === 'add_text' && Object.hasOwn(args, 'fontId') ? ['fontId'] : []),
    ])
  )
    return false;
  return writeValues(command, args);
}
function writeValues(command: RemoteWriteCommand, args: RecordValue): boolean {
  return WRITE_VALUES[command](args);
}
const WRITE_VALUES: Record<RemoteWriteCommand, (args: RecordValue) => boolean> = {
  set_selection: (args) => ids(args['artworkIds']),
  add_rectangle: (args) => positionAndWidth(args) && size(args['heightMm']),
  add_text: textValues,
  transform_artwork: (args) => ids(args['artworkIds'], 1) && validTransform(args['transform']),
  update_operation: (args) => identifier(args['operationId']) && validPatch(args['patch']),
  update_text: (args) => identifier(args['artworkId']) && validTextPatch(args['patch']),
  arrange_artwork: (args) =>
    ids(args['artworkIds'], 1) && ARRANGE_ACTIONS.has(args['action'] as string),
  undo: () => true,
  redo: () => true,
};
function textValues(args: RecordValue): boolean {
  return (
    positionAndWidth(args) &&
    typeof args['text'] === 'string' &&
    args['text'].length > 0 &&
    args['text'].length <= 4096 &&
    finite(args['fontSizeMm'], Number.MIN_VALUE, 1000) &&
    (args['fontId'] === undefined || identifier(args['fontId']))
  );
}

const ARRANGE_ACTIONS = new Set([
  'align_left',
  'align_center',
  'align_right',
  'align_top',
  'align_middle',
  'align_bottom',
  'distribute_horizontal',
  'distribute_vertical',
  'mirror_horizontal',
  'mirror_vertical',
  'group',
  'ungroup',
  'duplicate',
  'delete',
]);
function positionAndWidth(args: RecordValue): boolean {
  return coordinate(args['xMm']) && coordinate(args['yMm']) && size(args['widthMm']);
}
function validTransform(value: unknown): boolean {
  if (!record(value)) return false;
  switch (value['type']) {
    case 'move':
      return (
        keys(value, ['type', 'dxMm', 'dyMm']) &&
        coordinate(value['dxMm']) &&
        coordinate(value['dyMm'])
      );
    case 'resize':
      return (
        keys(value, ['type', 'widthMm', 'heightMm']) &&
        size(value['widthMm']) &&
        size(value['heightMm'])
      );
    case 'rotate':
      return keys(value, ['type', 'angleDeg']) && finite(value['angleDeg'], -36_000, 36_000);
    default:
      return false;
  }
}
function validPatch(value: unknown): boolean {
  if (!record(value) || Object.keys(value).length === 0) return false;
  return Object.entries(value).every(([key, field]) => {
    switch (key) {
      case 'powerPercent':
        return finite(field, 0, 100);
      case 'speedMmPerMin':
        return finite(field, Number.MIN_VALUE, 100_000);
      case 'passes':
        return finite(field, 1, 1000) && Number.isInteger(field);
      case 'enabled':
        return typeof field === 'boolean';
      default:
        return false;
    }
  });
}

export function canonicalRequest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRequest).join(',')}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalRequest(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
