import type { Tutorial } from './tutorial-types';

export const RUN_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'frame-start',
    title: 'Frame, review and start the exact job',
    summary: 'Follow the sequence from a physical Frame to the final Start job action.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 4,
    location: 'Machine controls → Job',
    prerequisites:
      'For a real run, prepared artwork, the intended operation settings and origin, and a connected machine with suitable workholding.',
    visual: 'frame',
    steps: [
      {
        title: 'Finish the job you intend to run',
        instruction:
          'Review the operation settings, Output toggles, placement and any Selected artwork only choice. Use Preview to inspect the route before asking the machine to move.',
        focus: 'Exact artwork and placement',
        result: 'You have identified the job that will be prepared for Frame.',
        visual: 'preview',
      },
      {
        title: 'Complete the physical Frame',
        examplePhase: 0,
        instruction:
          'On the real machine, choose Frame job or Set up & Frame and watch the full generated motion envelope with the tool off. Wait for Frame to complete successfully.',
        focus: 'Frame job',
        result:
          'A completed Frame authorises the exact prepared job. An interrupted Frame does not.',
      },
      {
        title: 'Open Job Review at Start',
        examplePhase: 1,
        instruction:
          'Choose Start framed job. Job Review opens with the prepared job, operation values and warnings. Read those warnings and check that the physical workpiece and clearance match your intended run.',
        focus: 'Start framed job → Job Review',
        result: 'The review is shown at Start; ordinary Frame does not open this review dialog.',
        visual: 'frame',
      },
      {
        title: 'Make the final start decision',
        examplePhase: 2,
        instruction:
          'Choose Start job in the review when you intend to run. If you change the artwork, output settings or origin so the prepared job no longer matches, complete Frame again for the changed job.',
        focus: 'Start job',
        result: 'The reviewed, framed job is handed to the controller for this run.',
        visual: 'frame',
      },
    ],
    tip: 'Warnings remain information for your review. A completed Frame for the exact job is the ordinary Start policy gate; the controller and executable handoff must also be able to accept the run.',
    keywords: ['frame', 'start', 'run', 'job review', 'framed job', 'placement', 'warnings'],
    related: ['preview', 'origin', 'operations', 'cnc-probe', 'recovery'],
  },
  {
    id: 'preview',
    title: 'Watch the planned toolpath',
    summary: 'Play, pause and inspect the route before a real Frame or run.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 3,
    location: 'Top toolbar → Preview, Window → Preview, or P',
    prerequisites: 'A project with artwork and operations included in Output.',
    visual: 'preview',
    steps: [
      {
        title: 'Open the output preview',
        instruction:
          'Choose Preview from the toolbar or Window menu, or press P outside a text field. Check the shown output scope, especially if Selected artwork only is enabled.',
        focus: 'Preview',
        result: 'The workspace shows the planned route for the included artwork.',
      },
      {
        title: 'Separate cutting from travel',
        instruction:
          'Use the traversal-move display option to see movement between cutting paths. Read Cut, Travel and the displayed time estimate; for CNC also inspect plunge and depth information where available.',
        focus: 'Cut and travel',
        result: 'You can identify paths that process material and paths that move between them.',
      },
      {
        title: 'Play and inspect a section',
        instruction:
          'Use Play, Pause, Restart and the route progress control to inspect the sequence. Change preview Speed for viewing convenience; CNC pass controls appear when pass boundaries are available.',
        focus: 'Play · Pause · route progress',
        result:
          'You can examine the start, transitions and later passes without moving the real machine.',
      },
      {
        title: 'Return to the source of a problem',
        instruction:
          'If a path is missing, check Output and the selection scope. If the order or depth is wrong, return to the operation settings and preview the change before framing.',
        focus: 'Revise and preview',
        result: 'The revised route can be reviewed before any real movement.',
        visual: 'layers',
      },
    ],
    tip: 'Preview playback speed and travel visibility change the display. They do not change feed rates or emitted output, and the preview does not replace physical Frame.',
    keywords: [
      'preview',
      'simulate',
      'play',
      'pause',
      'scrub',
      'route',
      'travel',
      'time',
      'passes',
    ],
    related: ['operations', 'optimization', 'gcode', 'frame-start'],
  },
  {
    id: 'gcode',
    title: 'Inspect and export G-code',
    summary: 'Explore the generated program in 3D and save the output for the intended controller.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 3,
    location: 'File → Inspect G-code (3D), Open G-code or Save G-code',
    prerequisites: 'An output-ready project, or an existing program file to inspect.',
    visual: 'gcode',
    steps: [
      {
        title: 'Choose the program to inspect',
        instruction:
          'Use Inspect G-code (3D) for the current project output. Use Open G-code to inspect an existing program file. Check the program name so you know which source you are viewing.',
        focus: 'Inspect current / Open file',
        result: 'The inspector displays the selected program and its planned motion.',
      },
      {
        title: 'Relate source lines to motion',
        instruction:
          'Use the 3D view, timeline and source pane to inspect movement. Select a source line to locate it in preview playback and read any analysis or parsing limitations that are shown.',
        focus: 'Source line and 3D route',
        result: 'A program line can be related to its location in the displayed route.',
      },
      {
        title: 'Save the intended output',
        instruction:
          'Return to the project and check machine profile, placement and Output scope. Choose Save G-code, wait for preparation, then Save as. Choose a filename and folder, such as Downloads or Desktop. Read any export messages before using the file.',
        focus: 'Save G-code',
        result: 'The saved file contains the prepared export for the chosen setup.',
      },
    ],
    tip: 'Opening or inspecting G-code does not run it. Exporting a file also does not establish a completed Frame for a live job.',
    keywords: ['gcode', 'g-code', 'export', 'save', 'nc', 'inspector', 'source', '3d'],
    related: ['preview', 'machine-setup', 'origin', 'frame-start', 'cnc-surfacing'],
  },
];
