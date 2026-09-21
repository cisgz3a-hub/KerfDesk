import type { Tutorial } from './tutorial-types';

export const LAYOUT_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'align',
    title: 'Align artwork',
    summary: 'Line up objects using a chosen reference object.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 2,
    location: 'Arrange → Align commands',
    prerequisites: 'Two or more unlocked objects.',
    visual: 'align',
    steps: [
      {
        title: 'Choose the reference last',
        instruction:
          'Select the objects you want to move, then Shift-click the reference object last. Its edge or centre will be the alignment target.',
        focus: 'Last selected = reference',
        result: 'The selected group has a known alignment reference.',
      },
      {
        title: 'Choose an edge or centre',
        instruction:
          'Open Arrange. Choose Align Left, Right, Top or Bottom for edges. Align Center X lines up vertical centres; Align Center Y lines up horizontal centres.',
        focus: 'Arrange → Align',
        result: 'Objects move onto the chosen reference line.',
      },
      {
        title: 'Centre one design on another',
        instruction:
          'To put a smaller design in the middle of a larger shape, select the smaller design first and the larger shape last, then choose Align Centers.',
        focus: 'Align Centers',
        result: 'The centres overlap without resizing either object.',
      },
    ],
    tip: 'Alignment uses object bounds. Irregular visible shapes may still need a small visual adjustment.',
    keywords: ['align', 'centre', 'center', 'left', 'right', 'top', 'bottom'],
    related: ['select', 'distribute', 'array'],
  },
  {
    id: 'distribute',
    title: 'Space objects evenly',
    summary: 'Make an orderly row or column from three or more objects.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 2,
    location: 'Arrange → Distribute commands',
    prerequisites: 'At least three unlocked objects.',
    visual: 'distribute',
    steps: [
      {
        title: 'Set the overall spread',
        instruction:
          'Position the outer objects where the row or column should begin and end. Select every object to distribute.',
        focus: 'First and last positions',
        result: 'The selection establishes the available span.',
      },
      {
        title: 'Decide what should be equal',
        instruction:
          'Choose Distribute H Centers or V Centers for equal centre distances. Choose H Spacing or V Spacing for equal gaps between object bounds.',
        focus: 'Centres or gaps',
        result: 'You select the spacing rule that suits the design.',
      },
      {
        title: 'Check the row',
        instruction:
          'Inspect the new spacing. Use an alignment command if the objects should also share a baseline or centre line.',
        focus: 'Equal intervals',
        result: 'The objects form a consistent row or column.',
      },
    ],
    tip: 'For differently sized objects, equal gaps and equal centre distances produce different layouts.',
    keywords: ['distribute', 'spacing', 'gaps', 'row', 'column'],
    related: ['align', 'array'],
  },
  {
    id: 'array',
    title: 'Repeat artwork with an array',
    summary: 'Create a grid, rotate copies around a point, or place them on a circle.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 3,
    location: 'Arrange → Array',
    prerequisites: 'One or more selected objects to repeat.',
    visual: 'array',
    steps: [
      {
        title: 'Select the complete unit',
        instruction:
          'Select every object that belongs in one repeated design. Open Arrange → Array.',
        focus: 'Selection = one unit',
        result: 'The array repeats the complete selection.',
      },
      {
        title: 'Choose a pattern',
        instruction:
          'Grid uses Rows, Columns and gaps between repeated units. Circular places units around a chosen centre and radius. Point Rotation turns them about the selection centre; Copies includes the original, with Total angle divided equally by that count.',
        focus: 'Grid · Circular · Point Rotation',
        result: 'The dialog defines the number and placement of copies.',
      },
      {
        title: 'Create and inspect',
        instruction:
          'Click Create array. Check the complete arrangement against the bed or board, including the spaces between adjacent designs.',
        focus: 'Create array',
        result: 'The repeated artwork is present on the canvas and can be edited.',
      },
    ],
    tip: 'In Circular mode, Rotate copies turns each copy as it goes around the circle. Leave it off to keep the copies facing the same way.',
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
          'Select an object and open Settings. Find its named operation. Laser operations use Line, Fill or Image; CNC operations use their cut type and depth.',
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
          'Show controls whether the operation is drawn on the workspace. Output controls whether it is included in Preview and machine output. Check both deliberately.',
        focus: 'Show and Output',
        result: 'The enabled output matches the parts you intend to manufacture.',
      },
      {
        title: 'Review the sequence',
        instruction:
          'Open Run order and inspect the artwork sequence. Open Preview to check the resulting paths after changing operation settings or order.',
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
