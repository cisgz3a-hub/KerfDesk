// Bound decoded HTTP frame bytes while reading; Content-Length is only an
// early rejection hint, never permission to buffer an unbounded response.
export const MAX_CAMERA_FRAME_BYTES = 8 * 1024 * 1024;

const FRAME_TOO_LARGE = 'Camera frame is too large.';

export async function cancelCameraFrameBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export async function readCameraFrameBody(response: Response): Promise<Buffer> {
  const declaredLength = response.headers.get('content-length')?.trim();
  if (
    declaredLength !== undefined &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_CAMERA_FRAME_BYTES
  ) {
    await cancelCameraFrameBody(response);
    throw new Error(FRAME_TOO_LARGE);
  }
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  let bytes = Buffer.alloc(0);
  let totalBytes = 0;
  let complete = false;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        complete = true;
        return bytes.subarray(0, totalBytes);
      }
      if (result.value.byteLength > MAX_CAMERA_FRAME_BYTES - totalBytes) {
        throw new Error(FRAME_TOO_LARGE);
      }
      const requiredBytes = totalBytes + result.value.byteLength;
      if (requiredBytes > bytes.length) {
        const capacity = Math.min(
          MAX_CAMERA_FRAME_BYTES,
          Math.max(requiredBytes, bytes.length * 2, 1024),
        );
        const next = Buffer.allocUnsafe(capacity);
        bytes.copy(next, 0, 0, totalBytes);
        bytes = next;
      }
      bytes.set(result.value, totalBytes);
      totalBytes = requiredBytes;
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
