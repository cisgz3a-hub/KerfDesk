const pairingRejectedMessage =
  'The connection request was not accepted. On the PC, check that Phone & MCP says Ready to pair, or Connected to the remote service in older versions. Match its computer ID and latest pairing code exactly, including capitals. If the code was replaced or already used, create a new one and try again.';

export function rejectedMessage(path) {
  return path === '/api/pair/claim'
    ? pairingRejectedMessage
    : 'This connection does not have permission. Check its approved access in Phone & MCP on the PC, then refresh this page.';
}

export function pairingDeadline(expiresInMs) {
  if (!Number.isSafeInteger(expiresInMs) || expiresInMs <= 0 || expiresInMs > 300_000)
    throw new Error('Pairing is unavailable. Refresh this page and create a new code on the PC.');
  return performance.now() + expiresInMs;
}
