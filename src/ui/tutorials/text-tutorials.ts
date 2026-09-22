import type { Tutorial } from './tutorial-types';

export const TEXT_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'text',
    title: 'Type and edit text',
    summary: 'Add words and choose their font and size.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 3,
    location: 'Left drawing toolbar → Text, Tools → Text, or T',
    prerequisites: 'An open project. Font rendering must finish before saving the text.',
    visual: 'text',
    steps: [
      {
        title: 'Add your words',
        instruction:
          'Choose Text. Click an empty spot on the canvas and type your words. Press Enter to add another line.',
        focus: 'Click and type',
        result: 'Your words appear on the canvas.',
      },
      {
        title: 'Choose a font and size',
        instruction:
          'In Text formatting, choose a Font. Set Size in millimetres. Check the result on the canvas.',
        focus: 'Font · Size',
        result: 'You can see the font and size before saving.',
      },
      {
        title: 'Finish and edit again',
        instruction:
          'Click Done to finish. To change the words later, choose Text and click the lettering.',
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
    summary: 'Curve your words or fit them along a drawn path.',
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
          'Edit the text. Change Bend: negative bends upward, positive bends downward, and zero makes the text straight.',
        focus: 'Bend',
        result: 'Your words follow a curve.',
        examplePhase: 1,
      },
      {
        title: 'Follow your own guide',
        instruction:
          'Turn on Path text. Choose a Guide from your drawn paths. Adjust the text size and spacing to fit.',
        focus: 'Path text → Guide',
        result: 'Your words follow the chosen path.',
      },
      {
        title: 'Position and inspect it',
        instruction:
          'Use Path offset to move the start. Use Reverse to change direction. Click Done. In Preview, check the guide and text operations separately.',
        focus: 'Path offset · Reverse',
        result: 'The words sit where you want them on the guide.',
      },
    ],
    tip: 'A guide is still project artwork. Check Include in output if you only want the lettering in the job.',
    keywords: ['text', 'bend', 'arc', 'path', 'guide', 'reverse', 'offset'],
    related: ['text', 'polyline', 'operations'],
  },
  {
    id: 'variable-text',
    title: 'Personalise with variable text',
    summary: 'Use names from a CSV file or add serial numbers.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 4,
    location: 'Text formatting → Variable text',
    prerequisites: 'Editable text; a CSV with column headers if you want personalised records.',
    visual: 'variable-text',
    steps: [
      {
        title: 'Add a changing field',
        instruction:
          'Edit the text. Turn on Variable text. Click Date or Serial to insert a field. Serial adds a four-digit number field such as {{serial:4}}.',
        focus: 'Variable text → insert field',
        result: 'The editor shows a field such as {{serial:4}}.',
      },
      {
        title: 'Import personalised records',
        instruction:
          'Choose Import CSV and select your file. Click the CSV button labelled with your first column. Choose a Record. Click Done and open Preview to see its value.',
        focus: 'Import CSV · Record',
        result: 'The text uses a value from your CSV file.',
      },
      {
        title: 'Set the sequence',
        instruction:
          'Edit the text again. Set Record start and end. Set Serial start and Advance by. To repeat the numbering, turn on Wrap serial and set Serial end.',
        focus: 'Sequence',
        result: 'Your record range and numbering are set.',
      },
      {
        title: 'Choose when to advance',
        instruction:
          'Keep Manual while learning. Use Previous and Next to change the current Record and Serial. Click Done. Check Preview and save the project.',
        focus: 'Advancement → Done',
        result: 'You choose when to use the next record or number.',
      },
    ],
    tip: 'Variable text must be enabled. Check the record and serial before each output. After completed job and After successful export advance them automatically.',
    keywords: ['variable', 'csv', 'serial', 'sequence', 'personalise', 'records', 'date'],
    related: ['text', 'projects', 'preview'],
  },
];
