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

export type LibrarySourceKind = 'owned' | 'tabler' | 'lucide' | 'cc0' | 'public-domain';

export type LibraryProvenance = {
  readonly sourceKind: LibrarySourceKind;
  readonly sourceName: string;
  readonly license: string;
  readonly licenseId: string;
  readonly creator?: string;
  readonly sourceUrl?: string;
  readonly licenseUrl?: string;
  readonly sourceVersion?: string;
  readonly downloadedAt?: string;
  readonly assetHash?: string;
  readonly notice?: string;
};

export type LibrarySvgInsert = {
  readonly kind: 'svg';
  readonly loadSvgText: () => Promise<string>;
};

export type LibraryGeneratedInsert = {
  readonly kind: 'generated-scene';
  readonly generatorId: string;
};

export type LibraryInsert = LibrarySvgInsert | LibraryGeneratedInsert;

export type LibraryPreviewSource =
  | {
      readonly kind: 'inline-svg';
      readonly svgText: string;
    }
  | {
      readonly kind: 'asset-url';
      readonly url: string;
    };

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
  readonly preview: LibraryPreviewSource;
  readonly insert: LibraryInsert;
};
