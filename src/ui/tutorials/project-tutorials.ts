import type { Tutorial } from './tutorial-types';

export const PROJECT_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'first-project',
    title: 'Make your first project',
    summary: 'Draw a shape, check the preview and save your project.',
    category: 'Getting started',
    machine: 'all',
    minutes: 4,
    location: 'File → New, then the canvas and Artwork / Operations',
    prerequisites: 'Choose the correct machine type and project setup before preparing output.',
    visual: 'workspace',
    steps: [
      {
        title: 'Draw a shape',
        instruction:
          'Choose File → New. Choose Draw rectangle on the left toolbar. Drag on the canvas to draw a small rectangle.',
        focus: 'Draw rectangle',
        result: 'Your rectangle appears on the canvas.',
        visual: 'rectangle',
        examplePhase: 2,
      },
      {
        title: 'Set the size and operation',
        instruction:
          'Select the rectangle. In Settings → Artwork, set its size. Open Operation and choose a laser Line or CNC Profile.',
        focus: 'Artwork and operation',
        result: 'The shape has a size and an operation.',
        visual: 'layers',
      },
      {
        title: 'Check the preview',
        instruction:
          'Open Preview. Check the size, position and paths. Check that only the artwork you want is included.',
        focus: 'Preview',
        result: 'You can check the planned paths.',
        visual: 'preview',
      },
      {
        title: 'Save your work',
        instruction:
          'Choose File → Save As. Give the project a name and save it. Read Machine setup and Frame and Start before preparing a physical run.',
        focus: 'Save As',
        result: 'You can reopen and edit your project later.',
        visual: 'project-file',
      },
    ],
    tip: 'You can draw and use Preview without a connected machine. Tutorial pictures are examples, not material settings.',
    keywords: ['beginner', 'first', 'start', 'new', 'workflow'],
    related: ['import', 'operations', 'preview', 'frame-start'],
  },
  {
    id: 'projects',
    title: 'Open and save projects',
    summary: 'Save your work so you can edit it later.',
    category: 'Getting started',
    machine: 'all',
    minutes: 2,
    location: 'File menu or top toolbar',
    prerequisites: 'A new project, or a saved KerfDesk project file to open.',
    visual: 'project-file',
    steps: [
      {
        title: 'Start or continue',
        instruction:
          'Choose File → New for a blank project. Choose File → Open to continue a saved project. Import adds artwork to your current project.',
        focus: 'New · Open · Import',
        result: 'Your project is open on the canvas.',
      },
      {
        title: 'Save the editable version',
        instruction:
          'Choose File → Save As. Give the project a clear name. Finish the save dialog in your browser or desktop app.',
        focus: 'Save As',
        result: 'The editable project is stored in a file.',
      },
      {
        title: 'Save as you work',
        instruction:
          'Use Save or Ctrl+S as you work. Use Save As with a new filename to keep a separate copy.',
        focus: 'Save or save a copy',
        result: 'Your changes are saved in the chosen file.',
      },
    ],
    tip: 'A G-code export is machine output. Keep the project file as well so the artwork and settings remain editable.',
    keywords: ['file', 'save', 'open', 'new', 'project', 'backup'],
    related: ['project-notes', 'import', 'gcode'],
  },
  {
    id: 'import',
    title: 'Import artwork',
    summary: 'Add a design or picture from a file.',
    category: 'Getting started',
    machine: 'all',
    minutes: 3,
    location: 'File → Import, top toolbar Import, or Ctrl+I',
    prerequisites: 'An SVG, ASCII DXF, PNG, JPG or supported STL file.',
    visual: 'import',
    steps: [
      {
        title: 'Choose the file',
        instruction:
          'Open Import and choose your file. Use SVG or DXF for outlines, PNG or JPG for pictures, or STL for a CNC model.',
        focus: 'Import picker',
        result: 'Your file opens in the matching import tool.',
      },
      {
        title: 'Check the real size',
        instruction:
          'Select the imported artwork. Check its width and height in millimetres. Resize and position it to fit your material.',
        focus: 'Dimensions in millimetres',
        result: 'The design fits your intended material area.',
        visual: 'select',
      },
      {
        title: 'Choose its next step',
        instruction:
          'For vectors, choose an operation. Use Adjust Image in laser mode to prepare pictures, Trace Image to make editable outlines, or CNC relief for STL models.',
        focus: 'Artwork / Operations',
        result: 'You have a next step for the imported artwork.',
        visual: 'layers',
      },
    ],
    tip: 'Importing a picture does not create a cutting outline. Use Trace Image when you need editable paths.',
    keywords: ['import', 'svg', 'dxf', 'png', 'jpg', 'stl', 'artwork'],
    related: ['trace', 'image-adjust', 'cnc-relief'],
  },
  {
    id: 'workspace',
    title: 'Find your way around',
    summary: 'Find the tools and move around the canvas.',
    category: 'Getting started',
    machine: 'all',
    minutes: 2,
    location: 'Main workspace and Window menu',
    prerequisites: 'An open project.',
    visual: 'workspace-basics',
    steps: [
      {
        title: 'Find the tools',
        instruction:
          'Use the left toolbar to draw. Place artwork on the canvas. Find settings in Artwork / Operations and machine controls in the machine panel.',
        focus: 'Tools · canvas · settings',
        result: 'You know where to draw and find settings.',
      },
      {
        title: 'Zoom and pan',
        instruction:
          'Use + and − to zoom. Hold Space while dragging to move the view. Press F to see the whole bed again.',
        focus: 'Fit and pan',
        result: 'You can inspect a small detail and return to the whole bed.',
      },
      {
        title: 'Make room',
        instruction:
          'Collapse a side panel for more canvas space. Choose Window → Reset Workspace Layout to restore the usual layout.',
        focus: 'Window → Reset Workspace Layout',
        result: 'You have more room to see your artwork.',
      },
    ],
    tip: 'Zoom changes the view. It does not change the size of your artwork.',
    keywords: ['workspace', 'canvas', 'zoom', 'pan', 'panels', 'layout', 'fit'],
    related: ['select', 'shortcuts', 'operations'],
  },
  {
    id: 'shortcuts',
    title: 'Use keyboard shortcuts',
    summary: 'Learn a few keys for common tasks.',
    category: 'Getting started',
    machine: 'all',
    minutes: 2,
    location: 'Top toolbar → Keyboard Shortcuts',
    prerequisites: 'Focus the canvas when using workspace shortcuts.',
    visual: 'settings',
    steps: [
      {
        title: 'Open the reference',
        instruction:
          'Click Keyboard Shortcuts in the top toolbar. Browse the File, Tools, Edit, Transform and View groups, then the final group named after your machine.',
        focus: 'Keyboard Shortcuts',
        result: 'You can look up a shortcut when you need it.',
      },
      {
        title: 'Practise three useful keys',
        instruction:
          'Close the reference. Use F to fit the bed, Ctrl+D to duplicate selected artwork, and Ctrl+Z to undo the duplication.',
        focus: 'F · Ctrl+D · Ctrl+Z',
        result: 'You can navigate, repeat and undo common work quickly.',
      },
      {
        title: 'Know the two job keys',
        instruction:
          'The last group is named after your machine. Ctrl+Enter runs the same Start flow as the Start button, so it still needs a connected machine and a completed Frame. Ctrl+. aborts a running job, or cancels a jog, from any window.',
        focus: 'Ctrl+Enter · Ctrl+.',
        result:
          'Start behaves exactly as the button does, and Abort stays reachable while you type.',
      },
      {
        title: 'Finish or leave a tool',
        instruction:
          'Press Escape to cancel drawing. Press Enter to finish an open pen path. For text, Ctrl or Command plus Enter finishes; Enter adds a line.',
        focus: 'Finish depends on the tool',
        result: 'You can finish or cancel the current edit.',
      },
    ],
    tip: 'Image Studio and Design Studio have their own tool shortcuts. Read the active tool hint because the same letter can mean something different there.',
    keywords: ['keyboard', 'shortcuts', 'hotkeys', 'undo', 'redo', 'escape'],
    related: ['workspace', 'text', 'polyline'],
  },
  {
    id: 'design-library',
    title: 'Use the Design Library',
    summary: 'Find a ready-made design and add it to the canvas.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 2,
    location: 'Left drawing toolbar → Lib',
    prerequisites: 'An open project.',
    visual: 'library',
    steps: [
      {
        title: 'Browse or search',
        instruction:
          'Click Lib on the left toolbar. Choose a collection or search for the kind of design you need.',
        focus: 'Search and collections',
        result: 'Matching designs appear as visual cards.',
      },
      {
        title: 'Inspect a design',
        instruction: 'Choose a design. Check its preview and licence before using it.',
        focus: 'Design details',
        result: 'You know what the design looks like and how you may use it.',
      },
      {
        title: 'Add and prepare it',
        instruction:
          'Add the design to the canvas. Set its size and position. Check its operation settings.',
        focus: 'Add to canvas',
        result: 'The design becomes editable vector artwork in your project.',
      },
    ],
    tip: 'Library artwork does not select material or machine settings for you. Preview the geometry at the size you intend to make.',
    keywords: ['library', 'design', 'template', 'artwork', 'icons', 'licence'],
    related: ['select', 'operations', 'array'],
  },
  {
    id: 'project-notes',
    title: 'Keep project notes',
    summary: 'Save useful details with your project.',
    category: 'Getting started',
    machine: 'all',
    minutes: 2,
    location: 'Window → Project Notes',
    prerequisites: 'An open project.',
    visual: 'project-notes',
    steps: [
      {
        title: 'Open the notebook',
        instruction:
          'Choose Window → Project Notes. The notes field belongs to the current project.',
        focus: 'Project Notes',
        result: 'You can read or edit the project record.',
      },
      {
        title: 'Write a few notes',
        instruction:
          'Write down the material, thickness and intended size. Add any test results and things you still need to check.',
        focus: 'Notes',
        result: 'You have a record to use next time.',
      },
      {
        title: 'Save notes and project',
        instruction:
          'Click Save Notes to update the project, then use File → Save to write the project file.',
        focus: 'Save Notes → Save',
        result: 'The notes travel with the saved project.',
      },
    ],
    tip: 'Record measured results separately from planned settings so a later user can tell what has actually been tried.',
    keywords: ['notes', 'record', 'project', 'handover', 'repeat'],
    related: ['projects', 'material-test'],
  },
];
