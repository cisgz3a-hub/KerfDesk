import type { Mat3 } from '../../../../core/camera/homography';
import {
  orderQuadCorners,
  orientReference,
  photoToMm,
} from '../../../../core/camera/board-photo/photo-quad';
import { rectifiedRegion, rectifyPhoto } from '../../../../core/camera/board-photo/rectify-photo';
import { straightDownToMm } from '../../../../core/camera/board-photo/trace-board';
import type { Vec2 } from '../../../../core/scene';

export type ReferenceKind = 'a4' | 'letter' | 'custom' | 'skip';
export type LoadedImage = {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};
export type TraceState = {
  readonly toMm: Mat3;
  readonly region: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly pixelsPerMm: number;
  readonly rectified: LoadedImage;
  readonly coarse: boolean;
};

export function beginRectify(args: {
  readonly image: LoadedImage | null;
  readonly corners: ReadonlyArray<Vec2>;
  readonly reference: ReferenceKind;
  readonly customWidth: string;
  readonly customHeight: string;
  readonly setBusy: (value: boolean) => void;
  readonly setError: (value: string | null) => void;
  readonly setTrace: (value: TraceState | null) => void;
}): void {
  if (args.image === null) return;
  const image = args.image;
  args.setBusy(true);
  args.setError(null);
  setTimeout(() => {
    const base = referenceSize(args.reference, Number(args.customWidth), Number(args.customHeight));
    if (!(base.widthMm > 0) || !(base.heightMm > 0)) {
      args.setError('Enter a positive reference width and height.');
      args.setBusy(false);
      return;
    }
    const quad = orderQuadCorners(args.corners);
    const ref =
      quad === null || args.reference === 'skip'
        ? base
        : orientReference(quad, base.widthMm, base.heightMm);
    const toMm =
      args.reference === 'skip'
        ? straightDownToMm(image.width, image.height)
        : quad === null
          ? null
          : photoToMm(quad, ref);
    if (toMm === null) {
      args.setError('Click four distinct corners of the reference sheet.');
      args.setBusy(false);
      return;
    }
    const info = rectifiedRegion(image.width, image.height, toMm, ref);
    args.setTrace({
      ...info,
      toMm,
      rectified: rectifyPhoto(image, toMm, info.region, info.pixelsPerMm),
    });
    args.setBusy(false);
  }, 0);
}

function referenceSize(
  kind: ReferenceKind,
  customWidth: number,
  customHeight: number,
): { widthMm: number; heightMm: number } {
  if (kind === 'letter') return { widthMm: 215.9, heightMm: 279.4 };
  if (kind === 'custom') return { widthMm: customWidth, heightMm: customHeight };
  return { widthMm: 210, heightMm: 297 };
}
