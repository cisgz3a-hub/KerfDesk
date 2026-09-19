import type { Tutorial } from './tutorial-types';

export const TEXT_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'text',
    title: 'Type and edit text',
    summary: 'Place lettering on the canvas and keep the words editable.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 3,
    location: 'Left drawing toolbar → Text, Tools → Text, or T',
    prerequisites: 'An open project. Font rendering must finish before saving the text.',
    visual: 'text',
    steps: [
      {
        title: 'Click where the text belongs',
        instruction:
          'Choose Text or press T, then click an empty point on the canvas. Type your words. Press Enter to add another line.',
        focus: 'Click and type',
        result: 'Lettering appears at the chosen position with a live preview.',
      },
      {
        title: 'Choose the lettering style',
        instruction:
          'In Text formatting, choose Font and Size in millimetres. Set alignment, line height and spacing while watching the canvas.',
        focus: 'Font · Size · Spacing',
        result: 'The lettering updates before you commit it.',
      },
      {
        title: 'Finish and edit again',
        instruction:
          'Click Done or press Ctrl or Command plus Enter. To change the words later, choose Text and click the existing lettering.',
        focus: 'Done',
        result: 'The text remains editable in the project.',
      },
    ],
    tip: 'Weld overlaps joins touching outline letters while retaining editable text. Single-line fonts keep their engraving strokes.',
    keywords: ['text', 'font', 'lettering', 'type', 'words', 'size', 'weld'],
    related: ['text-layout', 'convert', 'operations'],
  },
  {
    id: 'text-layout',
    title: 'Bend text and follow a path',
    summary: 'Curve a heading or position letters along an existing vector guide.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 3,
    location: 'Text formatting → Bend or Path text',
    prerequisites: 'Editable text; a suitable vector guide in the project for Path text.',
    visual: 'text-path',
    steps: [
      {
        title: 'Try a simple bend',
        instruction:
          'Edit the text and change Bend. Negative values bend upward; positive values bend downward. Use zero to return to straight lettering.',
        focus: 'Bend',
        result: 'The text follows a circular arc.',
      },
      {
        title: 'Follow your own guide',
        instruction:
          'For a custom route, enable Path text and choose a Guide from the available vector paths. Adjust the text size and spacing to fit along the guide.',
        focus: 'Path text → Guide',
        result: 'The lettering is laid out along the selected path.',
      },
      {
        title: 'Position and inspect it',
        instruction:
          'Use Path offset to move the start along the guide and Reverse to change direction. Click Done, then inspect the guide and text operations separately in Preview.',
        focus: 'Path offset · Reverse',
        result: 'The heading follows the intended section and direction of the guide.',
      },
    ],
    tip: 'A guide is still project artwork. Check its Output setting if you only want the lettering included in the job.',
    keywords: ['text', 'bend', 'arc', 'path', 'guide', 'reverse', 'offset'],
    related: ['text', 'polyline', 'operations'],
  },
  {
    id: 'variable-text',
    title: 'Personalise with variable text',
    summary: 'Use CSV records, serial numbers and other fields in reusable lettering.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 4,
    location: 'Text formatting → Variable text',
    prerequisites: 'Editable text; a CSV with column headers if you want personalised records.',
    visual: 'variable-text',
    steps: [
      {
        title: 'Enable field evaluation',
        instruction:
          'Edit your text and turn on Variable text. Use an insert button such as Date or Serial. The Serial button inserts a four-digit field such as {{serial:4}}.',
        focus: 'Variable text → insert field',
        result:
          'The field can evaluate to the current value when the job is previewed or prepared.',
      },
      {
        title: 'Import personalised records',
        instruction:
          'Choose Import CSV and select your file. Use the CSV field button to insert the first column, then choose the current Record. The editor shows field syntax; finish with Done and open Preview to inspect evaluated values.',
        focus: 'Import CSV · Record',
        result: 'Text can use a value from the embedded data instead of a fixed word.',
      },
      {
        title: 'Define the sequence',
        instruction:
          'Set Record start and end, Serial start and Advance by. To wrap the counter, enable Wrap serial and set Serial end. Reset moves to the configured start; Previous and Next change the current Record and Serial.',
        focus: 'Sequence',
        result: 'The intended record range and numbering pattern are defined.',
      },
      {
        title: 'Choose when to advance',
        instruction:
          'Keep Manual while learning, or choose After completed job or After successful export. Click Done to save the text, inspect Preview and save the project.',
        focus: 'Advancement → Done',
        result: 'The saved variable settings govern when the next record or serial is used.',
      },
    ],
    tip: 'Variable text must be enabled for fields to evaluate. Review the actual record and serial for each output, especially when an advancement policy changes them automatically.',
    keywords: ['variable', 'csv', 'serial', 'sequence', 'personalise', 'records', 'date'],
    related: ['text', 'projects', 'preview'],
  },
];
