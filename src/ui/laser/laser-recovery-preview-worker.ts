import {
  packedManifestTransferables,
  packRecoveryPreviewManifest,
  type LaserRecoveryPreviewReply,
  type LaserRecoveryPreviewRequest,
} from './laser-recovery-preview-protocol';

// One request per worker: the client terminates it after the reply, so a
// large image route never keeps parser allocations alive on the UI thread.
self.onmessage = (event: MessageEvent<LaserRecoveryPreviewRequest>): void => {
  let reply: LaserRecoveryPreviewReply;
  try {
    reply = { value: packRecoveryPreviewManifest(event.data) };
  } catch (error) {
    reply = { error: error instanceof Error ? error.message : String(error) };
  }
  if ('value' in reply) {
    self.postMessage(reply, { transfer: packedManifestTransferables(reply.value) });
  } else {
    self.postMessage(reply);
  }
};
