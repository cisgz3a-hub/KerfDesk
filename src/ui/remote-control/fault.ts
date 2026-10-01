import type { RemoteErrorCode } from './types';

const MESSAGES: Record<RemoteErrorCode, string> = {
  invalid_arguments: 'Invalid command arguments.',
  unsupported_command: 'This remote command is not supported.',
  unsupported_operation: 'This operation is not supported by the current remote tool.',
  stale_revision: 'The workspace changed. Read it again before editing.',
  request_conflict: 'This request ID was already used with different arguments.',
  request_limit:
    'This remote edit session reached its 256-request limit. Reconnect before editing again.',
  read_only: 'This remote connection does not have editing permission.',
  busy: 'The workspace is not available for remote editing.',
  cancelled: 'The remote request was cancelled.',
  unavailable: 'This information is not currently available.',
  not_found: 'The requested artwork or operation is no longer present.',
  not_editable: 'The requested artwork is locked or hidden.',
  failed: 'The remote command could not be completed.',
};
export class RemoteFault extends Error {
  constructor(readonly code: RemoteErrorCode) {
    super(MESSAGES[code]);
  }
}
