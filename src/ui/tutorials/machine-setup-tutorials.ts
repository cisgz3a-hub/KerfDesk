import type { Tutorial } from './tutorial-types';

export const MACHINE_SETUP_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'machine-setup',
    title: 'Set up the machine and current job',
    summary: 'Choose a machine, check the essentials, then review and save one setup draft.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 4,
    location: 'Machine Setup, or CNC Machine Setup in CNC mode',
    prerequisites:
      'The machine specifications, controller type and, for CNC, measured stock and cutter details.',
    visual: 'machine',
    steps: [
      {
        title: 'Choose your machine',
        instruction:
          'On Machine, plug the machine in by USB, switch it on and press Find my machine. KerfDesk reads its firmware, work area, speed and power range and fills them into the draft, listing each change with one Undo. Then check Laser only, CNC only or Laser + CNC, and pick a laser profile by clicking anywhere on its card, using search or Browse all profiles, or choose a CNC preset. To set up offline, choose Set up without connecting.',
        focus: 'Machine · Find my machine · profile',
        result: 'The draft setup has the correct kind of machine and controller.',
      },
      {
        title: 'Check the essentials',
        instruction:
          'On Essentials, check the work area, origin, homing and output or CNC machine limits against your equipment. You can move between all three stages while correcting values; any remaining errors must be fixed before Save.',
        focus: 'Essentials · work area · output',
        result: 'The draft describes the machine values you intend to save.',
        visual: 'settings',
      },
      {
        title: 'Open the options you need',
        instruction:
          'In Essentials, expand Accessories and calibration for the equipment you use. With CNC active, open CNC job setup for stock, Material, Default bit and Tool Plan. Choosing a material previews it; Apply material preset updates the draft. Artwork cutting values remain editable on the artwork.',
        focus: 'Accessories · CNC stock and tools',
        result: 'The setup describes the material and equipment the operation settings refer to.',
      },
      {
        title: 'Review and save',
        instruction:
          'On Review & save, inspect the summary cards and use Edit for corrections. Controller settings is optional; firmware changes need separate per-setting consent. Save commits the reviewed draft together. Cancel discards the draft and sends no queued settings. Read the pre-run checklist before using the machine.',
        focus: 'Review & save',
        result:
          'The reviewed setup is saved together, including controller writes only when the save action explicitly includes them.',
        visual: 'settings',
      },
    ],
    tip: 'A saved profile describes a setup. Physical clearance, origin and material behaviour still need to match the actual machine and workpiece.',
    keywords: [
      'setup',
      'startup',
      'machine',
      'controller',
      'profile',
      'stock',
      'safe z',
      'firmware',
    ],
    related: ['connection', 'tool-library', 'materials', 'origin', 'frame-start'],
  },
  {
    id: 'connection',
    title: 'Connect to the controller',
    summary: 'Select the machine connection and understand connected, ready and diagnostic states.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 3,
    location: 'Machine connection card → Connect, or Machine Setup → Machine → Find my machine',
    prerequisites:
      'A supported serial controller and the appropriate machine profile. File-only profiles use export instead.',
    visual: 'machine',
    steps: [
      {
        title: 'Check the selected controller',
        instruction:
          'Open Machine Setup and press Find my machine, or check the controller under Connection options. Close other software that already owns the same serial port.',
        focus: 'Selected controller',
        result: 'The connection attempt targets the driver and device you intend to use.',
        visual: 'settings',
      },
      {
        title: 'Choose the device',
        instruction:
          'Choose Connect. The first time, select the controller in the serial picker; after that Connect reuses the same port, and Connect automatically in the ⋯ menu connects when KerfDesk starts or the machine is plugged in. Use a different port… in that menu always shows the picker.',
        focus: 'Connect',
        result: 'The connection status changes and controller replies become available.',
      },
      {
        title: 'Read the live state',
        instruction:
          'Inspect the status and any connection or qualification message. If a read fails, use the offered retry or reconnect action and inspect Console for the actual reply.',
        focus: 'Status and connection message',
        result: 'You know whether the controller is connected and what condition it reports.',
        visual: 'console',
      },
    ],
    tip: 'Disconnect closes the current link while keeping permission. Forget Controller, in the ⋯ menu, also removes the browser permission and the remembered port. Neither action establishes the work origin.',
    keywords: [
      'connect',
      'serial',
      'usb',
      'port',
      'disconnect',
      'controller',
      'qualification',
      'forget',
    ],
    related: ['machine-setup', 'console', 'jog', 'origin', 'gcode'],
  },
  {
    id: 'jog',
    title: 'Position the head with Jog',
    summary: 'Understand step distance, jog speed and the difference between a click and a hold.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 3,
    location: 'Machine controls → Jog',
    prerequisites:
      'For real movement, a connected controller in a state that accepts jogging and a clear motion area.',
    visual: 'machine',
    steps: [
      {
        title: 'Choose distance and speed',
        instruction:
          'Find Step and Speed in Jog. Step is the distance of a single arrow click; Speed is the travel rate. Choose a smaller Step for fine placement and check the physical route before requesting a larger move.',
        focus: 'Step · Speed',
        result: 'Distance and travel rate are separate choices.',
      },
      {
        title: 'Understand directional movement',
        instruction:
          'The arrow pad requests movement in the indicated physical direction. On a real setup, begin with a small, clear move and observe the machine and position readout before making larger moves.',
        focus: 'Directional arrows',
        result: 'You can relate the arrow to head movement and the changing coordinates.',
      },
      {
        title: 'Use holds only where supported',
        instruction:
          'Some controllers offer continuous jogging by holding an arrow; the tooltip states when this is available. Releasing ends that request. Position the head at the intended reference before setting an origin.',
        focus: 'Click or supported hold',
        result:
          'A click requests one fixed step; a supported hold requests continued movement until release.',
        visual: 'origin',
      },
    ],
    tip: 'Jog changes the physical head position. It does not move selected artwork on the canvas or establish a new work origin by itself.',
    keywords: ['jog', 'arrows', 'position', 'step', 'speed', 'move head', 'continuous'],
    related: ['connection', 'origin', 'cnc-probe', 'frame-start'],
  },
  {
    id: 'origin',
    title: 'Place the job using an origin',
    summary: 'Match a point on the design to the workpiece and understand the placement modes.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 4,
    location: 'Machine controls → Origin and Placement',
    prerequisites:
      'Artwork at the intended size and a known workpiece reference. Available origin controls depend on the controller.',
    visual: 'origin',
    steps: [
      {
        title: 'Choose how the job is placed',
        instruction:
          'Read Start from. Absolute Coordinates uses the machine coordinate layout; Current Position places from the live head; User Origin uses a saved work reference. Verified Origin provides a guided hand-set workflow.',
        focus: 'Start from',
        result: 'You can see which reference determines where the artwork is placed.',
      },
      {
        title: 'Match the design anchor',
        instruction:
          'For a relative placement mode, choose a point in the Job origin grid. For example, a front-left anchor aligns the front-left of the job bounds to your chosen reference.',
        focus: 'Job origin grid',
        result: 'Changing the anchor changes which part of the design meets the reference point.',
      },
      {
        title: 'Set a User Origin when needed',
        instruction:
          'For User Origin, position the real head at the intended workpiece reference and use Set origin here. This sets XY; a CNC job needs its Z reference established separately.',
        focus: 'Set origin here',
        result: 'The current head location becomes the job’s XY reference.',
      },
      {
        title: 'Verify the exact placement',
        instruction:
          'Check Selected artwork only and its anchor option if you are running a selection. Complete Frame for this exact job and placement; changing the design or reference requires a new Frame.',
        focus: 'Frame the placement',
        result: 'The physical Frame shows the planned job envelope at the chosen reference.',
        visual: 'frame',
      },
    ],
    tip: 'Advanced origin can store a persistent controller origin. Read its confirmation carefully; resetting a temporary origin and clearing a stored origin are different actions.',
    keywords: [
      'origin',
      'placement',
      'absolute',
      'current position',
      'user origin',
      'anchor',
      'work zero',
      'selected artwork',
    ],
    related: ['jog', 'cnc-probe', 'registration', 'frame-start'],
  },
];
