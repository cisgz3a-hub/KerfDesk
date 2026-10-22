// Fixed status texts for a remote-settings save that failed (ADR-657). No native
// error text reaches the renderer.

export const SAVE_FAILED = 'Remote settings could not be saved securely.';

/** Disable or Revoke was not saved, so the saved record was removed instead. */
export const REVOCATION_SAVE_FAILED =
  'The revocation could not be saved securely, so remote access was shut and its saved pairing ' +
  'removed. No paired phone or assistant can reconnect with it. Restart KerfDesk to set up ' +
  'remote access again.';

/** Neither the revocation nor the removal reached the disk. */
export const REVOCATION_STUCK =
  'The revocation could not be saved securely, and the saved pairing could not be removed. ' +
  'Remote access is shut, but paired phones may reconnect after a restart. Fix the disk, then ' +
  'restart and use Revoke all connections.';
