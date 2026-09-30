// Pictures taken while watching a job (ADR-490). A camera fixed over the bed
// with its own calibration gives flat pictures of the job's part of the bed,
// at the material height, exactly as trace from camera flattens them; any
// other camera (uncalibrated, or riding on the head) gives its plain frame.
// Timelapse frames are kept as JPEG, so a long job stays a few tens of MB.

import { warpFrameToBedImage } from '../../../core/camera/model/bed-image';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import { isHeadCameraModel } from '../../../core/camera/model/head-camera';
import { ownCameraModel } from '../active-camera-model';
import type { SurfaceHeightArea } from '../../../core/camera/model/height-areas';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { cameraModelForFrame } from '../camera-model-frame';
import {
  cameraCaptureBindingForFrame,
  captureSourceFrame,
  type ActiveCameraSource,
} from '../frame-source';

export type WatchCamera = {
  readonly source: ActiveCameraSource;
  /** The camera's own calibration when it is fixed over the bed; null otherwise. */
  readonly fixedModel: CameraModelRecord | null;
  readonly surfaceHeightMm: number;
  readonly heightAreas: ReadonlyArray<SurfaceHeightArea>;
};

/** The running camera as the job starts, or null when none is running. */
export function watchCameraNow(): WatchCamera | null {
  const camera = useCameraStore.getState();
  if (camera.sourceState.kind !== 'live') return null;
  const source = camera.sourceState.source;
  const own = ownCameraModel(useStore.getState().project.device, camera.sourceState);
  return {
    source,
    fixedModel: own !== undefined && !isHeadCameraModel(own) ? own : null,
    surfaceHeightMm: camera.surfaceHeightMm,
    heightAreas: camera.heightAreas,
  };
}

/** Whether `camera` is still the one running (it may be stopped or switched mid-job). */
export function watchCameraStillRunning(camera: WatchCamera): boolean {
  const state = useCameraStore.getState().sourceState;
  return state.kind === 'live' && state.source === camera.source;
}

export type FlatPicture =
  | { readonly kind: 'ok'; readonly image: RgbaImage }
  | { readonly kind: 'issue'; readonly message: string };

/** One frame flattened over `region`, or why it cannot be. */
export function flattenedPicture(
  camera: WatchCamera,
  frame: RgbaImage,
  region: BedArea,
  pixelsPerMm: number,
): FlatPicture {
  if (camera.fixedModel === null) {
    return { kind: 'issue', message: 'The camera needs to be fixed over the bed and calibrated.' };
  }
  const capture = cameraCaptureBindingForFrame(camera.source, frame.width, frame.height);
  const fitted = cameraModelForFrame(camera.fixedModel, capture, frame.width, frame.height);
  if (fitted.kind === 'issue') return fitted;
  const image = warpFrameToBedImage(frame, fitted.lens, fitted.pose, {
    region,
    pixelsPerMm,
    surfaceHeightMm: camera.surfaceHeightMm,
    heightAreas: camera.heightAreas,
  });
  return image === null
    ? { kind: 'issue', message: 'The camera does not see this part of the bed.' }
    : { kind: 'ok', image };
}

export type WatchIo = {
  readonly captureFrame: (source: ActiveCameraSource) => Promise<RgbaImage | null>;
  readonly encodeJpeg: (image: RgbaImage, maxSidePx: number) => Promise<Blob | null>;
  readonly now: () => number;
  readonly wait: (ms: number) => Promise<void>;
};

export const defaultWatchIo: WatchIo = {
  captureFrame: (source) => captureSourceFrame(source),
  encodeJpeg: encodeJpegPicture,
  now: () => Date.now(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const JPEG_QUALITY = 0.82;

/** `image` scaled to fit `maxSidePx` and encoded as JPEG; null when the browser cannot. */
export function encodeJpegPicture(image: RgbaImage, maxSidePx: number): Promise<Blob | null> {
  const full = document.createElement('canvas');
  full.width = image.width;
  full.height = image.height;
  const fullContext = full.getContext('2d');
  if (fullContext === null) return Promise.resolve(null);
  fullContext.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  const scale = Math.min(1, maxSidePx / Math.max(image.width, image.height));
  const canvas = scale < 1 ? document.createElement('canvas') : full;
  if (scale < 1) {
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) return Promise.resolve(null);
    context.imageSmoothingQuality = 'high';
    context.drawImage(full, 0, 0, canvas.width, canvas.height);
  }
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY);
    } catch {
      resolve(null);
    }
  });
}
