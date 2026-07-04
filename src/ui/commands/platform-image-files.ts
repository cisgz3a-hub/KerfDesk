import type { FileHandle, PlatformAdapter } from '../../platform/types';

const IMAGE_FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg'] as const;

export async function pickPlatformImageFile(platform: PlatformAdapter): Promise<File | null> {
  const files = await pickPlatformImageFiles(platform, false);
  return files[0] ?? null;
}

export async function pickPlatformImageFiles(
  platform: PlatformAdapter,
  multiple = true,
): Promise<ReadonlyArray<File>> {
  const handles = await platform.pickFilesForOpen({
    accept: IMAGE_FILE_EXTENSIONS,
    multiple,
  });
  const files: File[] = [];
  for (const handle of handles) {
    files.push(await fileFromHandle(handle));
  }
  return files;
}

async function fileFromHandle(handle: FileHandle): Promise<File> {
  if (handle.blob === undefined) {
    throw new Error(`Platform file handle for ${handle.name} does not expose binary data.`);
  }
  const blob = await handle.blob();
  if (typeof File === 'function' && blob instanceof File && blob.name === handle.name) {
    return blob;
  }
  return new File([blob], handle.name, { type: blob.type });
}
