export type LibraryCategory =
  | 'Laser Templates'
  | 'CNC Templates'
  | 'Test & Calibration'
  | 'Jigs & Fixtures'
  | 'Boxes & Joinery'
  | 'Signs & Plaques'
  | 'Decorative Artwork'
  | 'Icons & Symbols';

export type LibraryMachineMode = 'laser' | 'cnc';
export type LibraryEntryKind = 'owned-template' | 'bundled-artwork';
export type LibraryOperation =
  | 'line'
  | 'fill'
  | 'image'
  | 'profile'
  | 'pocket'
  | 'drill'
  | 'v-carve'
  | 'calibration';

export type LibrarySourceKind = 'owned' | 'lucide' | 'cc0' | 'public-domain';

export type LibraryProvenance = {
  readonly sourceKind: LibrarySourceKind;
  readonly license: string;
  readonly sourceUrl?: string;
  readonly downloadedAt?: string;
  readonly assetHash?: string;
  readonly notice?: string;
};

export type LibrarySvgInsert = {
  readonly kind: 'svg';
  readonly svgText: string;
};

export type LibraryGeneratedInsert = {
  readonly kind: 'generated-scene';
  readonly generatorId: string;
};

export type LibraryInsert = LibrarySvgInsert | LibraryGeneratedInsert;

export type LibraryEntry = {
  readonly id: string;
  readonly title: string;
  readonly category: LibraryCategory;
  readonly subcategory: string;
  readonly kind: LibraryEntryKind;
  readonly machineModes: ReadonlyArray<LibraryMachineMode>;
  readonly operations: ReadonlyArray<LibraryOperation>;
  readonly tags: ReadonlyArray<string>;
  readonly provenance: LibraryProvenance;
  readonly previewSvgText: string;
  readonly insert: LibraryInsert;
};
