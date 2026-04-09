/**
 * Material presets with recommended power/speed settings.
 * Values sourced from xTool, LightBurn community, Snapmaker, and TwoTrees guides.
 *
 * IMPORTANT: These are STARTING POINTS. Users should always run a material test.
 * Settings vary by: specific machine, lens, focus, humidity, material brand/batch.
 *
 * Speed is in mm/min. Power is 0-100%.
 */

export interface MaterialPreset {
  name: string;
  category: string;
  thickness: number;
  settings: {
    diode_5w: { cut: LaserOp; engrave: LaserOp };
    diode_10w: { cut: LaserOp; engrave: LaserOp };
    diode_20w: { cut: LaserOp; engrave: LaserOp };
    diode_40w: { cut: LaserOp; engrave: LaserOp };
    co2_40w: { cut: LaserOp; engrave: LaserOp };
    co2_60w: { cut: LaserOp; engrave: LaserOp };
    co2_80w: { cut: LaserOp; engrave: LaserOp };
  };
}

interface LaserOp {
  power: number;
  speed: number;
  passes: number;
}

export const MATERIAL_CATEGORIES = [
  'Wood', 'Plywood', 'MDF', 'Acrylic', 'Leather',
  'Paper & Card', 'Fabric', 'Cork', 'Rubber', 'Stone & Ceramic',
];

export const MATERIAL_PRESETS: MaterialPreset[] = [
  // ═══════════════════════════════════════════════
  // WOOD — Natural
  // ═══════════════════════════════════════════════
  {
    name: 'Basswood 2mm',
    category: 'Wood', thickness: 2,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 100, passes: 4 },  engrave: { power: 40, speed: 1000, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 150, passes: 2 },  engrave: { power: 30, speed: 1500, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 300, passes: 1 },  engrave: { power: 25, speed: 2000, passes: 1 } },
      diode_40w: { cut: { power: 80, speed: 500, passes: 1 },   engrave: { power: 20, speed: 3000, passes: 1 } },
      co2_40w:   { cut: { power: 50, speed: 480, passes: 1 },   engrave: { power: 15, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 40, speed: 600, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 30, speed: 720, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Basswood 3mm',
    category: 'Wood', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 80, passes: 6 },   engrave: { power: 40, speed: 1000, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 100, passes: 3 },  engrave: { power: 30, speed: 1500, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 200, passes: 2 },  engrave: { power: 25, speed: 2000, passes: 1 } },
      diode_40w: { cut: { power: 90, speed: 400, passes: 1 },   engrave: { power: 20, speed: 3000, passes: 1 } },
      co2_40w:   { cut: { power: 60, speed: 360, passes: 1 },   engrave: { power: 15, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 50, speed: 480, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 35, speed: 600, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Basswood 5mm',
    category: 'Wood', thickness: 5,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 60, passes: 10 },  engrave: { power: 40, speed: 1000, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 80, passes: 5 },   engrave: { power: 30, speed: 1500, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 150, passes: 3 },  engrave: { power: 25, speed: 2000, passes: 1 } },
      diode_40w: { cut: { power: 100, speed: 300, passes: 2 },  engrave: { power: 20, speed: 3000, passes: 1 } },
      co2_40w:   { cut: { power: 70, speed: 240, passes: 1 },   engrave: { power: 15, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 60, speed: 360, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 45, speed: 480, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Pine/Softwood 3mm',
    category: 'Wood', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 80, passes: 5 },   engrave: { power: 35, speed: 1200, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 120, passes: 3 },  engrave: { power: 30, speed: 1800, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 250, passes: 2 },  engrave: { power: 25, speed: 2500, passes: 1 } },
      diode_40w: { cut: { power: 85, speed: 400, passes: 1 },   engrave: { power: 20, speed: 3000, passes: 1 } },
      co2_40w:   { cut: { power: 55, speed: 420, passes: 1 },   engrave: { power: 15, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 45, speed: 540, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 35, speed: 660, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Oak/Hardwood 3mm',
    category: 'Wood', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 60, passes: 8 },   engrave: { power: 50, speed: 800, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 80, passes: 4 },   engrave: { power: 40, speed: 1200, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 150, passes: 3 },  engrave: { power: 35, speed: 1800, passes: 1 } },
      diode_40w: { cut: { power: 100, speed: 300, passes: 2 },  engrave: { power: 25, speed: 2500, passes: 1 } },
      co2_40w:   { cut: { power: 70, speed: 300, passes: 1 },   engrave: { power: 20, speed: 5000, passes: 1 } },
      co2_60w:   { cut: { power: 55, speed: 420, passes: 1 },   engrave: { power: 15, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 45, speed: 540, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Bamboo 3mm',
    category: 'Wood', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 60, passes: 7 },   engrave: { power: 45, speed: 900, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 90, passes: 4 },   engrave: { power: 35, speed: 1300, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 180, passes: 2 },  engrave: { power: 30, speed: 2000, passes: 1 } },
      diode_40w: { cut: { power: 100, speed: 350, passes: 1 },  engrave: { power: 22, speed: 2800, passes: 1 } },
      co2_40w:   { cut: { power: 65, speed: 360, passes: 1 },   engrave: { power: 18, speed: 5500, passes: 1 } },
      co2_60w:   { cut: { power: 50, speed: 480, passes: 1 },   engrave: { power: 14, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 40, speed: 600, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
    },
  },

  // ═══════════════════════════════════════════════
  // PLYWOOD
  // ═══════════════════════════════════════════════
  {
    name: 'Birch Plywood 3mm',
    category: 'Plywood', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 80, passes: 6 },   engrave: { power: 40, speed: 1000, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 100, passes: 3 },  engrave: { power: 35, speed: 1500, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 200, passes: 2 },  engrave: { power: 30, speed: 2000, passes: 1 } },
      diode_40w: { cut: { power: 90, speed: 400, passes: 1 },   engrave: { power: 20, speed: 3000, passes: 1 } },
      co2_40w:   { cut: { power: 60, speed: 360, passes: 1 },   engrave: { power: 18, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 50, speed: 480, passes: 1 },   engrave: { power: 14, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 40, speed: 600, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Birch Plywood 5mm',
    category: 'Plywood', thickness: 5,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 60, passes: 12 },  engrave: { power: 40, speed: 1000, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 80, passes: 6 },   engrave: { power: 35, speed: 1500, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 130, passes: 3 },  engrave: { power: 30, speed: 2000, passes: 1 } },
      diode_40w: { cut: { power: 100, speed: 250, passes: 2 },  engrave: { power: 20, speed: 3000, passes: 1 } },
      co2_40w:   { cut: { power: 75, speed: 240, passes: 1 },   engrave: { power: 18, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 60, speed: 360, passes: 1 },   engrave: { power: 14, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 50, speed: 480, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
    },
  },

  // ═══════════════════════════════════════════════
  // MDF
  // ═══════════════════════════════════════════════
  {
    name: 'MDF 3mm',
    category: 'MDF', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 80, passes: 5 },   engrave: { power: 35, speed: 1200, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 120, passes: 3 },  engrave: { power: 30, speed: 1800, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 480, passes: 2 },  engrave: { power: 25, speed: 2500, passes: 1 } },
      diode_40w: { cut: { power: 90, speed: 600, passes: 1 },   engrave: { power: 20, speed: 3000, passes: 1 } },
      co2_40w:   { cut: { power: 55, speed: 480, passes: 1 },   engrave: { power: 15, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 45, speed: 600, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 35, speed: 720, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'MDF 6mm',
    category: 'MDF', thickness: 6,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 50, passes: 14 },  engrave: { power: 35, speed: 1200, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 60, passes: 8 },   engrave: { power: 30, speed: 1800, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 150, passes: 4 },  engrave: { power: 25, speed: 2500, passes: 1 } },
      diode_40w: { cut: { power: 100, speed: 300, passes: 2 },  engrave: { power: 20, speed: 3000, passes: 1 } },
      co2_40w:   { cut: { power: 80, speed: 240, passes: 1 },   engrave: { power: 15, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 65, speed: 360, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 50, speed: 480, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
    },
  },

  // ═══════════════════════════════════════════════
  // ACRYLIC (opaque/colored only for diode — clear needs CO2)
  // ═══════════════════════════════════════════════
  {
    name: 'Acrylic (Black/Dark) 3mm',
    category: 'Acrylic', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 50, passes: 10 },  engrave: { power: 50, speed: 800, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 80, passes: 6 },   engrave: { power: 40, speed: 1200, passes: 1 } },
      diode_20w: { cut: { power: 100, speed: 150, passes: 3 },  engrave: { power: 35, speed: 1800, passes: 1 } },
      diode_40w: { cut: { power: 100, speed: 300, passes: 2 },  engrave: { power: 25, speed: 2500, passes: 1 } },
      co2_40w:   { cut: { power: 65, speed: 360, passes: 1 },   engrave: { power: 25, speed: 5000, passes: 1 } },
      co2_60w:   { cut: { power: 55, speed: 480, passes: 1 },   engrave: { power: 18, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 45, speed: 600, passes: 1 },   engrave: { power: 14, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Acrylic (Clear/Cast) 3mm',
    category: 'Acrylic', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 0, speed: 0, passes: 0 } },
      diode_10w: { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 0, speed: 0, passes: 0 } },
      diode_20w: { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 0, speed: 0, passes: 0 } },
      diode_40w: { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 0, speed: 0, passes: 0 } },
      co2_40w:   { cut: { power: 65, speed: 300, passes: 1 },   engrave: { power: 25, speed: 5000, passes: 1 } },
      co2_60w:   { cut: { power: 55, speed: 420, passes: 1 },   engrave: { power: 18, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 45, speed: 540, passes: 1 },   engrave: { power: 14, speed: 6000, passes: 1 } },
    },
  },

  // ═══════════════════════════════════════════════
  // LEATHER
  // ═══════════════════════════════════════════════
  {
    name: 'Vegetable Tan Leather 1.5mm',
    category: 'Leather', thickness: 1.5,
    settings: {
      diode_5w:  { cut: { power: 80, speed: 150, passes: 3 },   engrave: { power: 20, speed: 1500, passes: 1 } },
      diode_10w: { cut: { power: 70, speed: 250, passes: 2 },   engrave: { power: 15, speed: 2000, passes: 1 } },
      diode_20w: { cut: { power: 60, speed: 400, passes: 1 },   engrave: { power: 12, speed: 3000, passes: 1 } },
      diode_40w: { cut: { power: 45, speed: 600, passes: 1 },   engrave: { power: 10, speed: 4000, passes: 1 } },
      co2_40w:   { cut: { power: 30, speed: 600, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 25, speed: 720, passes: 1 },   engrave: { power: 8, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 20, speed: 840, passes: 1 },   engrave: { power: 6, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Vegetable Tan Leather 3mm',
    category: 'Leather', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 100, passes: 5 },  engrave: { power: 25, speed: 1500, passes: 1 } },
      diode_10w: { cut: { power: 90, speed: 150, passes: 3 },   engrave: { power: 18, speed: 2000, passes: 1 } },
      diode_20w: { cut: { power: 80, speed: 250, passes: 2 },   engrave: { power: 14, speed: 3000, passes: 1 } },
      diode_40w: { cut: { power: 70, speed: 400, passes: 1 },   engrave: { power: 10, speed: 4000, passes: 1 } },
      co2_40w:   { cut: { power: 45, speed: 420, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 35, speed: 540, passes: 1 },   engrave: { power: 9, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 28, speed: 660, passes: 1 },   engrave: { power: 7, speed: 6000, passes: 1 } },
    },
  },

  // ═══════════════════════════════════════════════
  // PAPER & CARDSTOCK
  // ═══════════════════════════════════════════════
  {
    name: 'Cardstock (300gsm)',
    category: 'Paper & Card', thickness: 0.4,
    settings: {
      diode_5w:  { cut: { power: 30, speed: 600, passes: 1 },   engrave: { power: 10, speed: 2000, passes: 1 } },
      diode_10w: { cut: { power: 20, speed: 800, passes: 1 },   engrave: { power: 8, speed: 3000, passes: 1 } },
      diode_20w: { cut: { power: 15, speed: 1200, passes: 1 },  engrave: { power: 6, speed: 4000, passes: 1 } },
      diode_40w: { cut: { power: 10, speed: 1500, passes: 1 },  engrave: { power: 5, speed: 5000, passes: 1 } },
      co2_40w:   { cut: { power: 12, speed: 1500, passes: 1 },  engrave: { power: 6, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 10, speed: 1800, passes: 1 },  engrave: { power: 5, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 8, speed: 2100, passes: 1 },   engrave: { power: 4, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Corrugated Cardboard 3mm',
    category: 'Paper & Card', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 60, speed: 400, passes: 2 },   engrave: { power: 20, speed: 1500, passes: 1 } },
      diode_10w: { cut: { power: 50, speed: 500, passes: 1 },   engrave: { power: 15, speed: 2000, passes: 1 } },
      diode_20w: { cut: { power: 40, speed: 700, passes: 1 },   engrave: { power: 12, speed: 3000, passes: 1 } },
      diode_40w: { cut: { power: 30, speed: 900, passes: 1 },   engrave: { power: 10, speed: 4000, passes: 1 } },
      co2_40w:   { cut: { power: 25, speed: 720, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 18, speed: 900, passes: 1 },   engrave: { power: 8, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 15, speed: 1080, passes: 1 },  engrave: { power: 6, speed: 6000, passes: 1 } },
    },
  },

  // ═══════════════════════════════════════════════
  // FABRIC
  // ═══════════════════════════════════════════════
  {
    name: 'Cotton Fabric',
    category: 'Fabric', thickness: 0.5,
    settings: {
      diode_5w:  { cut: { power: 35, speed: 500, passes: 1 },   engrave: { power: 12, speed: 2000, passes: 1 } },
      diode_10w: { cut: { power: 25, speed: 700, passes: 1 },   engrave: { power: 10, speed: 3000, passes: 1 } },
      diode_20w: { cut: { power: 20, speed: 1000, passes: 1 },  engrave: { power: 8, speed: 4000, passes: 1 } },
      diode_40w: { cut: { power: 15, speed: 1200, passes: 1 },  engrave: { power: 6, speed: 5000, passes: 1 } },
      co2_40w:   { cut: { power: 15, speed: 1200, passes: 1 },  engrave: { power: 8, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 12, speed: 1500, passes: 1 },  engrave: { power: 6, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 10, speed: 1800, passes: 1 },  engrave: { power: 5, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Denim',
    category: 'Fabric', thickness: 1,
    settings: {
      diode_5w:  { cut: { power: 60, speed: 400, passes: 2 },   engrave: { power: 20, speed: 1500, passes: 1 } },
      diode_10w: { cut: { power: 50, speed: 500, passes: 1 },   engrave: { power: 15, speed: 2000, passes: 1 } },
      diode_20w: { cut: { power: 40, speed: 700, passes: 1 },   engrave: { power: 12, speed: 3000, passes: 1 } },
      diode_40w: { cut: { power: 30, speed: 900, passes: 1 },   engrave: { power: 10, speed: 4000, passes: 1 } },
      co2_40w:   { cut: { power: 25, speed: 720, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 20, speed: 900, passes: 1 },   engrave: { power: 9, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 15, speed: 1080, passes: 1 },  engrave: { power: 7, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Felt 2mm',
    category: 'Fabric', thickness: 2,
    settings: {
      diode_5w:  { cut: { power: 70, speed: 300, passes: 2 },   engrave: { power: 25, speed: 1200, passes: 1 } },
      diode_10w: { cut: { power: 60, speed: 400, passes: 1 },   engrave: { power: 18, speed: 1800, passes: 1 } },
      diode_20w: { cut: { power: 50, speed: 600, passes: 1 },   engrave: { power: 15, speed: 2500, passes: 1 } },
      diode_40w: { cut: { power: 35, speed: 800, passes: 1 },   engrave: { power: 10, speed: 3500, passes: 1 } },
      co2_40w:   { cut: { power: 30, speed: 600, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 22, speed: 780, passes: 1 },   engrave: { power: 9, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 18, speed: 900, passes: 1 },   engrave: { power: 7, speed: 6000, passes: 1 } },
    },
  },

  // ═══════════════════════════════════════════════
  // CORK & RUBBER
  // ═══════════════════════════════════════════════
  {
    name: 'Cork Sheet 3mm',
    category: 'Cork', thickness: 3,
    settings: {
      diode_5w:  { cut: { power: 80, speed: 200, passes: 3 },   engrave: { power: 30, speed: 1200, passes: 1 } },
      diode_10w: { cut: { power: 70, speed: 300, passes: 2 },   engrave: { power: 25, speed: 1800, passes: 1 } },
      diode_20w: { cut: { power: 60, speed: 450, passes: 1 },   engrave: { power: 20, speed: 2500, passes: 1 } },
      diode_40w: { cut: { power: 45, speed: 600, passes: 1 },   engrave: { power: 15, speed: 3500, passes: 1 } },
      co2_40w:   { cut: { power: 35, speed: 540, passes: 1 },   engrave: { power: 12, speed: 6000, passes: 1 } },
      co2_60w:   { cut: { power: 28, speed: 660, passes: 1 },   engrave: { power: 9, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 22, speed: 780, passes: 1 },   engrave: { power: 7, speed: 6000, passes: 1 } },
    },
  },
  {
    name: 'Rubber Sheet 2mm',
    category: 'Rubber', thickness: 2,
    settings: {
      diode_5w:  { cut: { power: 100, speed: 100, passes: 5 },  engrave: { power: 40, speed: 800, passes: 1 } },
      diode_10w: { cut: { power: 100, speed: 150, passes: 3 },  engrave: { power: 35, speed: 1200, passes: 1 } },
      diode_20w: { cut: { power: 90, speed: 250, passes: 2 },   engrave: { power: 30, speed: 1800, passes: 1 } },
      diode_40w: { cut: { power: 80, speed: 400, passes: 1 },   engrave: { power: 22, speed: 2500, passes: 1 } },
      co2_40w:   { cut: { power: 50, speed: 360, passes: 1 },   engrave: { power: 18, speed: 5000, passes: 1 } },
      co2_60w:   { cut: { power: 40, speed: 480, passes: 1 },   engrave: { power: 14, speed: 6000, passes: 1 } },
      co2_80w:   { cut: { power: 30, speed: 600, passes: 1 },   engrave: { power: 10, speed: 6000, passes: 1 } },
    },
  },

  // ═══════════════════════════════════════════════
  // STONE & CERAMIC (engrave only — no cutting)
  // ═══════════════════════════════════════════════
  {
    name: 'Slate/Stone Tile',
    category: 'Stone & Ceramic', thickness: 5,
    settings: {
      diode_5w:  { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 90, speed: 600, passes: 1 } },
      diode_10w: { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 80, speed: 800, passes: 1 } },
      diode_20w: { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 70, speed: 1200, passes: 1 } },
      diode_40w: { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 60, speed: 1800, passes: 1 } },
      co2_40w:   { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 60, speed: 3000, passes: 1 } },
      co2_60w:   { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 50, speed: 4000, passes: 1 } },
      co2_80w:   { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 40, speed: 5000, passes: 1 } },
    },
  },
  {
    name: 'Ceramic Tile (glazed)',
    category: 'Stone & Ceramic', thickness: 5,
    settings: {
      diode_5w:  { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 100, speed: 500, passes: 2 } },
      diode_10w: { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 90, speed: 700, passes: 1 } },
      diode_20w: { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 80, speed: 1000, passes: 1 } },
      diode_40w: { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 70, speed: 1500, passes: 1 } },
      co2_40w:   { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 70, speed: 2500, passes: 1 } },
      co2_60w:   { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 55, speed: 3500, passes: 1 } },
      co2_80w:   { cut: { power: 0, speed: 0, passes: 0 },      engrave: { power: 45, speed: 4500, passes: 1 } },
    },
  },
];

/**
 * Get the correct settings key based on machine type and wattage.
 */
export function getMachineSettingsKey(machineType: string, watts: string): string {
  const type = machineType.toLowerCase();
  const w = parseInt(watts, 10) || 10;

  if (type.includes('co2')) {
    if (w >= 80) return 'co2_80w';
    if (w >= 60) return 'co2_60w';
    return 'co2_40w';
  }

  // Diode (default)
  if (w >= 40) return 'diode_40w';
  if (w >= 20) return 'diode_20w';
  if (w >= 10) return 'diode_10w';
  return 'diode_5w';
}

/**
 * Get recommended settings for a material, machine type, and wattage.
 */
export function getPresetSettings(
  presetName: string,
  machineType: string,
  machineWatts: string = '10',
): { cut: LaserOp; engrave: LaserOp } | null {
  const preset = MATERIAL_PRESETS.find(p => p.name === presetName);
  if (!preset) return null;

  const key = getMachineSettingsKey(machineType, machineWatts) as keyof MaterialPreset['settings'];
  return preset.settings[key] ?? null;
}

/**
 * Check if a material can be cut with a given laser type.
 * Returns false if settings are all zeros (e.g., clear acrylic with diode).
 */
export function canCutMaterial(presetName: string, machineType: string, machineWatts: string = '10'): boolean {
  const settings = getPresetSettings(presetName, machineType, machineWatts);
  if (!settings) return false;
  return settings.cut.power > 0 && settings.cut.speed > 0;
}

export function canEngraveMaterial(presetName: string, machineType: string, machineWatts: string = '10'): boolean {
  const settings = getPresetSettings(presetName, machineType, machineWatts);
  if (!settings) return false;
  return settings.engrave.power > 0 && settings.engrave.speed > 0;
}
