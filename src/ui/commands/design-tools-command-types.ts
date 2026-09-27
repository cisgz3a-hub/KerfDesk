// The AppCommandContext slice for LightBurn gap batch 5 (ADR-480), folded into
// the batch 3 slice so command-types.ts and use-app-commands.ts stay as they are.

export type DesignToolsCommandContext = {
  readonly selectContainedShapes: () => void;
  readonly selectSmallerShapes: () => void;
  readonly deleteDuplicates: () => void;
  readonly canEditSelectedPaths: boolean;
  readonly closeSelectedPaths: () => void;
  readonly reverseSelectedPaths: () => void;
  readonly addRubberBandOutline: () => void;
  readonly flattenImageMask: () => void;
};

export type DesignToolsCommandId =
  | 'edit.select-contained'
  | 'edit.select-smaller'
  | 'edit.delete-duplicates'
  | 'tools.close-paths'
  | 'tools.reverse-paths'
  | 'tools.rubber-band-outline'
  | 'tools.flatten-image-mask';
