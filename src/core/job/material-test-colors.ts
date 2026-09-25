// Color keys for calibration tests that join an existing project. A project
// keeps one operation per color, and artwork without operation ids still binds
// by color, so a test operation must avoid every layer color and every artwork
// color already present: reusing black for the labels would pull the
// operator's legacy black artwork into the label operation.

import type { Scene } from '../scene';

/** Returns the first free `#rrggbb` at or after `base`, never repeating one. */
export function materialTestColorAllocator(
  reserved: ReadonlySet<string> | undefined,
): (base: number) => string {
  const used = new Set([...(reserved ?? [])].map((color) => color.toLowerCase()));
  return (base) => {
    for (let offset = 0; offset <= 0xffffff; offset += 1) {
      const rgb = (base + offset) % 0x1000000;
      const color = `#${rgb.toString(16).padStart(6, '0')}`;
      if (!used.has(color)) {
        used.add(color);
        return color;
      }
    }
    throw new Error('No free operation color remains.');
  };
}

export function sceneColorsInUse(scene: Pick<Scene, 'layers' | 'objects'>): ReadonlySet<string> {
  const colors = new Set<string>();
  for (const layer of scene.layers) colors.add(layer.color.toLowerCase());
  for (const object of scene.objects) {
    if ('color' in object && typeof object.color === 'string') {
      colors.add(object.color.toLowerCase());
    }
    if ('paths' in object) {
      for (const path of object.paths) colors.add(path.color.toLowerCase());
    }
  }
  return colors;
}
