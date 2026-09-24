import type { Tutorial } from './tutorial-types';

export const CNC_DETAIL_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'cnc-relief',
    title: 'Prepare a 3D relief carve',
    summary: 'Map a relief source into physical depth and inspect roughing and finishing choices.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 4,
    location: 'File → Import Height Map, or import an STL → select the relief',
    prerequisites: 'CNC mode, a grayscale height map or STL source, and measured stock.',
    visual: 'relief',
    steps: [
      {
        title: 'Start with a height source',
        instruction:
          'Use Import Height Map for a grayscale PNG whose brightness represents height, or import an STL. Select the relief and read its source information in Relief properties.',
        focus: 'Relief source',
        result:
          'The project contains a relief object with a declared source rather than a laser bitmap.',
      },
      {
        title: 'Map the source into the stock',
        instruction:
          'Open the Artwork tab and set Width and Depth in Relief properties. For a height map, inspect Polarity and the available tone or mask controls. Open View 3D to check which areas rise and which areas are removed.',
        focus: 'Width · Depth · View 3D',
        result: 'The source has physical dimensions and a visible depth range below the stock top.',
      },
      {
        title: 'Choose roughing or finishing',
        instruction:
          'Open the Operation tab and choose Relief roughing or Relief finishing as appropriate. In Tool & material, assign the primary and any Relief finishing bit; review Stepover or Finish scallop where shown.',
        focus: 'Relief operation and Tool & material',
        result: 'The toolpath uses the chosen cutters and the spacing for that stage of the carve.',
      },
      {
        title: 'Inspect the machining plan',
        instruction:
          'Use Preview and G-code inspection to examine the generated passes, travel and depths. Compare them with the stock and workholding, then review the exact job through Frame and Start.',
        focus: 'Generated passes',
        result: 'You have inspected both the relief shape and its planned machining route.',
        visual: 'preview',
      },
    ],
    tip: 'A photograph contains lighting and shadows, not measured height. Use a prepared height map when the grayscale values are meant to describe depth.',
    keywords: [
      'relief',
      '3d',
      'stl',
      'height map',
      'roughing',
      'finishing',
      'scallop',
      'depth',
      'polarity',
    ],
    related: ['import', 'tool-library', 'machine-setup', 'preview', 'gcode'],
  },
  {
    id: 'cnc-tabs',
    title: 'Keep cut-out parts attached with tabs',
    summary: 'Leave small bridges on a profile and move them to useful locations.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 3,
    location: 'A CNC profile operation → Holding tabs → Edit positions',
    prerequisites: 'A CNC profile with one unlocked vector object selected for position editing.',
    visual: 'tabs',
    steps: [
      {
        title: 'Enable holding tabs',
        instruction:
          'Select a profile operation, open Holding tabs and enable Tabs. Think of each tab as a short bridge left near the bottom of the cut to support the part.',
        focus: 'Tabs',
        result: 'The deepest passes will rise over tab regions instead of cutting them fully away.',
      },
      {
        title: 'Set the bridge shape',
        instruction:
          'Set Tab height, Tab width and Tabs per shape. Height is measured up from the cut floor; width is the length along the contour.',
        focus: 'Height · Width · Count',
        result: 'The operation has an explicit bridge height, length and requested count.',
      },
      {
        title: 'Move tabs on the contour',
        instruction:
          'Select one unlocked profile object, choose Edit positions and drag the tab markers along its contour. Use Reset automatic if you want evenly distributed positions again.',
        focus: 'Edit positions',
        result: 'The bridges sit on the parts of the outline you chose.',
      },
      {
        title: 'Check the lowest passes',
        instruction:
          'Open Preview and step through the profile passes. Confirm that the retained bridges support the intended part and that the contour still fits your workholding.',
        focus: 'Preview tab lifts',
        result: 'The tab lifts are visible in the planned depth sequence.',
        visual: 'preview',
      },
    ],
    tip: 'Tab positions belong to the selected profile object. If Edit positions is unavailable, check for multiple selection, a locked object or a different cut type.',
    keywords: [
      'tabs',
      'bridges',
      'holding',
      'cut out',
      'tab height',
      'tab width',
      'edit positions',
    ],
    related: ['cnc-profile', 'select', 'preview', 'frame-start'],
  },
  {
    id: 'tool-library',
    title: 'Choose and assign CNC bits',
    summary: 'Describe the actual cutter and assign the bits used by each operation.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 4,
    location:
      'Artwork / Operations → Settings → Operation → Tool & material; Machine Setup → Bit library',
    prerequisites: 'CNC mode and the specifications of the cutters you intend to use.',
    visual: 'library',
    steps: [
      {
        title: 'Identify the cutter geometry',
        instruction:
          'In Tool & material, use Show picture to recognise the cutter family. Choose the matching bit, or open Add another bit to browse the catalog or add a custom bit with its name, kind, diameter and actual flute count. The same library is available in Machine Setup.',
        focus: 'Bit library',
        result:
          'The picture explains the cutter shape; its actual specifications define the geometry the planner uses.',
      },
      {
        title: 'Complete angled-bit details',
        instruction:
          'For a V-bit or engraving bit, enter the actual tip angle. For an engraving bit with a flat tip, also enter its tip diameter. Check these against the cutter specifications.',
        focus: 'Angle and tip diameter',
        result: 'A pointed cutter and a flat-tip engraving cutter are represented differently.',
        visual: 'vcarve',
      },
      {
        title: 'Assign default and operation bits',
        instruction:
          'In Artwork / Operations → Settings → Operation → Tool & material, choose the Bit and any applicable Floor clearing, Pocket roughing or Relief finishing bit. Use job default bit removes an operation override. Change the job default in Machine Setup.',
        focus: 'Tool & material · Bit',
        result:
          'Each operation has a visible cutter assignment, including any separate clearing stage.',
        visual: 'layers',
      },
      {
        title: 'Save and inspect the plan',
        instruction:
          'Operation choices update immediately and are saved with the project. If editing inside Machine Setup instead, choose Save CNC machine setup to apply its draft. Inspect the operation cutting values and preview any tool changes before running.',
        focus: 'Operation settings and preview',
        result:
          'The job uses the saved bit assignments and shows their effect in the generated route.',
        visual: 'preview',
      },
    ],
    tip: 'Selecting a bit in software does not change the physical cutter. At an actual tool change, match the installed bit and establish its Z zero before continuing.',
    keywords: ['tool', 'bit', 'library', 'diameter', 'flutes', 'angle', 'tool plan', 'tool change'],
    related: ['machine-setup', 'cnc-profile', 'cnc-vcarve', 'cnc-relief', 'cnc-probe'],
  },
];
