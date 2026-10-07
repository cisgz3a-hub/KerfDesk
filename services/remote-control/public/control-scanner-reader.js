const MAX_FRAME_SIDE = 960;

/** Frames stay in this page. Use the platform reader or our local QR decoder. */
export async function createScannerReader() {
  let native = await nativeReader();
  let fallback = null;
  let frames = 0;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  async function localRead(video) {
    fallback ??= await import('./control-scanner-decoder.js').then((module) => module.default);
    if (typeof fallback !== 'function' || !context) throw new Error('scanner_unavailable');
    const image = videoFrame(video, canvas, context);
    if (!image) return [];
    const found = fallback(image.data, image.width, image.height, {
      inversionAttempts: 'attemptBoth',
    });
    return typeof found?.data === 'string' ? [found.data] : [];
  }
  if (!native) {
    fallback = await import('./control-scanner-decoder.js').then((module) => module.default);
    if (typeof fallback !== 'function' || !context) throw new Error('scanner_unavailable');
  }
  return async (video) => {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return [];
    if (native) {
      try {
        const found = await native.detect(video);
        const values = found
          .map((item) => item.rawValue)
          .filter((item) => typeof item === 'string');
        if (values.length || ++frames % 4 !== 0) return values;
      } catch {
        native = null;
      }
    }
    return localRead(video);
  };
}

async function nativeReader() {
  const Detector = globalThis.BarcodeDetector;
  if (typeof Detector !== 'function') return null;
  try {
    if (
      typeof Detector.getSupportedFormats === 'function' &&
      !(await Detector.getSupportedFormats()).includes('qr_code')
    )
      return null;
    return new Detector({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

function videoFrame(video, canvas, context) {
  const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  if (!canvas.width || !canvas.height) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
