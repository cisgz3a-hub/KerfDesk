// Copy data for the Laser page (pages/laser.mjs). Every entry was checked
// against the app source on main: src/core/scene/layer.ts (operation fields),
// src/ui/layers/CutSettingsFillFields.tsx (fill styles, 0–180° scan angle,
// 90° cross-hatch), src/core/job/fill-rule.ts (even-odd holes),
// src/core/scene/scene-object.ts DITHER_ALGORITHMS + CutSettingsImageFields.tsx,
// src/core/raster/raster-units.ts + raster-budget.ts (5–25 lines/mm),
// src/ui/raster/ConvertToBitmapDialog.tsx, src/ui/trace/dialog-parts.tsx
// (preset descriptions), src/ui/layers/CutSettingsCommonFields.tsx (kerf and
// tabs on closed Line cuts), src/ui/laser/OriginRow.tsx, src/ui/calibration/*,
// src/ui/state/material-library-persistence.ts, src/core/devices/rotary.ts and
// src/ui/camera/*. Status wording follows ADR-322: no machine is verified.

import { statusPill } from '../lib/components.mjs';
import { html } from '../lib/html.mjs';

export const MODES = [
  {
    icon: 'spline',
    title: 'Line',
    body: 'Follows the outline of a shape to cut it out or score it. Add a kerf offset and holding tabs when you cut parts free.',
  },
  {
    icon: 'scan-line',
    title: 'Fill',
    body: 'Shades the inside of closed shapes with rows of parallel lines. Holes, like the middle of an O, stay clear.',
  },
  {
    icon: 'image',
    title: 'Image',
    body: 'Engraves a photo or other bitmap row by row, with 11 dither and grayscale options.',
    status: 'shipped-code-and-tests',
  },
];

export const FILL_STYLES = [
  {
    icon: 'scan-line',
    title: 'Scanline',
    body: 'Straight rows at any angle from 0 to 180°, at the spacing you choose. Scan in one direction or both.',
  },
  {
    icon: 'circle-dot',
    title: 'Follow Shape',
    body: 'Rings that follow the outline of each shape inward, instead of straight rows.',
  },
  {
    icon: 'shapes',
    title: 'Island Fill',
    body: 'Fills each separate part of your design on its own, rather than in rows across the whole design.',
  },
  {
    icon: 'grid-3x3',
    title: 'Cross-hatch',
    body: 'Adds a second set of rows at right angles to the first, over the same area.',
  },
];

export const IMAGE_FEATURES = [
  {
    icon: 'blend',
    title: 'Dithering and grayscale',
    body: 'Eleven options. Threshold, Floyd–Steinberg, Jarvis, Stucki, Atkinson, Burkes, three Sierra variants and ordered (Bayer) dithering turn shades into dots. Grayscale varies the laser power instead.',
  },
  {
    icon: 'grid-2x2',
    title: 'Resolution',
    body: 'From 5 to 25 lines per mm. Set it as a line interval or as DPI, and the other one follows.',
  },
  {
    icon: 'sliders-horizontal',
    title: 'Fine control',
    body: 'Dot-width correction, a minimum power for grayscale, inverted brightness, and Use original pixels to skip KerfDesk’s image processing.',
  },
  {
    icon: 'image-down',
    title: 'Convert to Bitmap',
    body: 'Turn vector art into an image and engrave it in Image mode. Choose Fill All, Outlines or Use Cut Settings, and set the DPI.',
  },
];

export const TRACE_PRESETS = [
  ['Line Art', 'A balanced start for logos, lettering and drawings. Keeps pale details.'],
  ['Smooth', 'Cleaner curves for rough or noisy artwork. Very fine gaps may close.'],
  ['Sharp', 'Crisp corners, fine lines and tiny marks, including small specks in the source.'],
  [
    'Centerline',
    'One path along the middle of each stroke, for single-line lettering and linework.',
  ],
  [
    'Edge Detection',
    'Outlines around dark artwork and local detail. Dark tones next to each other may merge.',
  ],
];

export const CUT_TOOLS = [
  {
    icon: 'vector-square',
    title: 'Kerf offset',
    body: 'Allow for the width of the beam on closed Line cuts. KerfDesk offsets the cut path and leaves your artwork unchanged.',
  },
  {
    icon: 'square-dashed',
    title: 'Holding tabs',
    body: 'Leave small uncut bridges on closed Line cuts, meant to keep parts in the sheet. Set the tab size and how many per shape, and leave holes without tabs if you like.',
  },
  {
    icon: 'crosshair',
    title: 'Set work origin',
    body: 'Jog the head to a corner of your workpiece and press Set origin here. That point becomes 0,0 for the job. Frame again after you set it.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'wind',
    title: 'Air assist',
    body: 'Turn air assist on or off for each operation. KerfDesk sends the air command your machine profile names.',
  },
];

export const RUN_STEPS = [
  {
    title: 'Preview',
    body: 'Press P. Cuts show in their operation colors and travel moves as dashed lines. Scrub through the route before anything moves.',
  },
  {
    title: 'Frame',
    body: 'Connect over USB and click Set up & Frame. With the laser off, the head moves around the rectangle this exact job covers, so you see where it lands on your material.',
  },
  {
    title: 'Review',
    body: 'The completed Frame unlocks Start. Press it and Job Review shows the time estimate, job size, settings and any warnings, such as artwork past the bed edge. You read them and decide.',
  },
  {
    title: 'Start',
    body: 'Choose Start job. Pause, Resume and Abort stay on screen while it runs, and Abort is a software stop, not an emergency stop. Change the artwork, placement or origin, and you Frame again.',
  },
];

export const MATERIAL_TOOLS = [
  {
    icon: 'library',
    title: 'Material libraries',
    body: 'Save an operation’s power, speed and other settings as a preset, then apply it to another operation. Keep several libraries in KerfDesk and save any of them to a file.',
  },
  {
    icon: 'flask-conical',
    title: 'Material Test',
    body: 'Builds a grid of swatches across a range of speeds and powers. Burn it on scrap and pick the square you like.',
  },
  {
    icon: 'ruler',
    title: 'Interval Test',
    body: 'Builds a set of swatches at different line intervals, all at one speed and power.',
  },
  {
    icon: 'file-image',
    title: 'LightBurn cut libraries',
    body: 'Import a LightBurn .clb library as material presets. The import replaces your active library.',
  },
];

export const EXTRAS = [
  {
    icon: 'cylinder',
    title: 'Rotary',
    body: 'Set up a roller or chuck rotary under Tools > Rotary Setup, with the object’s diameter and an option to reverse the spin. Job Review adds a warning when a rotary job includes image engraving.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'camera',
    title: 'Camera overlay',
    pro: true,
    body: 'Calibrate the lens with a printed checkerboard, align the camera to your bed, then place artwork over the camera’s view of your material. USB webcams work in the web and desktop apps. Network cameras need the desktop app.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'focus',
    title: 'Bed alignment',
    pro: true,
    body: 'Automatic alignment burns a marker target and finds it with the camera. It is an experiment you switch on in Tools > Labs. In the desktop app, you can also align a network camera by hand by clicking the four bed corners.',
    status: 'shipped-code-and-tests',
  },
];

export const STATUS_ROWS = [
  [
    'Sending jobs over USB',
    statusPill('hardware-verified'),
    'KerfDesk has been used to send jobs to a Creality Falcon A1 Pro with GRBL-family firmware. These were informal runs, not a repeatable qualification, and they don’t prove output quality. No stock GRBL 1.1 board has been tested.',
  ],
  [
    'Image engraving',
    statusPill('shipped-code-and-tests'),
    'Code and automated tests only. It hasn’t had a recorded test on a real machine yet.',
  ],
  [
    'Set work origin',
    statusPill('shipped-code-and-tests'),
    'Code and automated tests only. Not yet checked on a real machine, so Frame again after you set it.',
  ],
  [
    'Material and Interval Tests',
    statusPill('shipped-code-and-tests'),
    'They build the test pattern for you. The right settings depend on your machine and material.',
  ],
  [
    'Rotary',
    statusPill('shipped-code-and-tests'),
    'Never run on a physical rotary. Framing checks the motion outline only, not scale, direction, seam, focus or slip.',
  ],
  [
    'Camera alignment',
    statusPill('shipped-code-and-tests'),
    'Accuracy has not been measured on a real machine. Automatic alignment is a Labs experiment.',
  ],
  [
    'FluidNC, Marlin, Smoothieware',
    statusPill('simulator-only'),
    'Tested against firmware simulators only, never on a real controller.',
  ],
  [
    html`Ruida <code>.rd</code> export`,
    statusPill('shipped-code-and-tests'),
    'Experimental and vector-only, with no live connection. No real Ruida controller has accepted a file yet.',
  ],
];
