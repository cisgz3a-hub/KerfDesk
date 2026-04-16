import type { MaterialPreset } from './MaterialPreset';

/** Built-in 10W diode starter presets (ids are stable — do not delete from storage logic). */
export const DEFAULT_MATERIAL_PRESET_IDS = new Set<string>([
  'preset-birch-3mm',
  'preset-mdf-3mm',
  'preset-acrylic-3mm',
  'preset-cardboard',
  'preset-leather-2mm',
  'preset-anodized-aluminum',
  'preset-slate-stone',
  'preset-cork-3mm',
  'preset-paper-cardstock',
  'preset-fabric-cotton',
]);

export function getDefaultMaterialPresets(): MaterialPreset[] {
  return [
    {
      id: 'preset-birch-3mm',
      name: '3mm Birch Plywood',
      material: 'Plywood',
      thickness: '3mm',
      laserWattage: '10W',
      operations: {
        cut: { power: 90, speed: 150, passes: 2 },
        engrave: { power: 30, speed: 1000, passes: 1 },
        score: { power: 15, speed: 800, passes: 1 },
      },
    },
    {
      id: 'preset-mdf-3mm',
      name: '3mm MDF',
      material: 'MDF',
      thickness: '3mm',
      laserWattage: '10W',
      operations: {
        cut: { power: 95, speed: 120, passes: 2 },
        engrave: { power: 35, speed: 1000, passes: 1 },
        score: { power: 20, speed: 800, passes: 1 },
      },
    },
    {
      id: 'preset-acrylic-3mm',
      name: '3mm Acrylic',
      material: 'Acrylic',
      thickness: '3mm',
      laserWattage: '10W',
      operations: {
        cut: { power: 100, speed: 100, passes: 3 },
        engrave: { power: 40, speed: 800, passes: 1 },
        score: { power: 20, speed: 600, passes: 1 },
      },
    },
    {
      id: 'preset-cardboard',
      name: 'Cardboard',
      material: 'Cardboard',
      thickness: '—',
      laserWattage: '10W',
      operations: {
        cut: { power: 50, speed: 400, passes: 1 },
        engrave: { power: 15, speed: 1500, passes: 1 },
        score: { power: 10, speed: 1000, passes: 1 },
      },
    },
    {
      id: 'preset-leather-2mm',
      name: 'Leather (2mm)',
      material: 'Leather',
      thickness: '2mm',
      laserWattage: '10W',
      operations: {
        cut: { power: 80, speed: 200, passes: 2 },
        engrave: { power: 25, speed: 1200, passes: 1 },
        score: { power: 15, speed: 800, passes: 1 },
      },
    },
    {
      id: 'preset-anodized-aluminum',
      name: 'Anodized Aluminum',
      material: 'Metal',
      thickness: '—',
      laserWattage: '10W',
      operations: {
        engrave: { power: 80, speed: 500, passes: 1 },
      },
    },
    {
      id: 'preset-slate-stone',
      name: 'Slate / Stone',
      material: 'Stone',
      thickness: '—',
      laserWattage: '10W',
      operations: {
        engrave: { power: 90, speed: 400, passes: 1 },
      },
    },
    {
      id: 'preset-cork-3mm',
      name: 'Cork (3mm)',
      material: 'Cork',
      thickness: '3mm',
      laserWattage: '10W',
      operations: {
        cut: { power: 60, speed: 300, passes: 1 },
        engrave: { power: 20, speed: 1200, passes: 1 },
      },
    },
    {
      id: 'preset-paper-cardstock',
      name: 'Paper / Cardstock',
      material: 'Paper',
      thickness: '—',
      laserWattage: '10W',
      operations: {
        cut: { power: 20, speed: 600, passes: 1 },
        engrave: { power: 8, speed: 2000, passes: 1 },
        score: { power: 5, speed: 1500, passes: 1 },
      },
    },
    {
      id: 'preset-fabric-cotton',
      name: 'Fabric (cotton)',
      material: 'Fabric',
      thickness: '—',
      laserWattage: '10W',
      operations: {
        cut: { power: 30, speed: 500, passes: 1 },
        engrave: { power: 12, speed: 1500, passes: 1 },
      },
    },
  ];
}

export function isDefaultMaterialPresetId(id: string): boolean {
  return DEFAULT_MATERIAL_PRESET_IDS.has(id);
}
