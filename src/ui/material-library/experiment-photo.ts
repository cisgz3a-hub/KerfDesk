import type { ExperimentPhoto } from '../../core/material-library/material-experiment';
import { MAX_EXPERIMENT_PHOTO_CHARS } from '../../io/material-library/material-experiment-io';

/** Portable result evidence, resized locally; no remote request or recognition. */
export async function readExperimentPhoto(file: File): Promise<ExperimentPhoto> {
  if (file.size > 20_000_000) throw new Error('Choose a photo smaller than 20 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Photo processing is unavailable in this browser.');
    // Pixel background, not UI chrome: composite transparent source pixels onto white evidence paper.
    // eslint-disable-next-line no-restricted-syntax
    context.fillStyle = 'rgb(255, 255, 255)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if (dataUrl.length > MAX_EXPERIMENT_PHOTO_CHARS)
      throw new Error('This photograph is too large to retain in the library. Try a smaller crop.');
    return { dataUrl, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}
