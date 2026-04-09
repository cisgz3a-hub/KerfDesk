/**
 * Built-in template library with starter designs
 * Each template is an inline SVG string that gets imported into the scene
 */

export interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  svgWidth: number;  // mm
  svgHeight: number; // mm
  svg: string;       // SVG markup
}

export const TEMPLATE_CATEGORIES = [
  { id: 'all', name: 'All', icon: '✦' },
  { id: 'keychains', name: 'Keychains', icon: '🔑' },
  { id: 'signs', name: 'Signs', icon: '🪧' },
  { id: 'earrings', name: 'Earrings', icon: '💎' },
  { id: 'coasters', name: 'Coasters', icon: '☕' },
  { id: 'ornaments', name: 'Ornaments', icon: '🎄' },
  { id: 'tags', name: 'Gift Tags', icon: '🏷' },
  { id: 'stencils', name: 'Stencils', icon: '🎨' },
];

export const TEMPLATES: Template[] = [
  // ─── KEYCHAINS ──────────────────────────────────────────
  {
    id: 'keychain-circle',
    name: 'Circle Keychain',
    category: 'keychains',
    description: 'Simple round keychain with hanging hole',
    tags: ['beginner', 'quick'],
    svgWidth: 40,
    svgHeight: 50,
    svg: `<svg viewBox="0 0 40 50" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="28" r="18" fill="none" stroke="red" stroke-width="0.2"/>
      <circle cx="20" cy="7" r="3" fill="none" stroke="red" stroke-width="0.2"/>
      <line x1="20" y1="10" x2="20" y2="12" stroke="red" stroke-width="0.2"/>
    </svg>`,
  },
  {
    id: 'keychain-rectangle',
    name: 'Rectangle Keychain',
    category: 'keychains',
    description: 'Rounded rectangle keychain with hole',
    tags: ['beginner', 'quick', 'engrave'],
    svgWidth: 50,
    svgHeight: 30,
    svg: `<svg viewBox="0 0 50 30" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="48" height="28" rx="5" fill="none" stroke="red" stroke-width="0.2"/>
      <circle cx="8" cy="15" r="2.5" fill="none" stroke="red" stroke-width="0.2"/>
      <line x1="16" y1="10" x2="44" y2="10" stroke="blue" stroke-width="0.2"/>
      <line x1="16" y1="15" x2="44" y2="15" stroke="blue" stroke-width="0.2"/>
      <line x1="16" y1="20" x2="38" y2="20" stroke="blue" stroke-width="0.2"/>
    </svg>`,
  },
  {
    id: 'keychain-heart',
    name: 'Heart Keychain',
    category: 'keychains',
    description: 'Heart shape with hanging hole',
    tags: ['love', 'gift'],
    svgWidth: 40,
    svgHeight: 48,
    svg: `<svg viewBox="0 0 40 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="5" r="2.5" fill="none" stroke="red" stroke-width="0.2"/>
      <path d="M20 18 C20 14, 12 10, 12 16 C12 22, 20 30, 20 30 C20 30, 28 22, 28 16 C28 10, 20 14, 20 18 Z" fill="none" stroke="red" stroke-width="0.2" transform="scale(1.3) translate(-4, 2)"/>
    </svg>`,
  },
  {
    id: 'keychain-dog-tag',
    name: 'Dog Tag',
    category: 'keychains',
    description: 'Military style dog tag',
    tags: ['pet', 'name'],
    svgWidth: 30,
    svgHeight: 55,
    svg: `<svg viewBox="0 0 30 55" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="10" width="28" height="44" rx="14" fill="none" stroke="red" stroke-width="0.2"/>
      <circle cx="15" cy="7" r="3" fill="none" stroke="red" stroke-width="0.2"/>
      <line x1="6" y1="30" x2="24" y2="30" stroke="blue" stroke-width="0.2"/>
      <line x1="6" y1="36" x2="24" y2="36" stroke="blue" stroke-width="0.2"/>
      <line x1="6" y1="42" x2="20" y2="42" stroke="blue" stroke-width="0.2"/>
    </svg>`,
  },

  // ─── SIGNS ──────────────────────────────────────────────
  {
    id: 'sign-welcome',
    name: 'Welcome Sign',
    category: 'signs',
    description: 'Rectangular welcome sign with border',
    tags: ['home', 'decor'],
    svgWidth: 150,
    svgHeight: 60,
    svg: `<svg viewBox="0 0 150 60" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="146" height="56" rx="4" fill="none" stroke="red" stroke-width="0.3"/>
      <rect x="6" y="6" width="138" height="48" rx="2" fill="none" stroke="green" stroke-width="0.2"/>
      <circle cx="12" cy="8" r="3" fill="none" stroke="red" stroke-width="0.2"/>
      <circle cx="138" cy="8" r="3" fill="none" stroke="red" stroke-width="0.2"/>
      <text x="75" y="35" text-anchor="middle" font-size="14" font-family="serif" fill="blue">WELCOME</text>
    </svg>`,
  },
  {
    id: 'sign-arrow',
    name: 'Arrow Sign',
    category: 'signs',
    description: 'Directional arrow sign',
    tags: ['direction', 'decor'],
    svgWidth: 120,
    svgHeight: 40,
    svg: `<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg">
      <polygon points="2,20 30,2 30,12 118,12 118,28 30,28 30,38" fill="none" stroke="red" stroke-width="0.3"/>
      <circle cx="14" cy="20" r="3" fill="none" stroke="red" stroke-width="0.2"/>
    </svg>`,
  },
  {
    id: 'sign-round',
    name: 'Round Sign',
    category: 'signs',
    description: 'Circular sign with inner border',
    tags: ['decor', 'logo'],
    svgWidth: 100,
    svgHeight: 100,
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="none" stroke="red" stroke-width="0.3"/>
      <circle cx="50" cy="50" r="42" fill="none" stroke="green" stroke-width="0.2"/>
      <circle cx="50" cy="8" r="3" fill="none" stroke="red" stroke-width="0.2"/>
    </svg>`,
  },

  // ─── EARRINGS ───────────────────────────────────────────
  {
    id: 'earring-teardrop',
    name: 'Teardrop Earring',
    category: 'earrings',
    description: 'Classic teardrop shape',
    tags: ['jewelry', 'elegant'],
    svgWidth: 20,
    svgHeight: 40,
    svg: `<svg viewBox="0 0 20 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="4" r="1.5" fill="none" stroke="red" stroke-width="0.15"/>
      <path d="M10 8 C4 18, 4 28, 10 36 C16 28, 16 18, 10 8 Z" fill="none" stroke="red" stroke-width="0.2"/>
    </svg>`,
  },
  {
    id: 'earring-geometric',
    name: 'Geometric Earring',
    category: 'earrings',
    description: 'Hexagonal geometric design',
    tags: ['jewelry', 'modern'],
    svgWidth: 25,
    svgHeight: 45,
    svg: `<svg viewBox="0 0 25 45" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12.5" cy="4" r="1.5" fill="none" stroke="red" stroke-width="0.15"/>
      <polygon points="12.5,10 22,16 22,28 12.5,34 3,28 3,16" fill="none" stroke="red" stroke-width="0.2"/>
      <polygon points="12.5,15 18,18.5 18,25.5 12.5,29 7,25.5 7,18.5" fill="none" stroke="red" stroke-width="0.2"/>
    </svg>`,
  },
  {
    id: 'earring-leaf',
    name: 'Leaf Earring',
    category: 'earrings',
    description: 'Nature-inspired leaf shape',
    tags: ['jewelry', 'nature'],
    svgWidth: 18,
    svgHeight: 45,
    svg: `<svg viewBox="0 0 18 45" xmlns="http://www.w3.org/2000/svg">
      <circle cx="9" cy="4" r="1.5" fill="none" stroke="red" stroke-width="0.15"/>
      <path d="M9 10 C2 18, 2 32, 9 42 C16 32, 16 18, 9 10 Z" fill="none" stroke="red" stroke-width="0.2"/>
      <line x1="9" y1="14" x2="9" y2="38" stroke="green" stroke-width="0.15"/>
      <line x1="9" y1="20" x2="5" y2="17" stroke="green" stroke-width="0.15"/>
      <line x1="9" y1="25" x2="14" y2="22" stroke="green" stroke-width="0.15"/>
      <line x1="9" y1="30" x2="5" y2="27" stroke="green" stroke-width="0.15"/>
    </svg>`,
  },

  // ─── COASTERS ───────────────────────────────────────────
  {
    id: 'coaster-round',
    name: 'Round Coaster',
    category: 'coasters',
    description: 'Simple round coaster with concentric rings',
    tags: ['home', 'beginner'],
    svgWidth: 90,
    svgHeight: 90,
    svg: `<svg viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg">
      <circle cx="45" cy="45" r="43" fill="none" stroke="red" stroke-width="0.3"/>
      <circle cx="45" cy="45" r="38" fill="none" stroke="green" stroke-width="0.2"/>
      <circle cx="45" cy="45" r="20" fill="none" stroke="green" stroke-width="0.2"/>
    </svg>`,
  },
  {
    id: 'coaster-hex',
    name: 'Hexagon Coaster',
    category: 'coasters',
    description: 'Modern hexagonal coaster',
    tags: ['home', 'modern'],
    svgWidth: 90,
    svgHeight: 80,
    svg: `<svg viewBox="0 0 90 80" xmlns="http://www.w3.org/2000/svg">
      <polygon points="45,2 87,22 87,58 45,78 3,58 3,22" fill="none" stroke="red" stroke-width="0.3"/>
      <polygon points="45,10 78,26 78,54 45,70 12,54 12,26" fill="none" stroke="green" stroke-width="0.2"/>
    </svg>`,
  },
  {
    id: 'coaster-square',
    name: 'Square Coaster',
    category: 'coasters',
    description: 'Square coaster with decorative corners',
    tags: ['home', 'elegant'],
    svgWidth: 90,
    svgHeight: 90,
    svg: `<svg viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="86" height="86" rx="6" fill="none" stroke="red" stroke-width="0.3"/>
      <rect x="8" y="8" width="74" height="74" rx="3" fill="none" stroke="green" stroke-width="0.2"/>
      <line x1="8" y1="8" x2="20" y2="20" stroke="green" stroke-width="0.15"/>
      <line x1="82" y1="8" x2="70" y2="20" stroke="green" stroke-width="0.15"/>
      <line x1="8" y1="82" x2="20" y2="70" stroke="green" stroke-width="0.15"/>
      <line x1="82" y1="82" x2="70" y2="70" stroke="green" stroke-width="0.15"/>
    </svg>`,
  },

  // ─── ORNAMENTS ──────────────────────────────────────────
  {
    id: 'ornament-star',
    name: 'Star Ornament',
    category: 'ornaments',
    description: 'Five-pointed star with hanging hole',
    tags: ['christmas', 'holiday'],
    svgWidth: 50,
    svgHeight: 58,
    svg: `<svg viewBox="0 0 50 58" xmlns="http://www.w3.org/2000/svg">
      <circle cx="25" cy="5" r="2.5" fill="none" stroke="red" stroke-width="0.2"/>
      <polygon points="25,12 29,25 43,25 32,33 36,46 25,38 14,46 18,33 7,25 21,25" fill="none" stroke="red" stroke-width="0.25"/>
    </svg>`,
  },
  {
    id: 'ornament-snowflake',
    name: 'Snowflake Ornament',
    category: 'ornaments',
    description: 'Geometric snowflake',
    tags: ['christmas', 'winter'],
    svgWidth: 60,
    svgHeight: 68,
    svg: `<svg viewBox="0 0 60 68" xmlns="http://www.w3.org/2000/svg">
      <circle cx="30" cy="5" r="2.5" fill="none" stroke="red" stroke-width="0.2"/>
      <circle cx="30" cy="38" r="26" fill="none" stroke="red" stroke-width="0.25"/>
      <line x1="30" y1="12" x2="30" y2="64" stroke="red" stroke-width="0.2"/>
      <line x1="7" y1="25" x2="53" y2="51" stroke="red" stroke-width="0.2"/>
      <line x1="53" y1="25" x2="7" y2="51" stroke="red" stroke-width="0.2"/>
      <line x1="22" y1="16" x2="18" y2="12" stroke="red" stroke-width="0.15"/>
      <line x1="38" y1="16" x2="42" y2="12" stroke="red" stroke-width="0.15"/>
      <line x1="22" y1="60" x2="18" y2="64" stroke="red" stroke-width="0.15"/>
      <line x1="38" y1="60" x2="42" y2="64" stroke="red" stroke-width="0.15"/>
    </svg>`,
  },
  {
    id: 'ornament-bell',
    name: 'Bell Ornament',
    category: 'ornaments',
    description: 'Classic bell shape',
    tags: ['christmas', 'holiday'],
    svgWidth: 40,
    svgHeight: 55,
    svg: `<svg viewBox="0 0 40 55" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="5" r="2.5" fill="none" stroke="red" stroke-width="0.2"/>
      <path d="M20 10 C8 15, 4 30, 4 42 L36 42 C36 30, 32 15, 20 10 Z" fill="none" stroke="red" stroke-width="0.25"/>
      <ellipse cx="20" cy="42" rx="16" ry="4" fill="none" stroke="red" stroke-width="0.2"/>
      <circle cx="20" cy="48" r="3" fill="none" stroke="red" stroke-width="0.2"/>
    </svg>`,
  },

  // ─── GIFT TAGS ──────────────────────────────────────────
  {
    id: 'tag-classic',
    name: 'Classic Gift Tag',
    category: 'tags',
    description: 'Traditional gift tag shape',
    tags: ['gift', 'holiday'],
    svgWidth: 45,
    svgHeight: 80,
    svg: `<svg viewBox="0 0 45 80" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 20 L5 75 C5 77, 7 79, 10 79 L35 79 C38 79, 40 77, 40 75 L40 20 L22.5 2 L5 20 Z" fill="none" stroke="red" stroke-width="0.25"/>
      <circle cx="22.5" cy="16" r="3" fill="none" stroke="red" stroke-width="0.2"/>
      <line x1="10" y1="40" x2="35" y2="40" stroke="blue" stroke-width="0.2"/>
      <line x1="10" y1="48" x2="35" y2="48" stroke="blue" stroke-width="0.2"/>
      <line x1="10" y1="56" x2="28" y2="56" stroke="blue" stroke-width="0.2"/>
    </svg>`,
  },
  {
    id: 'tag-round',
    name: 'Round Gift Tag',
    category: 'tags',
    description: 'Circular gift tag',
    tags: ['gift', 'simple'],
    svgWidth: 50,
    svgHeight: 60,
    svg: `<svg viewBox="0 0 50 60" xmlns="http://www.w3.org/2000/svg">
      <circle cx="25" cy="35" r="23" fill="none" stroke="red" stroke-width="0.25"/>
      <circle cx="25" cy="8" r="3" fill="none" stroke="red" stroke-width="0.2"/>
      <line x1="25" y1="11" x2="25" y2="14" stroke="red" stroke-width="0.2"/>
    </svg>`,
  },

  // ─── STENCILS ───────────────────────────────────────────
  {
    id: 'stencil-star',
    name: 'Star Stencil',
    category: 'stencils',
    description: 'Star cutout stencil',
    tags: ['art', 'craft'],
    svgWidth: 80,
    svgHeight: 80,
    svg: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="76" height="76" rx="4" fill="none" stroke="red" stroke-width="0.3"/>
      <polygon points="40,10 47,30 68,30 51,42 58,62 40,50 22,62 29,42 12,30 33,30" fill="none" stroke="red" stroke-width="0.25"/>
    </svg>`,
  },
  {
    id: 'stencil-letter',
    name: 'Letter Stencil Set',
    category: 'stencils',
    description: 'Individual letter stencil frame',
    tags: ['art', 'text'],
    svgWidth: 50,
    svgHeight: 60,
    svg: `<svg viewBox="0 0 50 60" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="46" height="56" rx="3" fill="none" stroke="red" stroke-width="0.3"/>
      <text x="25" y="42" text-anchor="middle" font-size="36" font-family="Arial" font-weight="bold" fill="none" stroke="red" stroke-width="0.3">A</text>
    </svg>`,
  },
];

export function getTemplatesByCategory(category: string): Template[] {
  if (category === 'all') return TEMPLATES;
  return TEMPLATES.filter(t => t.category === category);
}

export function searchTemplates(query: string): Template[] {
  const q = query.toLowerCase();
  return TEMPLATES.filter(t =>
    t.name.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q) ||
    t.tags.some(tag => tag.includes(q))
  );
}
