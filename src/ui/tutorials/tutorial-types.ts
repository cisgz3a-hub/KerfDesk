export const TUTORIAL_CATEGORIES = [
  'Getting started',
  'Drawing & editing',
  'Images & tracing',
  'Layout & production',
  'Laser',
  'CNC',
  'Machine & setup',
] as const;

export type TutorialCategory = (typeof TUTORIAL_CATEGORIES)[number];
export type TutorialMachine = 'all' | 'laser' | 'cnc';

/** Small, local illustrations. They never read or modify the working project. */
export type TutorialVisual =
  | 'workspace'
  | 'import'
  | 'select'
  | 'nodes'
  | 'measure'
  | 'rectangle'
  | 'ellipse'
  | 'circle'
  | 'arc'
  | 'polygon'
  | 'star'
  | 'line'
  | 'polyline'
  | 'text'
  | 'text-path'
  | 'variable-text'
  | 'align'
  | 'distribute'
  | 'array'
  | 'nest'
  | 'weld'
  | 'subtract'
  | 'intersect'
  | 'exclude'
  | 'offset'
  | 'fillet'
  | 'trim'
  | 'dogbone'
  | 'image'
  | 'image-paint'
  | 'image-select'
  | 'image-fill'
  | 'image-retouch'
  | 'image-crop'
  | 'image-layers'
  | 'image-transform'
  | 'image-text'
  | 'image-tone'
  | 'mask'
  | 'trace'
  | 'layers'
  | 'laser-line'
  | 'laser-fill'
  | 'raster'
  | 'profile'
  | 'engrave'
  | 'pocket'
  | 'vcarve'
  | 'drill'
  | 'tabs'
  | 'relief'
  | 'machine'
  | 'origin'
  | 'probe'
  | 'frame'
  | 'preview'
  | 'gcode'
  | 'camera'
  | 'jig'
  | 'board'
  | 'rotary'
  | 'print-cut'
  | 'box'
  | 'box-fit'
  | 'cnc-tiling'
  | 'cnc-inlay'
  | 'calibration'
  | 'scan-offset'
  | 'interval-test'
  | 'library'
  | 'settings'
  | 'history'
  | 'console';

export type TutorialStep = {
  readonly title: string;
  readonly instruction: string;
  /** Short label on the illustration, identifying the control or action. */
  readonly focus: string;
  readonly result: string;
  readonly visual?: TutorialVisual;
  /** A lesson can have more written steps than the three example stages. */
  readonly examplePhase?: 0 | 1 | 2;
};

export type Tutorial = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: TutorialCategory;
  readonly machine: TutorialMachine;
  readonly minutes: number;
  readonly location: string;
  readonly prerequisites: string;
  readonly visual: TutorialVisual;
  readonly steps: readonly [TutorialStep, TutorialStep, TutorialStep, ...TutorialStep[]];
  readonly tip: string;
  readonly keywords: readonly string[];
  readonly related: readonly string[];
};
