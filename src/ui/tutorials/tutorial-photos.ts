import { TUTORIAL_PHOTO_ASSETS } from './tutorial-photo-assets';

type Frame = { readonly label: string; readonly caption: string; readonly alt: string };
export type TutorialPhoto = {
  readonly asset: (typeof TUTORIAL_PHOTO_ASSETS)[keyof typeof TUTORIAL_PHOTO_ASSETS];
  readonly frames: readonly [Frame] | readonly [Frame, Frame, Frame];
};

/** Deliberate lesson bindings: a related lesson need not teach the same physical process. */
export const TUTORIAL_PHOTOS: Readonly<Partial<Record<string, TutorialPhoto>>> = {
  registration: {
    asset: TUTORIAL_PHOTO_ASSETS.registration,
    frames: [
      {
        label: 'Burn outline',
        caption:
          'Burn the placement outline onto wood first, with the leather keychain off the bed.',
        alt: 'A rectangular placement outline burned into a flat wooden backing. No leather keychain is on it yet.',
      },
      {
        label: 'Place leather',
        caption:
          'Place the leather keychain inside the burned outline. Keep the wood and machine origin fixed.',
        alt: 'A plain tan leather keychain sits exactly on the outline burned into the stationary wood.',
      },
      {
        label: 'Burn artwork',
        caption:
          'Burn the artwork onto the leather. The unchanged coordinates align it with the outline you made.',
        alt: 'The same leather keychain now has an engraved leaf design. The wooden backing stays in place.',
      },
    ],
  },
  'laser-cut': {
    asset: TUTORIAL_PHOTO_ASSETS['laser-line'],
    frames: [
      {
        label: 'Blank',
        caption: 'A Line operation follows the outline of your vector shape.',
        alt: 'An unmarked plywood sample.',
      },
      {
        label: 'Surface mark',
        caption:
          'One possible result is a thin mark along the perimeter; the middle stays untouched.',
        alt: 'A thin rectangular outline scored on intact wood.',
      },
      {
        label: 'Through-cut',
        caption:
          'A through-cut uses settings tested for the material. Line alone does not decide whether the piece cuts free.',
        alt: 'A rectangular piece removed from a matching opening in plywood.',
      },
    ],
  },
  'laser-fill': {
    asset: TUTORIAL_PHOTO_ASSETS['laser-fill'],
    frames: [
      {
        label: 'Boundary',
        caption:
          'The ring boundaries show the area to engrave. A separate outline burn is not needed.',
        alt: 'Two concentric circles indicate a ring-shaped area on wood.',
      },
      {
        label: 'Fill rows',
        caption: 'Scanline fill covers the ring in rows while leaving its centre clear.',
        alt: 'Parallel engraved rows cover the upper half of the ring; its centre remains clear.',
      },
      {
        label: 'Coverage',
        caption:
          'The filled ring keeps the inner opening clear. Real coverage depends on your tested line interval and settings.',
        alt: 'Engraved rows cover the full ring without engraving its centre.',
      },
    ],
  },
  'laser-image': {
    asset: TUTORIAL_PHOTO_ASSETS.raster,
    frames: [
      {
        label: 'Dithered example',
        caption:
          'Dot density represents shading in this dithered example. Grayscale mode instead varies laser power.',
        alt: 'A fox engraved as dots on wood, beside a close-up of the dotted eye and fur.',
      },
    ],
  },
  'cnc-pocket': {
    asset: TUTORIAL_PHOTO_ASSETS.pocket,
    frames: [
      {
        label: 'Pocket example',
        caption:
          'A pocket removes the enclosed area to a depth. A round cutter leaves rounded internal corners.',
        alt: 'A rectangular recess with a flat floor and rounded inside corners in a thick wood block.',
      },
    ],
  },
  'cnc-vcarve': {
    asset: TUTORIAL_PHOTO_ASSETS.vcarve,
    frames: [
      {
        label: 'V-carved example',
        caption:
          'A V-shaped cutter makes a wider groove as it goes deeper. These channels have sloping faces.',
        alt: 'Two tapered V-shaped grooves carved into wood, one narrower and shallower than the other.',
      },
    ],
  },
  box: {
    asset: TUTORIAL_PHOTO_ASSETS['box-result'],
    frames: [
      {
        label: 'Open-top example',
        caption:
          'An open-top box has a base and four walls joined at their edges. Test the joint clearance before cutting all the panels.',
        alt: 'An assembled open-top plywood box with interlocking finger joints.',
      },
    ],
  },
  'cnc-profile': {
    asset: TUTORIAL_PHOTO_ASSETS['profile-tabs'],
    frames: [
      {
        label: 'Profile with tabs',
        caption:
          'Profile follows the edge. This example leaves four holding tabs connecting the part to the waste.',
        alt: 'An oval cut around its outside edge, retained in the surrounding plywood by four bridges.',
      },
    ],
  },
  'cnc-tabs': {
    asset: TUTORIAL_PHOTO_ASSETS['profile-tabs'],
    frames: [
      {
        label: 'Holding tabs',
        caption:
          'Small bridges keep a cut part attached to the stock. Set their width, height and positions for your job.',
        alt: 'Four wood bridges hold an oval part inside the surrounding sheet after its perimeter is cut.',
      },
    ],
  },
};

export function tutorialPhotoUrl(file: string): string {
  return `${import.meta.env.BASE_URL}tutorial-images/${file}`;
}
