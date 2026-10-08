import type { Tutorial } from './tutorial-types';

export const LAYOUT_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'align',
    title: 'Align artwork',
    summary: 'Line up edges or centre one design inside another.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 2,
    location: 'Arrange → Align commands',
    prerequisites: 'Two or more unlocked objects.',
    visual: 'align',
    steps: [
      {
        title: 'Choose what to line up with',
        instruction:
          'Select the objects to move. Shift-click the object you want to line up with last. This last object stays in place.',
        focus: 'Last selected = reference',
        result: 'The last object sets the alignment position.',
      },
      {
        title: 'Line up an edge',
        instruction:
          'Open Arrange. Choose Align Left to line up the left edges. You can also align right, top or bottom edges.',
        focus: 'Arrange → Align',
        result: 'The chosen edges line up.',
      },
      {
        title: 'Centre one design on another',
        instruction:
          'Select the smaller design first. Shift-click the larger shape last. Choose Arrange → Align Centers.',
        focus: 'Align Centers',
        result: 'The smaller design sits in the centre of the larger shape.',
      },
    ],
    tip: 'Alignment uses the box around each object. Irregular shapes may need a small adjustment by eye.',
    keywords: ['align', 'centre', 'center', 'left', 'right', 'top', 'bottom'],
    related: ['select', 'distribute', 'array'],
  },
  {
    id: 'distribute',
    title: 'Space objects evenly',
    summary: 'Give a row or column even gaps.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 2,
    location: 'Arrange → Distribute commands',
    prerequisites: 'At least three unlocked objects.',
    visual: 'distribute',
    steps: [
      {
        title: 'Place the two end objects',
        instruction:
          'Move the two end objects where you want the row or column to start and finish. Select all the objects.',
        focus: 'First and last positions',
        result: 'The end objects set the space to fill.',
      },
      {
        title: 'Make the gaps equal',
        instruction:
          'For a row, choose Arrange → Distribute H Spacing. For a column, choose Distribute V Spacing.',
        focus: 'Distribute H Spacing or Distribute V Spacing',
        result: 'The gaps between the objects become equal.',
      },
      {
        title: 'Check the row',
        instruction:
          'Check the gaps. Use an alignment command if you also want the objects on the same line.',
        focus: 'Equal intervals',
        result: 'The objects form a consistent row or column.',
      },
    ],
    tip: 'Distribute H Centers and Distribute V Centers make the centre distances equal. Differently sized objects may then have different gaps.',
    keywords: ['distribute', 'spacing', 'gaps', 'row', 'column'],
    related: ['align', 'array'],
  },
  {
    id: 'array',
    title: 'Repeat artwork with an array',
    summary: 'Repeat a design in rows and columns.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 3,
    location: 'Arrange → Array',
    prerequisites: 'One or more selected objects to repeat.',
    visual: 'array',
    steps: [
      {
        title: 'Select the design to repeat',
        instruction: 'Select all the objects in one copy of your design. Open Arrange → Array.',
        focus: 'Selection = one unit',
        result: 'The array repeats the complete selection.',
      },
      {
        title: 'Set rows and columns',
        instruction:
          'Choose Grid. Enter Rows and Columns. Set Horizontal spacing and Vertical spacing for the gaps between copies, or set Space by to Distance between centres.',
        focus: 'Grid · Rows · Columns',
        result: 'The grid size and gaps are set.',
      },
      {
        title: 'Create and inspect',
        instruction:
          'Click Create array. Check that the copies fit the bed or board. Check the gaps between designs.',
        focus: 'Create array',
        result: 'Your copies appear on the canvas.',
      },
    ],
    tip: 'Row shift and Mirror alternate columns nest bricks, hexagons and triangles. Circular places copies on a circle, all the way round or over part of it. Point Rotation turns copies around the selection centre; its Copies count includes the original.',
    keywords: ['array', 'repeat', 'copies', 'grid', 'circular', 'rotation'],
    related: ['nest', 'align', 'operations'],
  },
  {
    id: 'nest',
    title: 'Pack parts with Quick Nest',
    summary: 'Arrange selected parts inside the workspace or a placed board.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 3,
    location: 'Arrange → Quick Nest',
    prerequisites: 'Selected artwork; place a board first if it should define the boundary.',
    visual: 'nest',
    steps: [
      {
        title: 'Select the parts',
        instruction:
          'Select the items to pack. Group artwork that must stay together, such as a label and its outline, then open Quick Nest.',
        focus: 'Select parts or groups',
        result: 'The tool knows which units belong in the arrangement.',
      },
      {
        title: 'Define the available area',
        instruction:
          'Choose Workspace or Placed board. Enter Part spacing in millimetres. Choose permitted turns; Keep current grain axis restricts them to 0 and 180 degrees.',
        focus: 'Boundary and spacing',
        result: 'The packing uses your chosen area and gap.',
      },
      {
        title: 'Choose the arrangement goal',
        instruction:
          'Choose Compact for a smaller footprint, Tidy for a regular bounds arrangement, or Grid for uniform cell spacing. Compact offers Outline and Fast methods. Enable Try more arrangements to compare a bounded set of valid layouts.',
        focus: 'Compact · Tidy · Grid',
        result: 'The goal and permitted orientations are explicit before calculation.',
      },
      {
        title: 'Review and accept a valid draft',
        instruction:
          'Click Nest selection. Review the preview, stock utilisation, footprint and any bounds fallback. Stop search keeps the best complete valid draft. Accept best valid layout applies it in one undo step; Cancel leaves the artwork unchanged.',
        focus: 'Stop search · Accept best valid layout',
        result:
          'Only the accepted draft rearranges the artwork. A changed document requires a fresh calculation.',
      },
    ],
    tip: 'Groups remain rigid and locked artwork stays an obstacle. Allow room for your process when choosing the gap. The bounded search does not prove an optimum or a physical material result.',
    keywords: ['nest', 'packing', 'material', 'board', 'spacing', 'waste'],
    related: ['array', 'board', 'select'],
  },
  {
    id: 'joint-openings',
    title: 'Resize receiving joint openings',
    summary:
      'Review straight slots against measured material thickness and a separate fit allowance.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 3,
    location: 'Tools → Resize Joint Openings',
    prerequisites:
      'Selected unlocked imported or traced straight paths. Convert editable shapes or text to paths first.',
    visual: 'nodes',
    steps: [
      {
        title: 'Declare the original and target widths',
        instruction:
          'Enter Current opening width and Detection tolerance to find candidate geometry. Enter measured Material thickness and a separate Fit allowance. Positive allowance widens receiving openings; negative allowance tightens them.',
        focus: 'Current width · Thickness · Fit allowance',
        result: 'The resulting opening width is displayed before any geometry changes.',
      },
      {
        title: 'Verify each numbered feature',
        instruction:
          'Match the numbered preview to the candidate list. Select only the enclosed rectangles or inward U-slots intended to receive material. Changing dimensions clears the feature selection so you can review it again.',
        focus: 'Detected receiving features',
        result:
          'Ambiguous, curved, open and unsupported geometry is disclosed and stays unchanged.',
      },
      {
        title: 'Apply and test the fit',
        instruction:
          'Compare dashed original outlines with the solid result. Apply selected openings changes their width in one undo step while preserving their depth and centre. Review the job again and test a fit coupon with your actual stock and process.',
        focus: 'Apply selected openings',
        result:
          'The design change retains artwork identity and operations. It does not establish physical fit.',
      },
    ],
    tip: 'This bounded tool does not resize finger-joint depth, tabs or every feature in a thickness-dependent design. Tool diameter and kerf compensation remain separate operation settings.',
    keywords: ['joint', 'slot', 'thickness', 'fit', 'allowance'],
    related: ['box', 'box-fit', 'nodes'],
  },
  {
    id: 'fixtures',
    title: 'Save and review reusable fixtures',
    summary: 'Keep batch-placement geometry and its setup context in the project.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 4,
    location: 'Tools → Camera → Pieces on the bed → Reusable fixtures',
    prerequisites:
      'A reviewed Find pieces scan to save; select the design before reusing a fixture.',
    visual: 'array',
    steps: [
      {
        title: 'Save the intended layout',
        instruction:
          'Find pieces, include the intended blanks, and place the selected sample design on its own blank if its offset should be reused. Click Save current fixture and give the geometry a name.',
        focus: 'Save current fixture',
        result:
          'The project keeps included slot geometry, the sample frame, scene coordinate basis and available camera/height context.',
      },
      {
        title: 'Review every reuse',
        instruction:
          'Select the design for the next batch and open the saved fixture. Compare the proposed design frames with the numbered slots, read setup differences, and verify the actual fixture alignment and material height. Choose the included slots and confirm the placement review.',
        focus: 'Place reviewed selection',
        result:
          'The selection is moved and copied without scaling in one undo step. Current camera settings remain unchanged.',
      },
      {
        title: 'Record measured placement errors',
        instruction:
          'Use Record placement observations to enter expected and independently observed scene coordinates for known checkpoints. Add measurement notes and save. RMS, maximum and mean offsets describe these observations at their own recorded setup.',
        focus: 'Record placement observations',
        result:
          'Manual observations stay separate from the original calibration-fit residuals and from machine completion.',
      },
    ],
    tip: 'A saved fixture records intent; it does not prove that blanks, the camera or the machine origin remain in the same place. Review the resulting job and complete its ordinary Frame before Start.',
    keywords: ['fixture', 'jig', 'batch', 'camera', 'qualification', 'observation'],
    related: ['camera', 'array', 'nest'],
  },
  {
    id: 'stamp-preparation',
    title: 'Prepare a stamp height image',
    summary: 'Review a raised-face mask and measured taper without changing the source.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 4,
    location: 'Tools → Prepare Stamp',
    prerequisites: 'One raster with full pixel data, or only closed vector artwork.',
    visual: 'image-tone',
    steps: [
      {
        title: 'Choose the face and measured shoulder',
        instruction:
          'Select the artwork and open Prepare Stamp. Set the source threshold, measured taper width and optional mirror. Vector DPI sets sampling for vectors; raster pixels keep their resolution. Raw pixels and image masks define the face.',
        focus: 'Threshold · Taper · Mirror',
        result: 'The chosen dimensions and mirroring define a draft before artwork changes.',
      },
      {
        title: 'Review the three views',
        instruction:
          'Click Prepare preview. Compare Source, the mirrored Face mask and Height map. Check white flat faces, graded shoulders, black recesses and the full pixel/mm extent including the added margin. Stop preparation cancels the background work.',
        focus: 'Source · Face mask · Height map',
        result: 'You can check the sampled geometry and its physical pixel pitch.',
      },
      {
        title: 'Accept and qualify the process',
        instruction:
          'Confirm the review, then Apply as new image or Export PNG. The original stays unchanged. Set the displayed mm extent if importing the PNG elsewhere. Choose proportional laser power or CNC relief depth in the existing operation tools and test a physical coupon.',
        focus: 'Apply as new image · Export PNG',
        result:
          'One undoable image records design intent; material depth, power and stamp quality remain unqualified.',
      },
    ],
    tip: 'Image brightness, contrast, negative-image and operation settings are not baked into this preparation. Pixel pitch limits shoulder detail; no automatic depth or material calibration is inferred.',
    keywords: ['stamp', 'rubber', 'face', 'taper', 'mirror', 'height'],
    related: ['image-studio', 'operations', 'cnc-relief'],
  },
  {
    id: 'operations',
    title: 'Give artwork an operation',
    summary: 'Separate the shape you draw from what the machine will do to it.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 4,
    location: 'Artwork / Operations → Settings and Run order',
    prerequisites: 'Artwork on the canvas and the correct machine mode.',
    visual: 'layers',
    steps: [
      {
        title: 'Inspect the artwork settings',
        instruction:
          'Select an object and open Settings → Operation. Laser operations use Line, Fill or Image; CNC operations use their cut type and depth. The Artwork tab holds size, shape, image adjustments and path tools.',
        focus: 'Selected artwork operation',
        result: 'You can see the settings that belong to this artwork.',
      },
      {
        title: 'Check shared settings',
        instruction:
          'Read the Affects count before editing. If an operation is shared, use Make unique when only this selection should change. Add an operation when the artwork needs another process.',
        focus: 'Affects · Make unique · Add operation',
        result: 'The intended artwork receives the intended process.',
      },
      {
        title: 'Separate visibility from output',
        instruction:
          'Show on canvas controls whether the operation is drawn on the workspace. Include in output controls whether it is included in Preview and machine output. Both affect every artwork using a shared operation.',
        focus: 'Show on canvas · Include in output',
        result: 'The enabled output matches the parts you intend to manufacture.',
      },
      {
        title: 'Review the sequence',
        instruction:
          'Open Run order and inspect the numbered artwork sequence. Search or jump to a number in longer jobs; Edit settings returns to that artwork. Open Preview to check the resulting paths after changing settings or order.',
        focus: 'Run order → Preview',
        result: 'You can review the planned output as a sequence of operations.',
        visual: 'preview',
      },
    ],
    tip: 'Colours identify operations automatically. Read the operation name and settings when deciding how an object will be made.',
    keywords: ['operations', 'layers', 'settings', 'output', 'show', 'run order', 'unique'],
    related: ['laser-cut', 'laser-fill', 'cnc-profile', 'preview'],
  },
];
