import type { Tutorial } from './tutorial-types';

export const CONTROLLER_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'console',
    title: 'Read the controller conversation',
    summary:
      'Find relevant controller replies, filter traffic and copy useful diagnostic information.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 3,
    location: 'Machine controls > Console, or Super console',
    prerequisites:
      'A controller connection for live traffic; existing transcript entries can be inspected without sending commands.',
    visual: 'console',
    steps: [
      {
        title: 'Read the response in context',
        instruction:
          'Open Console and find the entries around the action you are investigating. Read the app request and controller reply together, including any error or alarm explanation.',
        focus: 'Request and reply',
        result: 'A controller message is connected to the action that preceded it.',
      },
      {
        title: 'Show only the traffic you need',
        instruction:
          'Enable Show status for periodic reports or Show stream for job traffic. Open Super console when you need search, timestamps and source details; use its filters to narrow the transcript.',
        focus: 'Filters and search',
        result: 'The relevant replies are easier to see among repeated status or job lines.',
      },
      {
        title: 'Keep the useful evidence',
        instruction:
          'Choose Copy visible in Console, or copy the filtered Super console transcript. Check that the relevant action and error are included before sharing it for support.',
        focus: 'Copy visible',
        result: 'You have readable diagnostic text that preserves the surrounding context.',
      },
    ],
    tip: 'The command field and quick-command buttons send real controller requests. Use commands you understand for that controller; Clear only clears the transcript display.',
    keywords: [
      'console',
      'super console',
      'diagnostics',
      'log',
      'transcript',
      'error',
      'alarm',
      'status',
    ],
    related: ['connection', 'machine-setup', 'macros', 'recovery'],
  },
  {
    id: 'macros',
    title: 'Save a reusable Console command',
    summary: 'Name one command, add numeric variables if needed, and inspect its expanded form.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 3,
    location: 'Console or Super console > User macros',
    prerequisites:
      'A single controller command whose meaning you already understand. Saving a macro is local; running it sends to the controller.',
    visual: 'console',
    steps: [
      {
        title: 'Create a named template',
        instruction:
          'Expand User macros and choose New macro. Give it a descriptive Macro name and enter one known command in Macro command template.',
        focus: 'New macro',
        result: 'The editor holds a name and one command template.',
      },
      {
        title: 'Make repeated numbers editable',
        instruction:
          'Where your known command needs a variable number, use a named placeholder in double braces, such as {{distance}}. Choose Save macro to validate and store it locally.',
        focus: 'Numeric placeholders',
        result: 'The saved macro presents a number field for each placeholder.',
      },
      {
        title: 'Read the expanded command',
        instruction:
          'Select the saved macro and enter values for every variable. Read Expanded command in full. Use Edit to correct the template; Run user macro is the separate action that sends the displayed command.',
        focus: 'Expanded command',
        result: 'You can see exactly what would be sent before choosing to run it.',
      },
    ],
    tip: 'Macros are saved in this browser and represent one Console command each. They are not a multi-step job or an alternative to Frame and Start.',
    keywords: ['macro', 'template', 'command', 'variables', 'placeholder', 'user macros', 'local'],
    related: ['console', 'connection', 'frame-start'],
  },
  {
    id: 'recovery',
    title: 'Review an interrupted job',
    summary:
      'Understand the saved run, uncertain progress and the separate supervised recovery controls.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 4,
    location: 'Interrupted job saved card > Review',
    prerequisites:
      'A retained interrupted-job record. Review can be opened without starting recovery.',
    visual: 'history',
    steps: [
      {
        title: 'Open the saved run',
        instruction:
          'Choose Review on Interrupted job saved. Check the saved job identity, machine type and interruption reason before comparing it with the physical workpiece.',
        focus: 'Review saved job',
        result:
          'You are inspecting the retained run, even if another project is now open on the canvas.',
      },
      {
        title: 'Separate reported and physical progress',
        instruction:
          'Read the saved progress and diagnostics. Controller acknowledgements show accepted traffic; inspect the workpiece to determine what actually completed and whether the original reference is still valid.',
        focus: 'Progress evidence',
        result: 'The example distinguishes reported progress from a verified completed cut.',
        visual: 'console',
      },
      {
        title: 'Review the proposed restart',
        instruction:
          'For CNC, inspect Recovery boundary pass and the cutter, workholding and XY/Z review. The selected pass is recut from its beginning. Laser recovery reviews the archived program and its proposed restart through its own prompts.',
        focus: 'Recovery boundary and setup',
        result:
          'You can identify what will be repeated and what earlier work the recovery would omit.',
        visual: 'preview',
      },
      {
        title: 'Close or explicitly start recovery',
        instruction:
          'Choose Close to leave the review without movement. Start pass recovery or Start supervised recovery is a separate explicit action; read its current prompts and resolve physical uncertainty before choosing it.',
        focus: 'Close / explicit recovery action',
        result: 'Viewing a saved run never automatically resumes the machine.',
      },
    ],
    tip: 'Ordinary paused-job Resume and interrupted-job recovery are different flows. Do not treat the saved percentage as proof that a particular region finished.',
    keywords: [
      'recovery',
      'interrupted',
      'resume',
      'checkpoint',
      'saved run',
      'pass boundary',
      'disconnect',
    ],
    related: ['console', 'origin', 'cnc-probe', 'frame-start'],
  },
];
