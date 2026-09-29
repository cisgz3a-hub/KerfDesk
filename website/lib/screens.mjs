// Real KerfDesk screenshots, captured from the running app (never mocked up)
// with a sample coaster project built through the real UI. Width and height are
// the published pixel size; alt text describes only what is visible.

import { screenshot } from './components.mjs';

const SIZE = { width: 1920, height: 1200 };

export const SCREENS = {
  workspace: {
    file: 'img/screens/workspace.webp',
    alt: 'KerfDesk design view: a round Cabin 1972 coaster with mountains and pines on the canvas, four laser operations listed at right',
  },
  preview: {
    file: 'img/screens/preview.webp',
    alt: 'KerfDesk laser preview of the coaster: engrave fills, cut and score paths, and a job time estimate',
  },
  gcode3d: {
    file: 'img/screens/gcode-3d.webp',
    alt: 'G-code 3D view of the coaster job in perspective, toolpaths colored by feed rate, with a 12:58 playback estimate',
  },
  cnc: {
    file: 'img/screens/cnc.webp',
    alt: 'KerfDesk CNC 3D cut preview, a simulation: the coaster’s shapes pocketed, lines engraved, lettering V-carved and a profile cut around the outline on 120 × 120 mm stock',
  },
  trace: {
    file: 'img/screens/trace.webp',
    alt: 'The Trace Image dialog turning a leaf drawing into vector outlines with the Line Art preset',
  },
  box: {
    file: 'img/screens/box.webp',
    alt: 'Box Generator set up for a 120 × 80 × 50 mm finger-joint box, with an assembled preview showing one divider',
  },
};

export function shot(ctx, key, { caption, eager } = {}) {
  const entry = SCREENS[key];
  if (!entry) throw new Error(`Unknown screenshot: ${key}`);
  return screenshot({ src: ctx.asset(entry.file), alt: entry.alt, ...SIZE, caption, eager });
}
