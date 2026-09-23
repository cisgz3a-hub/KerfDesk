import type { Tutorial } from './tutorial-types';

export const PRODUCTION_TOOL_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'optimization',
    title: 'Plan the order of laser cuts',
    summary: 'Compare source order with travel planning and inspect how the route changes.',
    category: 'Layout & production',
    machine: 'laser',
    minutes: 3,
    location: 'Tools → Optimization Settings → Cut Planner',
    prerequisites: 'Several laser paths or operations so you can compare their processing order.',
    visual: 'preview',
    steps: [
      {
        title: 'Choose the travel policy',
        instruction:
          'Open Optimization Settings. Under Travel policy, choose Reduce travel to plan a shorter route or Keep source order to retain the existing path sequence within the chosen layer order.',
        focus: 'Reduce travel / Keep source order',
        result: 'The planner follows the selected policy when ordering the laser paths.',
      },
      {
        title: 'Set the priorities you need',
        instruction:
          'Choose Layer priority. With Reduce travel, inspect Inside paths first, Path direction and Planning start. Keep source order disables those extra planning choices while retaining the chosen layer order.',
        focus: 'Layers · inner paths · direction',
        result:
          'The route can prioritise enclosed paths and choose endpoints according to your settings.',
      },
      {
        title: 'Compare the resulting movement',
        instruction:
          'Choose Apply and open Preview. Follow the cut order and travel between shapes, especially inner openings and outer profiles. After changing the plan, complete Frame for the new exact job before opening Start and Job Review.',
        focus: 'Apply → Preview the order',
        result: 'You can assess the planned sequence before sending the job to the machine.',
      },
    ],
    tip: 'Machine Setup also has Planner and time estimate settings for the machine profile. Use measured machine data there; a shorter route does not establish a suitable cutting recipe.',
    keywords: [
      'optimization',
      'cut planner',
      'travel',
      'source order',
      'inside first',
      'direction',
      'ETA',
    ],
    related: ['operations', 'laser-cut', 'preview', 'machine-setup', 'frame-start'],
  },
  {
    id: 'labs',
    title: 'Understand optional Labs features',
    summary: 'Find the optional controls and learn which machine capabilities each one expects.',
    category: 'Machine & setup',
    machine: 'laser',
    minutes: 2,
    location: 'Tools → Labs',
    prerequisites:
      'Laser mode; read the intended machine and feature requirements before enabling a control.',
    visual: 'settings',
    steps: [
      {
        title: 'Choose a feature deliberately',
        instruction:
          'Read the descriptions for Low-power Fire control, Print and Cut, and Camera alignment v2. These optional features are off by default and expose different machine workflows.',
        focus: 'Three optional features',
        result: 'You can identify the feature that serves your current task.',
      },
      {
        title: 'Check the matching machine setup',
        instruction:
          'Low-power Fire needs an approved diode profile. Print and Cut uses a homed absolute-position profile. Camera alignment v2 enables the camera alignment workflow. Turning on a preference does not supply missing hardware or prove its calibration.',
        focus: 'Feature + supported setup',
        result: 'The preference and the actual machine configuration remain separate choices.',
      },
      {
        title: 'Open the relevant tool',
        instruction:
          'Toggle the desired feature and choose Done. Open its corresponding tool and read the availability information there. Return to Labs to turn a feature off, or use Reset all to restore the default feature preferences.',
        focus: 'Toggle → Done → tool',
        result: 'The optional interface follows your saved local preference.',
      },
    ],
    tip: 'Labs preferences do not change the ordinary run sequence: complete Frame for the exact job, then use Start to open Job Review.',
    keywords: ['labs', 'experimental', 'optional', 'fire', 'print and cut', 'camera alignment'],
    related: ['machine-setup', 'print-cut', 'camera', 'frame-start'],
  },
  {
    id: 'offset',
    title: 'Create an inward or outward offset',
    summary: 'Make a separate outline at a chosen distance from selected closed vectors.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 2,
    location: 'Artwork / Operations → Settings → Artwork → Offset outlines',
    prerequisites: 'One or more unlocked, closed vector shapes selected in the main workspace.',
    visual: 'offset',
    steps: [
      {
        title: 'Select a closed outline',
        instruction:
          'Select the vector shape in the main workspace and open the Artwork tab in Settings. Offset outlines appears for eligible closed vector selections; images, locked objects and open paths are not the same input.',
        focus: 'Selected closed vector',
        result: 'The selected boundary is the reference from which the offset is measured.',
        visual: 'select',
      },
      {
        title: 'Choose the distance and direction',
        instruction:
          'Enter a positive Distance in millimetres. Choose Outward copy to expand the boundary or Inward copy to shrink it. Inspect narrow sections where an inward offset can remove the available space.',
        focus: 'Distance · Outward copy / Inward copy',
        result:
          'A new offset object is created and selected while the original remains on the canvas.',
      },
      {
        title: 'Choose which outlines should run',
        instruction:
          'Compare the original and the offset at close zoom. Check their operations and Output settings before Preview so the job contains the intended outlines. Use Undo if the result is not useful.',
        focus: 'Original + new outline',
        result: 'You retain control of whether the source, the offset or both are processed.',
      },
    ],
    tip: 'If an inward offset produces no usable shape, inspect the narrowest features and try a smaller distance. This tool creates geometry; it is separate from an operation’s kerf compensation.',
    keywords: ['offset', 'inward', 'outward', 'outline', 'contour', 'border', 'inset'],
    related: ['select', 'nodes', 'operations', 'laser-cut', 'cnc-profile'],
  },
  {
    id: 'dogbone',
    title: 'Relieve inside corners with dogbones',
    summary: 'Add corner overcuts so a square mating part can fit a routed opening.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 2,
    location: 'Artwork / Operations → Settings → Artwork → Corner relief · dogbones',
    prerequisites: 'CNC mode, an unlocked closed vector and the diameter of the intended cutter.',
    visual: 'dogbone',
    steps: [
      {
        title: 'Find a corner that needs clearance',
        instruction:
          'Select a closed pocket or slot outline. A round cutter leaves rounded inside corners; a square insert may need extra space beyond those corners to seat fully.',
        focus: 'Rounded inside corner',
        result:
          'You can identify where the mating part would otherwise touch the remaining material.',
      },
      {
        title: 'Use the actual cutter diameter',
        instruction:
          'In the Artwork tab, find Corner relief · dogbones. Check Bit diameter against the cutter you intend to use, then choose Relieve corners. The tool adds relief at qualifying sharp internal corners of the selected outline.',
        focus: 'Bit diameter → Relieve corners',
        result: 'The selected geometry changes in place to include corner overcuts.',
      },
      {
        title: 'Inspect the relieved outline',
        instruction:
          'Zoom in to inspect the overcuts and open Preview with the intended CNC operation. Test the fit on suitable sample material before making the final part. Undo restores the previous outline if the relief is unwanted.',
        focus: 'Inspect each overcut',
        result:
          'The modified outline provides space for the mating corners where relief was added.',
      },
    ],
    tip: 'A shape with no qualifying sharp internal corners may remain unchanged. Dogbones modify the design geometry and can be visible in the finished part.',
    keywords: ['dogbone', 'corner relief', 'inside corner', 'cutter diameter', 'joinery', 'fit'],
    related: ['cnc-pocket', 'cnc-inlay', 'box-fit', 'offset', 'preview'],
  },
  {
    id: 'cnc-tiling',
    title: 'Export a CNC job as indexed tiles',
    summary:
      'Split output into tile files and understand the separate stock-indexing work between them.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 4,
    location: 'CNC Machine Setup → Tiling; File → Save G-code',
    prerequisites:
      'A CNC project and a physical plan for holding, indexing and referencing the stock.',
    visual: 'cnc-tiling',
    steps: [
      {
        title: 'Define the area of each tile',
        examplePhase: 0,
        instruction:
          'In Tiling, enable Split this job into indexed tiles on export. Set Tile width and Tile height for the usable area in your setup, then choose the requested Overlap.',
        focus: 'Tile size + overlap',
        result: 'The export plan divides the job into overlapping rectangular regions.',
      },
      {
        title: 'Read the effective indexing plan',
        examplePhase: 1,
        instruction:
          'Check the effective overlap and tile step readout instead of relying only on the requested value. If needed, enable Drill registration holes in overlap strips and Configure registration with the actual cutter and intended hole settings.',
        focus: 'Effective overlap · tile step',
        result:
          'You can compare the planned spacing and optional registration holes with the physical fixture.',
      },
      {
        title: 'Save the setup and export the files',
        examplePhase: 2,
        instruction:
          'Save CNC machine setup, then use File → Save G-code. The export produces separate files identified by tile row and column; keep those names and the corresponding stock positions together.',
        focus: 'Save setup → indexed files',
        result:
          'Each file contains the output for its own tile rather than one continuous machine run.',
      },
      {
        title: 'Inspect each tile before machining',
        examplePhase: 2,
        instruction:
          'Open each exported file in the G-code inspector and check its extents and operations. Plan how to reposition the stock and establish the correct XY reference for each tile in your machining workflow.',
        focus: 'Inspect file · index stock · reference',
        result: 'The file sequence is paired with an explicit physical setup for every tile.',
      },
    ],
    tip: 'Tiling exports separate programs. It does not move the stock automatically or establish a cutting order across separate files.',
    keywords: [
      'tiling',
      'tile',
      'indexing',
      'overlap',
      'registration holes',
      'large stock',
      'CNC export',
    ],
    related: ['machine-setup', 'gcode', 'cnc-drill', 'origin', 'preview'],
  },
];
