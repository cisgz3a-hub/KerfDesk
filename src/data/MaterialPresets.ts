export interface MaterialPreset {
  id: string;
  name: string;
  category: string;
  thickness?: string;
  settings: {
    cut: { power: number; speed: number; passes: number };
    engrave: { power: number; speed: number; passes: number };
    score: { power: number; speed: number; passes: number };
  };
  notes?: string;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  // ─── WOOD ──────────────────────────────
  {
    id: 'plywood-3mm',
    name: '3mm Plywood / MDF',
    category: 'Wood',
    thickness: '3mm',
    settings: {
      cut: { power: 80, speed: 150, passes: 1 },
      engrave: { power: 40, speed: 3000, passes: 1 },
      score: { power: 15, speed: 800, passes: 1 },
    },
  },
  {
    id: 'plywood-5mm',
    name: '5mm Plywood / MDF',
    category: 'Wood',
    thickness: '5mm',
    settings: {
      cut: { power: 90, speed: 80, passes: 2 },
      engrave: { power: 40, speed: 3000, passes: 1 },
      score: { power: 15, speed: 800, passes: 1 },
    },
  },
  {
    id: 'balsa-3mm',
    name: '3mm Balsa Wood',
    category: 'Wood',
    thickness: '3mm',
    settings: {
      cut: { power: 50, speed: 300, passes: 1 },
      engrave: { power: 25, speed: 4000, passes: 1 },
      score: { power: 10, speed: 1000, passes: 1 },
    },
  },
  {
    id: 'hardwood-3mm',
    name: '3mm Hardwood (Oak/Walnut)',
    category: 'Wood',
    thickness: '3mm',
    settings: {
      cut: { power: 95, speed: 100, passes: 2 },
      engrave: { power: 50, speed: 2500, passes: 1 },
      score: { power: 20, speed: 600, passes: 1 },
    },
  },
  // ─── ACRYLIC ───────────────────────────
  {
    id: 'acrylic-3mm',
    name: '3mm Acrylic (Cast)',
    category: 'Acrylic',
    thickness: '3mm',
    settings: {
      cut: { power: 75, speed: 120, passes: 1 },
      engrave: { power: 35, speed: 3500, passes: 1 },
      score: { power: 12, speed: 900, passes: 1 },
    },
  },
  {
    id: 'acrylic-5mm',
    name: '5mm Acrylic (Cast)',
    category: 'Acrylic',
    thickness: '5mm',
    settings: {
      cut: { power: 90, speed: 60, passes: 2 },
      engrave: { power: 35, speed: 3500, passes: 1 },
      score: { power: 12, speed: 900, passes: 1 },
    },
  },
  // ─── LEATHER ───────────────────────────
  {
    id: 'leather-veg-2mm',
    name: '2mm Vegetable Tanned Leather',
    category: 'Leather',
    thickness: '2mm',
    settings: {
      cut: { power: 60, speed: 200, passes: 2 },
      engrave: { power: 30, speed: 4000, passes: 1 },
      score: { power: 15, speed: 1000, passes: 1 },
    },
  },
  // ─── PAPER / CARDBOARD ─────────────────
  {
    id: 'cardstock',
    name: 'Cardstock (300gsm)',
    category: 'Paper',
    settings: {
      cut: { power: 25, speed: 600, passes: 1 },
      engrave: { power: 10, speed: 5000, passes: 1 },
      score: { power: 8, speed: 1200, passes: 1 },
    },
  },
  {
    id: 'cardboard-3mm',
    name: '3mm Corrugated Cardboard',
    category: 'Paper',
    thickness: '3mm',
    settings: {
      cut: { power: 40, speed: 400, passes: 1 },
      engrave: { power: 15, speed: 4000, passes: 1 },
      score: { power: 10, speed: 1000, passes: 1 },
    },
  },
  // ─── FABRIC ────────────────────────────
  {
    id: 'felt-3mm',
    name: '3mm Felt',
    category: 'Fabric',
    thickness: '3mm',
    settings: {
      cut: { power: 30, speed: 500, passes: 1 },
      engrave: { power: 12, speed: 5000, passes: 1 },
      score: { power: 8, speed: 1500, passes: 1 },
    },
  },
  // ─── SPECIALTY ─────────────────────────
  {
    id: 'anodized-aluminum',
    name: 'Anodized Aluminum (marking)',
    category: 'Metal',
    notes: 'Removes anodization only — does not cut metal',
    settings: {
      cut: { power: 0, speed: 0, passes: 0 },
      engrave: { power: 80, speed: 1500, passes: 1 },
      score: { power: 40, speed: 800, passes: 1 },
    },
  },
  {
    id: 'slate',
    name: 'Natural Slate',
    category: 'Stone',
    notes: 'Engraving only — does not cut',
    settings: {
      cut: { power: 0, speed: 0, passes: 0 },
      engrave: { power: 90, speed: 1500, passes: 1 },
      score: { power: 50, speed: 800, passes: 1 },
    },
  },
];

export function getPresetsByCategory(): Map<string, MaterialPreset[]> {
  const map = new Map<string, MaterialPreset[]>();
  for (const preset of MATERIAL_PRESETS) {
    const list = map.get(preset.category) || [];
    list.push(preset);
    map.set(preset.category, list);
  }
  return map;
}

export function getPresetById(id: string): MaterialPreset | undefined {
  return MATERIAL_PRESETS.find(p => p.id === id);
}
