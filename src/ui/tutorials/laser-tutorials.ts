import type { Tutorial } from './tutorial-types';

export const LASER_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'laser-cut',
    title: 'Laser outlines and cuts',
    summary: 'Follow a vector outline, choose its cut settings, and see the generated route.',
    category: 'Laser',
    machine: 'laser',
    minutes: 3,
    location: 'Select artwork → operation controls → Process: Line',
    prerequisites: 'Laser mode and a vector shape, such as a rectangle or imported SVG.',
    visual: 'laser-line',
    steps: [
      {
        title: 'Choose the outline',
        instruction:
          'Select the shape and choose Line under Process. A closed rectangle makes a useful first example; an open line traces only its existing path.',
        focus: 'Process: Line',
        result: 'The operation follows the vector edges instead of filling the middle.',
        visual: 'select',
      },
      {
        title: 'Set how the line is processed',
        instruction:
          'Enter Power, Speed and Passes from a material test for your machine. Speed is shown in mm/min. Check which artwork shares the operation before changing it.',
        focus: 'Power · Speed · Passes',
        result:
          'The outline has an explicit processing recipe; Line alone does not decide whether it marks or cuts through.',
      },
      {
        title: 'Inspect the generated route',
        instruction:
          'Open Advanced cut settings for Kerf Offset or Tabs / Bridges when needed. Then open Preview and check the outline, gaps and repeated passes.',
        focus: 'Preview the outline',
        result: 'You can see the planned cut before using the separate Frame and Start workflow.',
        visual: 'preview',
      },
    ],
    tip: 'Visible changes the canvas display. Output decides whether an operation is included in the job.',
    keywords: [
      'line',
      'laser',
      'cut',
      'score',
      'outline',
      'power',
      'speed',
      'passes',
      'kerf',
      'bridges',
    ],
    related: ['operations', 'materials', 'material-test', 'preview', 'frame-start'],
  },
  {
    id: 'laser-fill',
    title: 'Fill a shape with laser engraving',
    summary:
      'Turn a closed outline into an engraved area and understand scan spacing and direction.',
    category: 'Laser',
    machine: 'laser',
    minutes: 3,
    location: 'Select artwork → Process: Fill → Advanced cut settings',
    prerequisites: 'Laser mode and closed vector artwork with the area you want to engrave.',
    visual: 'laser-fill',
    steps: [
      {
        title: 'Choose a filled area',
        instruction:
          'Select a closed shape and set Process to Fill. Use a shape with an inner hole to see how the generated fill treats the opening.',
        focus: 'Process: Fill',
        result: 'The laser route covers the enclosed area while the opening remains clear.',
      },
      {
        title: 'Choose the pattern and spacing',
        instruction:
          'In Advanced cut settings, compare Scanline, Follow Shape and Island Fill under Style. For Scanline, change Scan angle and Line Interval; smaller intervals place rows closer together.',
        focus: 'Style · Scan angle · Line Interval',
        result:
          'The selected style determines whether the operation uses parallel rows, follows the shape, or divides the fill into smaller regions.',
      },
      {
        title: 'Review extra movement and passes',
        instruction:
          'Inspect Overscan, Bidirectional and Cross-Hatch. Cross-Hatch adds another direction. Open Preview to examine fill coverage and travel, then use tested Power and Speed settings.',
        focus: 'Coverage and travel',
        result: 'You can distinguish engraving rows from the extra movement around them.',
        visual: 'preview',
      },
    ],
    tip: 'If alternating rows look doubled on a real test, use the Scan offset calibration lesson. More density cannot correct a timing offset.',
    keywords: [
      'fill',
      'hatch',
      'scanline',
      'island',
      'follow shape',
      'overscan',
      'interval',
      'cross-hatch',
    ],
    related: ['laser-cut', 'interval-test', 'scan-offset', 'preview', 'frame-start'],
  },
  {
    id: 'laser-image',
    title: 'Engrave a photo or bitmap',
    summary: 'Choose how image brightness becomes laser dots and compare the raster result.',
    category: 'Laser',
    machine: 'laser',
    minutes: 4,
    location: 'Select an image → Process: Image → Advanced cut settings',
    prerequisites: 'Laser mode and an imported bitmap at the intended physical size.',
    visual: 'raster',
    steps: [
      {
        title: 'Set the image size first',
        instruction:
          'Import and select a bitmap, check its width and height, and choose Image under Process. Crop or adjust the image in Image Studio before tuning the engraving.',
        focus: 'Image size and Process',
        result: 'The same picture has a defined size on the material.',
        visual: 'image',
      },
      {
        title: 'Choose dots or varying power',
        instruction:
          'Open Advanced cut settings and compare Dither choices. Threshold separates light and dark; dithering uses dot patterns; Grayscale uses a power range and exposes Min Power.',
        focus: 'Dither',
        result:
          'The algorithm determines whether shading becomes dot patterns or varying laser power.',
      },
      {
        title: 'Choose the row density',
        instruction:
          'Set either Line Interval or DPI. They describe the same scan density, so changing one updates the other. Check Negative only when you intend to invert the image brightness.',
        focus: 'Line Interval ↔ DPI',
        result:
          'You can compare wider scan rows with denser rows without changing the physical image size.',
      },
      {
        title: 'Preview, then compare a material test',
        instruction:
          'Inspect the raster preview and use a tested Power and Speed recipe. If a real bidirectional sample has shifted alternate rows, compare one-way scanning and check scan-offset calibration.',
        focus: 'Raster preview',
        result:
          'You have an image recipe to evaluate on your own material; the on-screen picture is not a burn result.',
        visual: 'preview',
      },
    ],
    tip: 'Pass-through skips KerfDesk image processing. Use it only when the source pixels are already prepared for that workflow.',
    keywords: [
      'image',
      'raster',
      'photo',
      'bitmap',
      'dither',
      'grayscale',
      'dpi',
      'negative',
      'pass-through',
    ],
    related: ['image-studio', 'image-adjust', 'interval-test', 'scan-offset', 'frame-start'],
  },
  {
    id: 'materials',
    title: 'Reuse a material recipe',
    summary: 'Apply a saved laser preset to the correct layer and understand linked presets.',
    category: 'Laser',
    machine: 'laser',
    minutes: 3,
    location: 'Material Library panel',
    prerequisites:
      'A laser project with an operation and a material library or a tested recipe to save.',
    visual: 'library',
    steps: [
      {
        title: 'Choose the target and recipe',
        instruction:
          'Open Material Library. Choose the target Layer and then a Preset matching your material and thickness. Read Preset Match to check its machine and calibration context.',
        focus: 'Layer · Preset · Preset Match',
        result:
          'The selected recipe is paired with a specific operation before any settings are applied.',
      },
      {
        title: 'Apply once or keep a link',
        instruction:
          'Choose Apply to layer to copy the recipe, or Link to layer to keep its source reference with a settings snapshot. Inspect the resulting operation values.',
        focus: 'Apply to layer / Link to layer',
        result:
          'The operation receives the chosen recipe, and a linked operation also records where it came from.',
        visual: 'layers',
      },
      {
        title: 'Review updates deliberately',
        instruction:
          'When a linked library recipe changes, read the link status. Use Refresh linked preset when you want that current revision, then preview the operation again.',
        focus: 'Refresh linked preset',
        result: 'The refreshed values are visible in the operation before the next job is framed.',
      },
    ],
    tip: 'Starter libraries provide starting points. Save the settings that worked in your own material test, including the relevant machine and material context.',
    keywords: ['material', 'library', 'recipe', 'preset', 'linked', 'thickness', 'calibration'],
    related: ['material-test', 'laser-cut', 'laser-fill', 'laser-image', 'machine-setup'],
  },
];
