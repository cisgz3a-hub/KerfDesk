import type { Tutorial } from './tutorial-types';

export const CNC_UTILITY_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'cnc-inlay',
    title: 'Create a matching pocket and insert',
    summary: 'Use an inlay pair to generate a linked pocket and mirrored insert from one outline.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 3,
    location: 'Select closed artwork → Cut type: Inlay pair (pocket + insert)',
    prerequisites: 'CNC mode, closed vector artwork and an end mill assigned to the operation.',
    visual: 'cnc-inlay',
    steps: [
      {
        title: 'Choose the shared outline',
        instruction:
          'Select the closed artwork and choose Inlay pair (pocket + insert). The generated pair contains a pocket and a mirrored insert placed beside it.',
        focus: 'Inlay pair (pocket + insert)',
        result: 'Both pieces derive from the same outline.',
      },
      {
        title: 'Set the two depths and fit',
        instruction:
          'Set Insert depth for the insert profile and Pocket depth for the recess. Set Fit clearance for the intended gap at each edge, using a sample fit to establish the value.',
        focus: 'Insert depth · Pocket depth · Fit clearance',
        result:
          'The two parts have independent depths and a defined allowance for fitting together.',
      },
      {
        title: 'Check the pair in Preview',
        instruction:
          'Set Pair spacing to separate the generated parts. Open Preview and inspect the pocket, mirrored insert, full footprint and any holding tabs before preparing the physical setup.',
        focus: 'Pair spacing and preview',
        result: 'You can see both generated pieces and their placement in the planned output.',
      },
    ],
    tip: 'This is an end-mill pocket-and-insert operation. Use the separate V-carve lesson for angled-bit lettering whose depth follows stroke width.',
    keywords: [
      'inlay',
      'insert',
      'pocket',
      'fit clearance',
      'pair spacing',
      'mirrored',
      'end mill',
    ],
    related: ['cnc-pocket', 'cnc-profile', 'cnc-tabs', 'tool-library', 'preview'],
  },
  {
    id: 'cnc-probe',
    title: 'Set work zero with a touch plate',
    summary:
      'Understand Z-only and corner probing, measured plate geometry and the completion message.',
    category: 'Machine & setup',
    machine: 'cnc',
    minutes: 4,
    location: 'Machine controls → Probe (touch plate)',
    prerequisites:
      'For real probing, a connected supported controller and probe, measured plate and cutter, stopped spindle and clear setup.',
    visual: 'probe',
    steps: [
      {
        title: 'Choose what to zero',
        instruction:
          'Expand Probe (touch plate). Choose Z only (stock top) for the vertical reference, or XYZ corner to establish a stock corner. Corner probing requires a cylindrical end mill.',
        focus: 'Z only / XYZ corner',
        result:
          'The illustration shows the difference between a surface-height reference and a full corner reference.',
      },
      {
        title: 'Describe the physical plate',
        instruction:
          'Enter measured Plate thickness and appropriate Max travel. For XYZ corner, choose the actual Corner and enter Bit diameter, Plate center offsets, Side probe drop and Side clearance.',
        focus: 'Measured plate geometry',
        result: 'The planned contacts correspond to the plate and cutter actually being used.',
      },
      {
        title: 'Observe the complete probe cycle',
        instruction:
          'Wait for Idle with the spindle stopped. On the prepared real setup, Run probe starts physical movement. Watch the contacts and wait for confirmation that work zero is set and motion is settled; a partial cycle is not a completed zero.',
        focus: 'Run probe and completion',
        result:
          'The successful cycle places Z zero on the stock top, with XY also established for corner mode.',
      },
      {
        title: 'Remove the plate and prepare the job',
        instruction:
          'Remove the touch plate and lead from the stock and cutter, then choose Dismiss reminder. Check the job placement and complete its ordinary Frame before Start and Job Review.',
        focus: 'Remove plate · Dismiss reminder',
        result: 'The probing equipment is clear and the next job can be physically framed.',
        visual: 'frame',
      },
    ],
    tip: 'Set origin here establishes XY only. A CNC cutter also needs the correct Z reference; probing and manual Zero Z are separate ways to establish it.',
    keywords: [
      'probe',
      'touch plate',
      'z zero',
      'work zero',
      'corner',
      'plate thickness',
      'zero z',
    ],
    related: ['origin', 'jog', 'tool-library', 'machine-setup', 'frame-start'],
  },
  {
    id: 'cnc-surfacing',
    title: 'Generate a spoilboard surfacing file',
    summary: 'Describe a facing area and save its separate serpentine program for inspection.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 3,
    location: 'Machine controls → Surface spoilboard',
    prerequisites:
      'CNC mode with the intended active bit, machine limits and stock footprint configured.',
    visual: 'pocket',
    steps: [
      {
        title: 'Define the area to face',
        instruction:
          'Open Surface spoilboard. Check Width and Height, which initially follow the stock footprint. Enter the actual rectangular area that you intend to surface.',
        focus: 'Width · Height',
        result: 'The facing program covers the defined rectangle.',
      },
      {
        title: 'Choose row spacing and removal',
        instruction:
          'Set Stepover % relative to the active bit diameter and Total depth for the intended material removal. Review the active bit and machine settings because this utility generates its own standalone cutting program.',
        focus: 'Stepover % · Total depth',
        result: 'The example shows overlapping serpentine rows across the face.',
      },
      {
        title: 'Save and inspect the separate program',
        instruction:
          'Choose Save surfacing G-code and a destination. Read the save messages, then use Open G-code to inspect the saved file, including depths, feeds, spindle speed and the full travel area.',
        focus: 'Save surfacing G-code',
        result: 'You have a separate program to review; saving has not started the machine.',
        visual: 'gcode',
      },
    ],
    tip: 'The generated file expects XY zero at the area’s front-left corner and Z zero on the surface to be faced. Confirm that setup before using the file.',
    keywords: [
      'surfacing',
      'spoilboard',
      'facing',
      'flatten',
      'serpentine',
      'stepover',
      'standalone',
    ],
    related: ['machine-setup', 'tool-library', 'cnc-probe', 'gcode'],
  },
];
