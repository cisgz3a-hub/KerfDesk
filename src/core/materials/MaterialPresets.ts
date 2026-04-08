/**
 * Material presets with recommended power/speed settings per laser type
 * Values are starting points — users should run material tests to fine-tune
 */

export interface MaterialPreset {
  name: string;
  type: string;
  thickness: number;
  settings: {
    diode: { cut: { power: number; speed: number; passes: number }; engrave: { power: number; speed: number } };
    co2: { cut: { power: number; speed: number; passes: number }; engrave: { power: number; speed: number } };
    fiber: { cut: { power: number; speed: number; passes: number }; engrave: { power: number; speed: number } };
  };
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  // Wood
  {
    name: '3mm Birch Plywood',
    type: 'wood', thickness: 3,
    settings: {
      diode: { cut: { power: 100, speed: 150, passes: 3 }, engrave: { power: 40, speed: 1000 } },
      co2: { cut: { power: 60, speed: 8, passes: 1 }, engrave: { power: 20, speed: 300 } },
      fiber: { cut: { power: 80, speed: 100, passes: 2 }, engrave: { power: 30, speed: 500 } },
    },
  },
  {
    name: '5mm Birch Plywood',
    type: 'wood', thickness: 5,
    settings: {
      diode: { cut: { power: 100, speed: 100, passes: 5 }, engrave: { power: 40, speed: 1000 } },
      co2: { cut: { power: 70, speed: 5, passes: 1 }, engrave: { power: 20, speed: 300 } },
      fiber: { cut: { power: 90, speed: 80, passes: 3 }, engrave: { power: 30, speed: 500 } },
    },
  },
  {
    name: '3mm MDF',
    type: 'wood', thickness: 3,
    settings: {
      diode: { cut: { power: 100, speed: 150, passes: 2 }, engrave: { power: 35, speed: 1200 } },
      co2: { cut: { power: 55, speed: 10, passes: 1 }, engrave: { power: 18, speed: 350 } },
      fiber: { cut: { power: 75, speed: 120, passes: 2 }, engrave: { power: 25, speed: 600 } },
    },
  },
  {
    name: '6mm MDF',
    type: 'wood', thickness: 6,
    settings: {
      diode: { cut: { power: 100, speed: 80, passes: 6 }, engrave: { power: 35, speed: 1200 } },
      co2: { cut: { power: 75, speed: 4, passes: 1 }, engrave: { power: 18, speed: 350 } },
      fiber: { cut: { power: 90, speed: 60, passes: 4 }, engrave: { power: 25, speed: 600 } },
    },
  },
  {
    name: '3mm Basswood',
    type: 'wood', thickness: 3,
    settings: {
      diode: { cut: { power: 90, speed: 200, passes: 2 }, engrave: { power: 30, speed: 1200 } },
      co2: { cut: { power: 50, speed: 10, passes: 1 }, engrave: { power: 15, speed: 400 } },
      fiber: { cut: { power: 70, speed: 150, passes: 2 }, engrave: { power: 25, speed: 600 } },
    },
  },
  // Acrylic
  {
    name: '3mm Acrylic (Cast)',
    type: 'acrylic', thickness: 3,
    settings: {
      diode: { cut: { power: 100, speed: 80, passes: 6 }, engrave: { power: 50, speed: 800 } },
      co2: { cut: { power: 65, speed: 6, passes: 1 }, engrave: { power: 25, speed: 300 } },
      fiber: { cut: { power: 85, speed: 80, passes: 3 }, engrave: { power: 40, speed: 400 } },
    },
  },
  {
    name: '5mm Acrylic (Cast)',
    type: 'acrylic', thickness: 5,
    settings: {
      diode: { cut: { power: 100, speed: 50, passes: 10 }, engrave: { power: 50, speed: 800 } },
      co2: { cut: { power: 75, speed: 4, passes: 1 }, engrave: { power: 25, speed: 300 } },
      fiber: { cut: { power: 95, speed: 50, passes: 5 }, engrave: { power: 40, speed: 400 } },
    },
  },
  // Leather
  {
    name: '2mm Vegetable Tan Leather',
    type: 'leather', thickness: 2,
    settings: {
      diode: { cut: { power: 80, speed: 200, passes: 2 }, engrave: { power: 25, speed: 1500 } },
      co2: { cut: { power: 40, speed: 15, passes: 1 }, engrave: { power: 12, speed: 400 } },
      fiber: { cut: { power: 60, speed: 200, passes: 1 }, engrave: { power: 20, speed: 800 } },
    },
  },
  // Paper / Cardstock
  {
    name: 'Cardstock (300gsm)',
    type: 'paper', thickness: 0.5,
    settings: {
      diode: { cut: { power: 30, speed: 600, passes: 1 }, engrave: { power: 10, speed: 2000 } },
      co2: { cut: { power: 15, speed: 25, passes: 1 }, engrave: { power: 8, speed: 500 } },
      fiber: { cut: { power: 20, speed: 500, passes: 1 }, engrave: { power: 10, speed: 1000 } },
    },
  },
  {
    name: 'Corrugated Cardboard (3mm)',
    type: 'paper', thickness: 3,
    settings: {
      diode: { cut: { power: 60, speed: 400, passes: 1 }, engrave: { power: 20, speed: 1500 } },
      co2: { cut: { power: 25, speed: 20, passes: 1 }, engrave: { power: 10, speed: 400 } },
      fiber: { cut: { power: 40, speed: 300, passes: 1 }, engrave: { power: 15, speed: 800 } },
    },
  },
  // Fabric
  {
    name: 'Cotton Fabric',
    type: 'fabric', thickness: 1,
    settings: {
      diode: { cut: { power: 40, speed: 500, passes: 1 }, engrave: { power: 15, speed: 2000 } },
      co2: { cut: { power: 20, speed: 20, passes: 1 }, engrave: { power: 8, speed: 500 } },
      fiber: { cut: { power: 30, speed: 400, passes: 1 }, engrave: { power: 12, speed: 1000 } },
    },
  },
  {
    name: 'Denim',
    type: 'fabric', thickness: 1.5,
    settings: {
      diode: { cut: { power: 60, speed: 400, passes: 1 }, engrave: { power: 20, speed: 1500 } },
      co2: { cut: { power: 30, speed: 15, passes: 1 }, engrave: { power: 12, speed: 400 } },
      fiber: { cut: { power: 45, speed: 300, passes: 1 }, engrave: { power: 18, speed: 800 } },
    },
  },
];

/**
 * Get recommended settings for a material and laser type
 */
export function getPresetSettings(presetName: string, laserType: string): { cut: { power: number; speed: number; passes: number }; engrave: { power: number; speed: number } } | null {
  const preset = MATERIAL_PRESETS.find(p => p.name === presetName);
  if (!preset) return null;

  const type = laserType.toLowerCase();
  if (type.includes('co2')) return preset.settings.co2;
  if (type.includes('fiber')) return preset.settings.fiber;
  return preset.settings.diode; // default to diode
}
