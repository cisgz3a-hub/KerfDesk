import { pageCanvas } from './paged-artwork-source';

export function isGif(file: Pick<File, 'name' | 'type'>): boolean {
  return (
    file.type === 'image/gif' ||
    (file.type !== 'image/png' && file.name.toLowerCase().endsWith('.gif'))
  );
}

/** createImageBitmap's animation contract selects the default/first frame. */
export async function freezeGif(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = pageCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Could not create a still image from this GIF.');
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value === null ? reject(new Error('Could not encode GIF frame.')) : resolve(value),
        'image/png',
      ),
    );
    return new File([blob], file.name, { type: 'image/png' });
  } finally {
    bitmap.close();
  }
}
