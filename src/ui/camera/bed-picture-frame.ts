// A head camera's stitched picture of the bed (ADR-449) and the burn check's
// picture (ADR-490) are flat pictures in scene millimetres, drawn with no
// camera model in between. Scene millimetres name places on the bed only
// through the bed frame and the machine they were taken on, so each picture
// records both. After a bed-size or native-offset change it is drawn moved
// with the bed, as the camera model is (ADR-440 Amendment 1). After an origin
// change, which mirrors the bed, or on another machine, it is dropped. Either
// way a notice says so (ADR-440 Amendment 5, rolling audit v3 G6-P2-3).
// Each picture was also flattened at the material height and height areas set
// when it was taken, and has no camera left to flatten it again; once those
// differ over its part of the bed, it is dropped too (ADR-449 Amendment 2).

import { useMemo } from 'react';
import { bedAreaInBedFrame, type CameraBedFrame } from '../../core/camera/model/camera-bed-frame';
import type { BedArea } from '../../core/camera/model/camera-model-accuracy';
import type { SurfaceHeightArea } from '../../core/camera/model/height-areas';
import type { DeviceProfile } from '../../core/devices';
import { useStore } from '../state';
import { useCameraStore, type BedPicture, type BedPictureTaken } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { cameraBedFrameFor, selectNativeBedEvidence } from '../state/native-bed-frame';
import { useToastStore } from '../state/toast-store';
import { cameraBedFrameNow, useCameraBedFrame } from './camera-bed-frame-now';

/** The bed frame and machine a picture taken now belongs to. */
export function bedPictureTakenNow(): BedPictureTaken {
  return takenIn(useStore.getState().project.device, cameraBedFrameNow());
}

function takenIn(device: DeviceProfile, bedFrame: CameraBedFrame): BedPictureTaken {
  return { bedFrame, machine: device.profileId ?? device.name };
}

export type BedPictureNow =
  | { readonly kind: 'shown'; readonly region: BedArea; readonly movedMm: number }
  | { readonly kind: 'dropped'; readonly message: string };

const SAME_MM = 1e-6;

/** The heights the camera flattens at now, as the camera store holds them. */
export type PictureHeights = Pick<BedPicture, 'surfaceHeightMm' | 'heightAreas'>;

/**
 * Where `picture` lies on the bed as the machine is set up `now`, or why it
 * cannot be shown; with `heights`, also dropped when it was flattened at others.
 */
export function bedPictureNow(
  picture: BedPicture,
  now: BedPictureTaken,
  heights?: PictureHeights,
): BedPictureNow {
  if (picture.taken.machine !== now.machine) return { kind: 'dropped', message: OTHER_MACHINE };
  const region = bedAreaInBedFrame(picture.region, picture.taken.bedFrame, now.bedFrame);
  if (region === null) return { kind: 'dropped', message: ORIGIN_CHANGED };
  if (heights !== undefined && !sameHeights(picture, heights, region)) {
    return { kind: 'dropped', message: HEIGHTS_CHANGED };
  }
  const movedMm = Math.hypot(region.x - picture.region.x, region.y - picture.region.y);
  return { kind: 'shown', region, movedMm: movedMm < SAME_MM ? 0 : movedMm };
}

/** The part of the bed `picture` shows, in scene mm now; null when it cannot be shown. */
export function useBedPictureRegion(picture: BedPicture): BedArea | null {
  const device = useStore((s) => s.project.device);
  const frameNow = useCameraBedFrame();
  const surfaceHeightMm = useCameraStore((s) => s.surfaceHeightMm);
  const heightAreas = useCameraStore((s) => s.heightAreas);
  return useMemo(() => {
    const placed = bedPictureNow(picture, takenIn(device, frameNow), {
      surfaceHeightMm,
      heightAreas,
    });
    return placed.kind === 'shown' ? placed.region : null;
  }, [picture, device, frameNow, surfaceHeightMm, heightAreas]);
}

/**
 * Drops a bed picture that cannot be shown now, and says when one is drawn
 * moved, once per picture and distance. Installed with the camera helpers.
 */
export function followBedPictureFrame(): () => void {
  let seen: readonly unknown[] = [];
  let announced: { readonly picture: BedPicture; readonly mm: number } | null = null;
  const check = (): void => {
    const { bedPicture: picture, surfaceHeightMm, heightAreas } = useCameraStore.getState();
    const { device } = useStore.getState().project;
    // The same snapshot until a connect, settings read or Home changes it.
    const evidence = selectNativeBedEvidence(useLaserStore.getState());
    const inputs = [picture, device, evidence, surfaceHeightMm, heightAreas];
    if (inputs.every((input, i) => input === seen[i])) return;
    seen = inputs;
    if (picture === null) return;
    const placed = bedPictureNow(picture, takenIn(device, cameraBedFrameFor(device, evidence)), {
      surfaceHeightMm,
      heightAreas,
    });
    if (placed.kind === 'dropped') {
      useCameraStore.getState().setBedPicture(null);
      notify(placed.message, 'warning');
      return;
    }
    const mm = Math.round(placed.movedMm * 10) / 10;
    if (mm === 0 || (announced?.picture === picture && announced.mm === mm)) return;
    announced = { picture, mm };
    notify(movedMessage(picture.taken.bedFrame, device, mm), 'info');
  };
  const stops = [
    useCameraStore.subscribe(check),
    useStore.subscribe(check),
    useLaserStore.subscribe(check),
  ];
  return () => stops.forEach((stop) => stop());
}

function notify(message: string, variant: 'info' | 'warning'): void {
  useToastStore.getState().pushToast(message, variant, { key: 'bed-picture-frame' });
}

export const OTHER_MACHINE =
  'The bed picture was cleared: it was taken on another machine, so it would not line up with the burn. Capture the bed again.';
export const ORIGIN_CHANGED =
  'The bed picture was cleared: Machine Setup now has the origin at another corner, so the picture would be mirrored against the burn. Capture the bed again.';
export const HEIGHTS_CHANGED =
  'The bed picture was cleared: it was flattened at another material height or other raised objects, so it would not line up with the burn. Capture the bed again.';

// The heights over the picture's own part of the bed; an area elsewhere
// changes nothing in it.
function sameHeights(picture: BedPicture, now: PictureHeights, regionNow: BedArea): boolean {
  if (picture.surfaceHeightMm !== now.surfaceHeightMm) return false;
  const then = areasOver(picture.region, picture.heightAreas);
  const current = areasOver(regionNow, now.heightAreas);
  // The displayed image and its captured height areas move together. Current
  // areas are already in today's frame; compare the same physical bed patch.
  const dx = regionNow.x - picture.region.x;
  const dy = regionNow.y - picture.region.y;
  return (
    then.length === current.length &&
    then.every((area, i) => {
      const other = current[i];
      return (
        other !== undefined &&
        Math.abs(area.x + dx - other.x) < SAME_MM &&
        Math.abs(area.y + dy - other.y) < SAME_MM &&
        area.width === other.width &&
        area.height === other.height &&
        area.surfaceHeightMm === other.surfaceHeightMm
      );
    })
  );
}

function areasOver(
  region: BedArea,
  areas: ReadonlyArray<SurfaceHeightArea>,
): ReadonlyArray<SurfaceHeightArea> {
  return areas.filter(
    (area) =>
      area.x < region.x + region.width &&
      area.x + area.width > region.x &&
      area.y < region.y + region.height &&
      area.y + area.height > region.y,
  );
}

function movedMessage(taken: CameraBedFrame, device: DeviceProfile, mm: number): string {
  const sameBed = taken.bedWidthMm === device.bedWidth && taken.bedHeightMm === device.bedHeight;
  const when = sameBed
    ? 'with other machine travel settings'
    : `on a ${round(taken.bedWidthMm)} × ${round(taken.bedHeightMm)} mm bed`;
  return `The bed picture was taken ${when}. KerfDesk moves it ${mm} mm to match the machine as it is set up now.`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
