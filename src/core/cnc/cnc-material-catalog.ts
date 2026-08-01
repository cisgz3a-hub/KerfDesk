// CNC stock material catalog. Species keep their identity in the project while
// resolving to the broader material-family calculation that has defensible
// chipload guidance. Exact board-specific values still require a test cut.

export type CncMaterialFamily = 'softwood' | 'hardwood' | 'plywood-mdf' | 'acrylic' | 'aluminum';

export type ChiploadMaterial =
  | CncMaterialFamily
  | 'softwood-cedar'
  | 'softwood-douglas-fir'
  | 'softwood-pine'
  | 'softwood-spruce'
  | 'hardwood-birch'
  | 'hardwood-cherry'
  | 'hardwood-hard-maple'
  | 'hardwood-mahogany'
  | 'hardwood-oak'
  | 'hardwood-poplar'
  | 'hardwood-walnut';

type CncMaterialChoice = {
  readonly value: ChiploadMaterial;
  readonly label: string;
  readonly family: CncMaterialFamily;
};

export type CncMaterialGroup = {
  readonly label: string;
  readonly materials: ReadonlyArray<CncMaterialChoice>;
};

export type CncMaterialPreset = CncMaterialChoice & {
  readonly group: string;
};

/** Grouped choices for CNC material selectors. */
export const CNC_MATERIAL_GROUPS: ReadonlyArray<CncMaterialGroup> = [
  {
    label: 'Softwoods',
    materials: [
      { value: 'softwood', label: 'Softwood (general)', family: 'softwood' },
      { value: 'softwood-cedar', label: 'Cedar', family: 'softwood' },
      { value: 'softwood-douglas-fir', label: 'Douglas fir', family: 'softwood' },
      { value: 'softwood-pine', label: 'Pine', family: 'softwood' },
      { value: 'softwood-spruce', label: 'Spruce', family: 'softwood' },
    ],
  },
  {
    label: 'Hardwoods',
    materials: [
      { value: 'hardwood', label: 'Hardwood (general)', family: 'hardwood' },
      { value: 'hardwood-birch', label: 'Birch', family: 'hardwood' },
      { value: 'hardwood-cherry', label: 'Cherry', family: 'hardwood' },
      { value: 'hardwood-hard-maple', label: 'Hard maple', family: 'hardwood' },
      { value: 'hardwood-mahogany', label: 'Mahogany', family: 'hardwood' },
      { value: 'hardwood-oak', label: 'Oak', family: 'hardwood' },
      { value: 'hardwood-poplar', label: 'Poplar', family: 'hardwood' },
      { value: 'hardwood-walnut', label: 'Walnut', family: 'hardwood' },
    ],
  },
  {
    label: 'Engineered wood',
    materials: [{ value: 'plywood-mdf', label: 'Plywood / MDF', family: 'plywood-mdf' }],
  },
  {
    label: 'Plastics',
    materials: [{ value: 'acrylic', label: 'Acrylic', family: 'acrylic' }],
  },
  {
    label: 'Metals',
    materials: [{ value: 'aluminum', label: 'Aluminum', family: 'aluminum' }],
  },
];

/** Flat catalog retained for labels and non-grouped consumers. */
export const CHIPLOAD_MATERIALS: ReadonlyArray<CncMaterialPreset> = CNC_MATERIAL_GROUPS.flatMap(
  (group) => group.materials.map((material) => ({ ...material, group: group.label })),
);

const MATERIAL_BY_KEY: ReadonlyMap<string, CncMaterialPreset> = new Map(
  CHIPLOAD_MATERIALS.map((material) => [material.value, material]),
);

/** Finds a known CNC material preset without accepting arbitrary saved keys. */
export function findCncMaterialPreset(value: unknown): CncMaterialPreset | null {
  return typeof value === 'string' ? (MATERIAL_BY_KEY.get(value) ?? null) : null;
}

/** Narrows an arbitrary value to a known CNC material key. */
export function isChiploadMaterialKey(value: unknown): value is ChiploadMaterial {
  return findCncMaterialPreset(value) !== null;
}

/** Resolves a species preset to the family calculation used for its settings. */
export function cncMaterialFamilyFor(material: ChiploadMaterial): CncMaterialFamily {
  const preset = MATERIAL_BY_KEY.get(material);
  if (preset !== undefined) return preset.family;
  if (
    material === 'softwood' ||
    material === 'hardwood' ||
    material === 'plywood-mdf' ||
    material === 'acrylic' ||
    material === 'aluminum'
  ) {
    return material;
  }
  return material.startsWith('softwood-') ? 'softwood' : 'hardwood';
}
