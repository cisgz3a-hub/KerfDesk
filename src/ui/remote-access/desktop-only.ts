/** Phone & MCP runs only in the packaged desktop renderer, which owns the relay bridge. */
export function isRemoteAccessRenderer(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'app:';
}
