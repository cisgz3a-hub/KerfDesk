// Camera snapshot save (F-CAM9): grab one frame from the active source and
// write it as a PNG through the platform save dialog — for material records,
// support requests, and checking the camera's view outside the app.

import type { FileSaveRequest, SaveTarget } from '../../platform/types';
import { captureSourceFrame, type ActiveCameraSource } from './frame-source';
import type { FrameCaptureIo } from './decode-jpeg';
import { pngDataUrlToBlob, rgbaToPngDataUrl } from './png-encode';

export type SnapshotResult = 'saved' | 'cancelled' | 'capture-failed' | 'encode-failed';

type SavePicker = {
  readonly pickFileForSave: (req: FileSaveRequest) => Promise<SaveTarget | null>;
};

export async function saveCameraSnapshot(
  source: ActiveCameraSource,
  platform: SavePicker,
  io?: FrameCaptureIo,
): Promise<SnapshotResult> {
  const frame = await captureSourceFrame(source, io);
  if (frame === null) return 'capture-failed';
  const dataUrl = rgbaToPngDataUrl(frame);
  const blob = dataUrl === null ? null : pngDataUrlToBlob(dataUrl);
  if (blob === null) return 'encode-failed';
  const target = await platform.pickFileForSave({
    suggestedName: 'camera-snapshot.png',
    extensions: ['.png'],
  });
  if (target === null) return 'cancelled';
  await target.write(blob);
  return 'saved';
}
