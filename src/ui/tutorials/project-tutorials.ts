import type { Tutorial } from './tutorial-types';

export const PROJECT_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'first-project',
    title: 'Make your first project',
    summary: 'Follow the route from artwork to a saved, previewed job.',
    category: 'Getting started',
    machine: 'all',
    minutes: 4,
    location: 'File → New, then the canvas and Artwork / Operations',
    prerequisites: 'Choose the correct machine type and project setup before preparing output.',
    visual: 'workspace',
    steps: [
      {
        title: 'Add something simple',
        instruction:
          'Start a new project. Use the rectangle tool to draw a small shape, or use Import to bring in an existing design.',
        focus: 'Draw or Import',
        result: 'The canvas contains the artwork you want to make.',
        visual: 'import',
      },
      {
        title: 'Set its size and purpose',
        instruction:
          'Select the artwork and enter its dimensions. In Artwork / Operations → Settings, choose what the machine should do, such as a laser Line or a CNC Profile.',
        focus: 'Artwork and operation',
        result: 'The geometry and its manufacturing operation are both defined.',
        visual: 'layers',
      },
      {
        title: 'Inspect the output',
        instruction:
          'Open Preview. Check the size, position, paths and enabled output. Follow the relevant operation tutorial to refine its settings.',
        focus: 'Preview',
        result: 'You can compare the planned output with the design before connecting or running.',
        visual: 'preview',
      },
      {
        title: 'Save your work',
        instruction:
          'Use File → Save As to save the editable project. Continue with Machine setup and Frame and Start when you are ready to prepare a physical run.',
        focus: 'Save As',
        result: 'Your artwork and project settings are available for a later session.',
        visual: 'library',
      },
    ],
    tip: 'You can learn drawing, editing and previewing without a connected machine. Tutorial illustrations are examples, not material settings.',
    keywords: ['beginner', 'first', 'start', 'new', 'workflow'],
    related: ['import', 'operations', 'preview', 'frame-start'],
  },
  {
    id: 'projects',
    title: 'Open and save projects',
    summary: 'Keep an editable project and make separate copies when a design changes.',
    category: 'Getting started',
    machine: 'all',
    minutes: 2,
    location: 'File menu or top toolbar',
    prerequisites: 'A new project, or a saved KerfDesk project file to open.',
    visual: 'library',
    steps: [
      {
        title: 'Start or continue',
        instruction:
          'Use File → New for a blank project. Use File → Open to continue a saved KerfDesk project. Import adds artwork to the project you already have.',
        focus: 'New · Open · Import',
        result: 'You are working in the intended document.',
      },
      {
        title: 'Save the editable version',
        instruction:
          'Choose File → Save As, select a location and give the project a recognisable name. Finish the save dialog offered by your browser or desktop app.',
        focus: 'Save As',
        result: 'The editable project is stored in a file.',
      },
      {
        title: 'Keep progress and alternatives',
        instruction:
          'Use Save or Ctrl+S as you work. Use Save As with a different filename before making a variation you want to keep separately.',
        focus: 'Save or save a copy',
        result: 'You can reopen the design or return to an earlier named version.',
      },
    ],
    tip: 'A G-code export is machine output. Keep the project file as well so the artwork and settings remain editable.',
    keywords: ['file', 'save', 'open', 'new', 'project', 'backup'],
    related: ['project-notes', 'import', 'gcode'],
  },
  {
    id: 'import',
    title: 'Import artwork',
    summary: 'Bring vectors, pictures or a supported model into the current project.',
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
          'Open Import and choose your artwork. SVG and DXF describe vector geometry; PNG and JPG contain image pixels. STL belongs to the CNC model workflow.',
        focus: 'Import picker',
        result: 'The importer uses the workflow for the selected file type.',
      },
      {
        title: 'Check the real size',
        instruction:
          'Select the imported artwork. Check its width, height and position on the canvas; resize it to the required physical dimensions.',
        focus: 'Dimensions in millimetres',
        result: 'The design fits your intended material area.',
        visual: 'select',
      },
      {
        title: 'Choose its next step',
        instruction:
          'Assign a suitable operation to vectors. In laser mode, Adjust Image prepares a bitmap for engraving. In either machine mode, Trace Image turns its features into editable vectors. Use the CNC relief workflow for an STL model.',
        focus: 'Artwork / Operations',
        result: 'The imported content follows the right process for the result you need.',
        visual: 'layers',
      },
    ],
    tip: 'A photograph does not become a cutting outline just by importing it. Trace a clear outline when you need vector geometry.',
    keywords: ['import', 'svg', 'dxf', 'png', 'jpg', 'stl', 'artwork'],
    related: ['trace', 'image-adjust', 'cnc-relief'],
  },
  {
    id: 'workspace',
    title: 'Find your way around',
    summary: 'Use the canvas, side panels and zoom controls comfortably.',
    category: 'Getting started',
    machine: 'all',
    minutes: 2,
    location: 'Main workspace and Window menu',
    prerequisites: 'An open project.',
    visual: 'workspace',
    steps: [
      {
        title: 'Learn the three areas',
        instruction:
          'Use the left toolbar to draw and edit. Use the canvas to position artwork. Use Artwork / Operations to inspect settings and the machine panel to prepare machine actions.',
        focus: 'Tools · canvas · settings',
        result: 'You know where each part of the workflow lives.',
      },
      {
        title: 'Zoom and pan',
        instruction:
          'Use + and − to zoom, F or 0 to fit the bed, and Shift+F to fit your selection. Hold Space while dragging, or right-drag, to pan.',
        focus: 'Fit and pan',
        result: 'You can inspect a small detail and return to the whole bed.',
      },
      {
        title: 'Make room',
        instruction:
          'Collapse a side panel when you need more canvas. F12 toggles both panels; Window → Reset Workspace Layout restores the standard visible layout.',
        focus: 'Window → Reset Workspace Layout',
        result: 'The workspace adapts without changing your artwork.',
      },
    ],
    tip: 'Zooming changes the view only. Use the artwork size fields when you want to change physical dimensions.',
    keywords: ['workspace', 'canvas', 'zoom', 'pan', 'panels', 'layout', 'fit'],
    related: ['select', 'shortcuts', 'operations'],
  },
  {
    id: 'shortcuts',
    title: 'Use keyboard shortcuts',
    summary: 'Learn a few repeatable actions and open the full reference when needed.',
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
        result: 'The current shortcut reference is visible in one place.',
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
          'Escape cancels the active drawing action. In the pen tool, Enter finishes an open path. In canvas text editing, Ctrl or Command plus Enter finishes text; plain Enter adds a line.',
        focus: 'Finish depends on the tool',
        result: 'You leave each editing mode deliberately.',
      },
    ],
    tip: 'Image Studio and Design Studio have their own tool shortcuts. Read the active tool hint because the same letter can mean something different there.',
    keywords: ['keyboard', 'shortcuts', 'hotkeys', 'undo', 'redo', 'escape'],
    related: ['workspace', 'text', 'polyline'],
  },
  {
    id: 'design-library',
    title: 'Use the Design Library',
    summary: 'Find a ready-made vector, inspect its details and add it to your design.',
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
        instruction:
          'Choose a card. Review its preview, details and exact licence information before using it in your project.',
        focus: 'Design details',
        result: 'You understand what you are adding and its usage terms.',
      },
      {
        title: 'Add and prepare it',
        instruction:
          'Use the add control for the chosen design. On the canvas, resize and position it, then inspect its operation settings.',
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
    summary: 'Store the details you will need when repeating or handing over a job.',
    category: 'Getting started',
    machine: 'all',
    minutes: 2,
    location: 'Window → Project Notes',
    prerequisites: 'An open project.',
    visual: 'history',
    steps: [
      {
        title: 'Open the notebook',
        instruction:
          'Choose Window → Project Notes. The notes field belongs to the current project.',
        focus: 'Project Notes',
        result: 'You can read or edit the project record.',
      },
      {
        title: 'Write useful context',
        instruction:
          'Record material identity, thickness, intended size and results of any real tests. Include changes that helped or still need checking.',
        focus: 'Notes',
        result: 'A future session has practical context rather than just a filename.',
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
