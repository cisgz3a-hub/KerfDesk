/** Permission errors are described without exposing a decoder payload or device details. */
export function cameraMessage(error) {
  if (['NotAllowedError', 'SecurityError'].includes(error?.name))
    return 'Camera access was not allowed. Allow the camera in your browser settings, or paste a pairing link or code.';
  if (['NotFoundError', 'OverconstrainedError'].includes(error?.name))
    return 'No usable camera was found. Open the pairing link from the PC or enter the computer ID and code.';
  if (error?.name === 'NotReadableError')
    return 'The camera is busy or unavailable. Close another camera app and try again, or enter the pairing code.';
  return 'The camera could not start. Try again, use your phone camera to open the PC’s QR code, or enter the code.';
}

export function stopCamera(stream) {
  for (const track of stream?.getTracks() ?? []) {
    try {
      track.stop();
    } catch {
      // Cleanup must continue if one browser track has already been released.
    }
  }
}

export function cameraAvailable() {
  return globalThis.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export function requestCamera() {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
}
