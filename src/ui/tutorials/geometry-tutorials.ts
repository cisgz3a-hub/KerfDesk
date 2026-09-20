import type { Tutorial, TutorialVisual } from './tutorial-types';

function combineLesson(args: {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly preparation: string;
  readonly result: string;
  readonly tip: string;
  readonly visual: TutorialVisual;
}): Tutorial {
  return {
    id: args.id,
    title: args.title,
    summary: args.summary,
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 2,
    location: `Tools → ${args.title}`,
    prerequisites:
      'Unlocked closed vector contours. Duplicate your artwork first if you need the originals.',
    visual: args.visual,
    steps: [
      {
        title: 'Arrange the overlap',
        instruction: args.preparation,
        focus: 'Overlapping closed outlines',
        result: 'The overlap defines what the combine operation will keep or remove.',
      },
      {
        title: 'Select and combine',
        instruction: `Select the intended vector shapes together, then choose Tools → ${args.title}.`,
        focus: args.title,
        result: args.result,
      },
      {
        title: 'Inspect the new outline',
        instruction:
          'Zoom in to check the outer contour and holes. Undo if the result is unexpected, adjust the source overlap and try again.',
        focus: 'Resulting path',
        result: 'A checked vector result is ready for its operation settings.',
      },
    ],
    tip: args.tip,
    keywords: [args.id, 'boolean', 'combine', 'paths', 'overlap'],
    related: ['convert', 'nodes', 'operations'],
  };
}

export const GEOMETRY_TUTORIALS: readonly Tutorial[] = [
  combineLesson({
    id: 'weld',
    title: 'Weld',
    visual: 'weld',
    summary: 'Merge closed contours into a combined silhouette.',
    preparation:
      'Overlap two closed shapes where they should connect. Give them the same operation and settings; select both and use Use one operation for selection when they currently have independent operations.',
    result: 'The union keeps the covered area and removes the internal overlap boundary.',
    tip: 'Welding creates baked paths. For editable script text, use the Text formatting option Weld overlaps instead.',
  }),
  combineLesson({
    id: 'subtract',
    title: 'Subtract',
    visual: 'subtract',
    summary: 'Cut upper shapes out of the bottom-most selected shape.',
    preparation:
      'Create the base shape first, then create and position the cutting shape over it. The bottom-most selected object is the subject; the upper shapes are removed from it.',
    result: 'The bottom shape remains with the overlapping area cut out.',
    tip: 'A small circle fully inside a rectangle can make a hole. Selection click order does not choose the subject; stacking order does.',
  }),
  combineLesson({
    id: 'intersect',
    title: 'Intersect',
    visual: 'intersect',
    summary: 'Keep only the region shared by every selected shape.',
    preparation:
      'Position two or more closed shapes so they share the area you want to keep. For practice, partly overlap two circles.',
    result: 'Only the common overlap remains as the new vector result.',
    tip: 'If the selected shapes share no area, there is no intersection to keep.',
  }),
  combineLesson({
    id: 'exclude',
    title: 'Exclude',
    visual: 'exclude',
    summary: 'Remove overlap while keeping the remaining areas.',
    preparation:
      'Partly overlap two closed shapes. Identify the overlap that you want to remove while preserving the outside parts.',
    result: 'With two shapes, their shared area disappears and the non-overlapping parts remain.',
    tip: 'Try two shapes first. More shapes use an alternating overlap rule, so inspect each resulting region carefully.',
  }),
  {
    id: 'convert',
    title: 'Convert paths and bitmaps',
    summary: 'Make plain vector paths, or rasterise artwork in laser mode.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 3,
    location: 'Tools → Convert to Path; laser mode also offers Convert to Bitmap',
    prerequisites:
      'Selected vector artwork. Keep a duplicate if you need the original text or shape controls.',
    visual: 'nodes',
    steps: [
      {
        title: 'Choose the representation',
        instruction:
          'Use paths when you need nodes and contours. In laser mode, use a bitmap when you want to process the artwork as image pixels. Duplicate the source if you want both versions.',
        focus: 'Paths or pixels',
        result: 'You choose a conversion that matches the next task.',
      },
      {
        title: 'Make plain paths',
        instruction:
          'Choose Tools → Convert to Path to bake vector artwork into plain geometry. Then choose Edit nodes to reshape its outline.',
        focus: 'Convert to Path',
        result:
          'The outline is available for path editing; original text or shape parameters are no longer the editing model.',
      },
      {
        title: 'Create a bitmap in laser mode',
        instruction:
          'In laser mode, choose Convert to Bitmap. Set Render Type, DPI and Default Brightness, review the size estimate, then click Convert. In CNC mode, keep the converted paths for a vector operation.',
        focus: 'Render Type · DPI · Convert',
        result: 'Laser mode produces image pixels; CNC mode keeps vector paths for its cut types.',
        visual: 'image',
      },
    ],
    tip: 'Higher DPI increases the pixel count. It cannot add detail that was absent from the original artwork.',
    keywords: ['convert', 'path', 'bitmap', 'rasterise', 'rasterize', 'dpi', 'bake'],
    related: ['nodes', 'image-adjust', 'trace'],
  },
];
