export type RendererCloseOperation = 'prepare' | 'approve' | 'cancel';

/** Fixed renderer-only operation; no renderer-to-main IPC or privileged API. */
export function rendererCloseRequestScript(
  operation: RendererCloseOperation,
  requestId: number,
): string {
  const data = JSON.stringify({ operation, requestId });
  return `new Promise((resolve) => {
    const event = new CustomEvent('kerfdesk:desktop-close', {
      cancelable: true,
      detail: { ...${data}, respond: resolve }
    });
    if (window.dispatchEvent(event)) resolve({ status: 'unavailable' });
  })`;
}

export function rendererCloseReply(value: unknown): {
  readonly status: 'ready' | 'approved' | 'cancelled' | 'retry' | 'unavailable';
  readonly dirty: boolean;
} {
  if (typeof value !== 'object' || value === null || !('status' in value)) {
    return { status: 'unavailable', dirty: false };
  }
  if (value.status === 'ready' && 'dirty' in value && typeof value.dirty === 'boolean') {
    return { status: 'ready', dirty: value.dirty };
  }
  if (value.status === 'approved' || value.status === 'cancelled' || value.status === 'retry') {
    return { status: value.status, dirty: false };
  }
  return { status: 'unavailable', dirty: false };
}
