export type BoxDimensionMode = 'outside' | 'inside';

export type BoxLibraryCategory = 'starter' | 'storage' | 'display' | 'electronics' | 'calibration';

export interface BoxLibraryPreset {
  id: string;
  category: BoxLibraryCategory;
  title: string;
  description: string;
  dimensionMode: BoxDimensionMode;
  width: number;
  height: number;
  depth: number;
  thickness: number;
  fingerWidth: number;
  kerf: number;
  fitAllowance: number;
  openTop: boolean;
}

export const BOX_LIBRARY_PRESETS: BoxLibraryPreset[] = [
  {
    id: 'starter-small-closed',
    category: 'starter',
    title: 'Small closed keepsake box',
    description: 'A reliable six-face starter box for proving material fit before scaling up.',
    dimensionMode: 'outside',
    width: 80,
    height: 50,
    depth: 40,
    thickness: 3,
    fingerWidth: 10,
    kerf: 0.1,
    fitAllowance: 0.03,
    openTop: false,
  },
  {
    id: 'starter-open-tray',
    category: 'starter',
    title: 'Open utility tray',
    description: 'Five-face open tray for quick desk parts, pencils, or workshop sorting.',
    dimensionMode: 'outside',
    width: 120,
    height: 35,
    depth: 80,
    thickness: 3,
    fingerWidth: 12,
    kerf: 0.1,
    fitAllowance: 0.04,
    openTop: true,
  },
  {
    id: 'storage-tea-bag-box',
    category: 'storage',
    title: 'Tea / sachet storage box',
    description: 'A medium box sized for sachets, tea bags, small craft stock, or gift packaging.',
    dimensionMode: 'inside',
    width: 95,
    height: 65,
    depth: 70,
    thickness: 3,
    fingerWidth: 12,
    kerf: 0.1,
    fitAllowance: 0.04,
    openTop: false,
  },
  {
    id: 'storage-drawer-insert',
    category: 'storage',
    title: 'Drawer organizer tray',
    description: 'Low open-top insert for drawers, hardware, classroom supplies, and tools.',
    dimensionMode: 'inside',
    width: 180,
    height: 35,
    depth: 120,
    thickness: 3,
    fingerWidth: 15,
    kerf: 0.1,
    fitAllowance: 0.05,
    openTop: true,
  },
  {
    id: 'display-pencil-cup',
    category: 'display',
    title: 'Tall pencil cup',
    description: 'Tall open container for pens, craft sticks, tools, or classroom rewards.',
    dimensionMode: 'outside',
    width: 70,
    height: 110,
    depth: 70,
    thickness: 3,
    fingerWidth: 10,
    kerf: 0.1,
    fitAllowance: 0.04,
    openTop: true,
  },
  {
    id: 'display-gift-box',
    category: 'display',
    title: 'Premium gift box blank',
    description: 'Closed box blank ready for engraving, branding, or a decorative lid design.',
    dimensionMode: 'outside',
    width: 140,
    height: 70,
    depth: 90,
    thickness: 3,
    fingerWidth: 14,
    kerf: 0.1,
    fitAllowance: 0.03,
    openTop: false,
  },
  {
    id: 'electronics-mini-enclosure',
    category: 'electronics',
    title: 'Mini electronics enclosure',
    description: 'Small closed project box for sensors, controllers, batteries, and wiring prototypes.',
    dimensionMode: 'inside',
    width: 80,
    height: 35,
    depth: 55,
    thickness: 3,
    fingerWidth: 8,
    kerf: 0.1,
    fitAllowance: 0.06,
    openTop: false,
  },
  {
    id: 'calibration-two-piece-coupon',
    category: 'calibration',
    title: 'Fit-test mini box',
    description: 'Tiny sacrificial box for checking kerf, fit allowance, and tab depth before a real burn.',
    dimensionMode: 'outside',
    width: 45,
    height: 28,
    depth: 35,
    thickness: 3,
    fingerWidth: 7,
    kerf: 0.1,
    fitAllowance: 0.03,
    openTop: true,
  },
];

export function getBoxLibraryPreset(id: string): BoxLibraryPreset | undefined {
  return BOX_LIBRARY_PRESETS.find(p => p.id === id);
}

export function formatBoxLibraryCategory(category: BoxLibraryCategory): string {
  switch (category) {
    case 'starter': return 'Starter';
    case 'storage': return 'Storage';
    case 'display': return 'Display / Gifts';
    case 'electronics': return 'Electronics';
    case 'calibration': return 'Calibration';
    default: return category;
  }
}
