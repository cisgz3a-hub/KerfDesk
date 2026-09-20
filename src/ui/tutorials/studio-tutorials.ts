import type { Tutorial } from './tutorial-types';

export const STUDIO_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'design-studio',
    title: 'Draw in Design Studio',
    summary: 'Build a drawing in a dedicated space, then apply it to the project.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 3,
    location: 'Left drawing toolbar → Design',
    prerequisites: 'An open project.',
    visual: 'workspace',
    steps: [
      {
        title: 'Open the drawing space',
        instruction:
          'Click Design on the left toolbar. Choose a drawing tool such as Line, Polyline, Rectangle, Circle or Arc. The bottom hint explains the active gesture.',
        focus: 'Design → drawing tool',
        result: 'You are editing the Studio drawing.',
      },
      {
        title: 'Draw and refine',
        instruction:
          'Create a shape, switch to Select and click it. Use its properties to set exact dimensions. Snap, Grid and Ortho help place further geometry.',
        focus: 'Select → properties',
        result: 'Your drawing takes shape with editable dimensions.',
        visual: 'measure',
      },
      {
        title: 'Send it to the project',
        instruction:
          'Choose Apply to add the drawing as project artwork and keep the Studio open, or Apply & Close to return to the workspace. Check the resulting operations and Preview.',
        focus: 'Apply & Close',
        result: 'The drawing is available for the normal project workflow.',
        visual: 'layers',
      },
    ],
    tip: 'Close keeps the Studio drawing without applying pending changes. Construction geometry is a guide and is left out of the applied output.',
    keywords: ['design', 'studio', 'drawing', 'sketch', 'apply'],
    related: ['design-precision', 'design-edit', 'studio-line', 'studio-rectangle'],
  },
  {
    id: 'design-precision',
    title: 'Draw to exact dimensions',
    summary: 'Use snapping and shape properties to create a drawing that fits.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 3,
    location: 'Design Studio → Snap, Ortho, Grid and shape properties',
    prerequisites: 'Design Studio open with a shape to inspect.',
    visual: 'measure',
    steps: [
      {
        title: 'Choose useful guides',
        instruction:
          'Turn on Grid to see the drawing scale and Snap to use grid and geometry targets. Ortho constrains drawing to horizontal and vertical directions.',
        focus: 'Grid · Snap · Ortho',
        result: 'The pointer uses the placement aids you selected.',
      },
      {
        title: 'Inspect the shape',
        instruction:
          'Choose Select and click a shape. Hover a dimension field to see what it measures on the drawing; read-only values describe derived measurements.',
        focus: 'Shape properties',
        result: 'The highlighted measurement connects a field to the geometry.',
      },
      {
        title: 'Enter an exact value',
        instruction:
          'Type into an editable dimension field and press Enter to apply. Escape cancels an unfinished field edit. Recheck neighbouring geometry after resizing.',
        focus: 'Value → Enter',
        result: 'The shape matches the entered dimension.',
      },
    ],
    tip: 'Studio measurements are in millimetres unless a field shows another unit. Use the flat 2D view for dimension call-outs.',
    keywords: ['precision', 'dimensions', 'snap', 'grid', 'ortho', 'design'],
    related: ['design-studio', 'studio-circle', 'studio-rectangle'],
  },
  {
    id: 'design-edit',
    title: 'Refine a Studio drawing',
    summary: 'Select, duplicate and round or flatten corners before applying a drawing.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 3,
    location: 'Design Studio → Select, shape properties and modify tools',
    prerequisites: 'A drawing in Design Studio.',
    visual: 'fillet',
    steps: [
      {
        title: 'Select the geometry',
        instruction:
          'Use Select and click a shape. Shift-click adds more shapes; drag a marquee to select several. Use the shape properties for a precise edit.',
        focus: 'Select',
        result: 'You can inspect and edit the intended geometry.',
      },
      {
        title: 'Duplicate or make a guide',
        instruction:
          'Use Duplicate in the shape inspector for a copy. Click Guide to mark the selected shape as construction geometry when it should be omitted from output.',
        focus: 'Duplicate · Guide',
        result: 'Repeated geometry and reference geometry have clear roles.',
      },
      {
        title: 'Finish the corners',
        instruction:
          'Choose Fillet to round a corner or Chamfer to flatten it. Enter the radius or distance in the options bar, click the corner and inspect the change before Apply.',
        focus: 'Fillet or Chamfer',
        result: 'The edited corners appear in the Studio drawing.',
      },
    ],
    tip: 'Use Undo inside Studio for a drawing edit. Applying the drawing to the project creates a project undo step.',
    keywords: ['design', 'edit', 'duplicate', 'construction', 'fillet', 'chamfer'],
    related: ['studio-fillet', 'studio-chamfer', 'design-precision'],
  },
];
