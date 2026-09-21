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
          'Choose Grid. Enter Rows and Columns. Set Horizontal spacing and Vertical spacing for the gaps between copies.',
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
    tip: 'Circular places copies on a circle. Point Rotation turns copies around the selection centre; its Copies count includes the original.',
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
          'Choose Workspace or Placed board. Enter Part spacing in millimetres and decide whether 90-degree rotation is acceptable.',
        focus: 'Boundary and spacing',
        result: 'The packing uses your chosen area and gap.',
      },
      {
        title: 'Choose a method and nest',
        instruction:
          'Use Outline for closed vector parts, including concave outlines and holes. Use Fast for rectangular bounds or mixed image selections. Click Nest selection and inspect the result.',
        focus: 'Outline or Fast',
        result: 'The selected artwork is rearranged, or a message explains why it could not fit.',
      },
    ],
    tip: 'Disable rotation when grain, print direction or another orientation matters. Allow room for your process when choosing the gap.',
    keywords: ['nest', 'packing', 'material', 'board', 'spacing', 'waste'],
    related: ['array', 'board', 'select'],
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
