import type { Tutorial } from './tutorial-types';

export const CALIBRATION_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'material-test',
    title: 'Compare speed and power on material',
    summary: 'Generate a labelled test grid and turn the best cell into a reusable preset.',
    category: 'Laser',
    machine: 'laser',
    minutes: 4,
    location: 'Tools → Material Test',
    prerequisites:
      'Choose Add to the current design to keep your artwork, or Open as a new project to start from a blank canvas.',
    visual: 'calibration',
    steps: [
      {
        title: 'Choose what the grid compares',
        instruction:
          'Pick the Test mode, then the setting each axis varies (power, speed, interval or passes) with its start, end and count, using a range appropriate to your machine and material. Settings neither axis varies apply to every cell.',
        focus: 'Rows vary × Columns vary',
        result: 'Each cell compares one combination of the two settings.',
      },
      {
        title: 'Size the sample and read the feed disclosure',
        instruction:
          'Set Cell width, Cell height and Gap to fit your test stock, and choose labels and a border. Compare requested and effective feed; the machine profile can cap the requested speed, and the speed labels use the effective value.',
        focus: 'Effective speed labels',
        result: 'You know what the labels will mean when examining the physical sample.',
      },
      {
        title: 'Generate and review the test',
        instruction:
          'Choose Generate, inspect Preview and place the grid on the sample. To burn only an added test, keep it selected and turn on Selected artwork only. Complete Frame for this exact grid, choose Start to open Job Review, then use Start job after reviewing the job and warnings.',
        focus: 'Generate → Frame → review',
        result: 'The test is prepared as a normal job with labelled swatches.',
        visual: 'frame',
      },
      {
        title: 'Turn the best cell into a preset',
        instruction:
          'Select the test and choose Pick the best cell, then click the cell that burned best. Save it as a material preset with its material and thickness, or apply its settings to an operation.',
        focus: 'Pick, save, apply',
        result: 'A future project can start from a result observed on this material.',
        visual: 'library',
      },
    ],
    tip: 'A good-looking engraving cell does not establish a through-cut recipe. Test cuts with Line mode and the passes axis.',
    keywords: ['material test', 'power', 'speed', 'grid', 'swatch', 'engraving', 'recipe'],
    related: ['materials', 'laser-fill', 'interval-test', 'frame-start', 'project-notes'],
  },
  {
    id: 'interval-test',
    title: 'Compare engraving line intervals',
    summary: 'Keep speed and power steady while comparing the distance between engraving rows.',
    category: 'Laser',
    machine: 'laser',
    minutes: 3,
    location: 'Tools → Interval Test',
    prerequisites:
      'Save your current project; Generate replaces the canvas with the interval swatches.',
    visual: 'interval-test',
    steps: [
      {
        title: 'Hold the other settings steady',
        instruction:
          'Set Speed and Power from a suitable material test. Read the effective feed disclosure so you know whether the machine profile limits the requested speed.',
        focus: 'One speed, one power',
        result: 'Differences between swatches can be compared against the changing line interval.',
      },
      {
        title: 'Set the spacing comparison',
        instruction:
          'Choose Steps, Min interval and Max interval, then Swatch size and Gap. A smaller interval puts engraving rows closer together; it also adds more rows to cover the same area.',
        focus: 'Closer rows / wider rows',
        result: 'The generated swatches show a labelled progression of row spacing.',
      },
      {
        title: 'Compare the physical coverage',
        instruction:
          'Generate and inspect Preview. Complete Frame for the exact test, then open Start and review the job before running it. Compare coverage, detail and excess darkening, and record the chosen Line Interval with the recipe.',
        focus: 'Choose from the real sample',
        result: 'The selected spacing is tied to the tested material, speed and power.',
      },
    ],
    tip: 'Denser engraving is not automatically better. Alternating rows that shift sideways need scan-offset investigation, not just a smaller interval.',
    keywords: ['interval', 'density', 'scan rows', 'line spacing', 'engraving', 'swatches'],
    related: ['laser-fill', 'laser-image', 'material-test', 'scan-offset', 'materials'],
  },
  {
    id: 'scan-offset',
    title: 'Measure and verify scan offset',
    summary:
      'Use a baseline coupon, enter measured row offsets, and compare a verification coupon.',
    category: 'Laser',
    machine: 'laser',
    minutes: 5,
    location:
      'Tools → Scan Offset Test; Machine Setup → Essentials → Accessories and calibration → Raster scan-offset calibration',
    prerequisites: 'Save current artwork before generating a coupon; the test replaces the canvas.',
    visual: 'scan-offset',
    steps: [
      {
        title: 'Make an uncorrected baseline',
        instruction:
          'Choose Uncorrected baseline in Scan Offset Test. Set the speed range and coupon dimensions for your test. Generate uncorrected baseline uses zero correction so you can measure the original alternating-row gap.',
        focus: 'Uncorrected baseline',
        result:
          'The coupon separates the measured machine behaviour from any existing correction table.',
      },
      {
        title: 'Measure the signed gap',
        instruction:
          'Run the coupon through Preview, completed Frame and Job Review. Measure the signed gap at each labelled speed. In Raster Diagnostics and assisted conversion, choose the matching input convention and speed unit before entering measurements.',
        focus: 'Speed · signed gap · convention',
        result:
          'Full-gap measurements and LightBurn Line Shift measurements are interpreted differently.',
      },
      {
        title: 'Save the candidate correction',
        instruction:
          'Use Apply measured offsets to put the converted table into the machine setup draft. Save Machine Setup. The table is pending verification; applying measurements alone does not verify the physical result.',
        focus: 'Apply measured offsets → Save',
        result: 'The saved machine profile now contains the candidate table for the next coupon.',
        visual: 'settings',
      },
      {
        title: 'Verify the saved table',
        instruction:
          'Choose Verify saved table and Generate verification coupon. Frame this new exact job and review it before running. Inspect row alignment and placement; only after a successful physical check, use Mark verified in Machine Setup and Save again.',
        focus: 'Verification coupon → Mark verified',
        result: 'The verification status records your physical check of the saved correction.',
      },
    ],
    tip: 'LaserForge full gap moves reverse rows while forward rows stay anchored. Check the measurement sign and absolute placement as well as the apparent gap.',
    keywords: [
      'scan offset',
      'bidirectional',
      'calibration',
      'full gap',
      'LightBurn',
      'line shift',
      'raster',
    ],
    related: ['laser-fill', 'laser-image', 'machine-setup', 'interval-test', 'frame-start'],
  },
  {
    id: 'focus-test',
    title: 'Focus the laser with the available controls',
    summary:
      'Understand why Focus Test is unavailable and use the machine’s supported focus method.',
    category: 'Laser',
    machine: 'laser',
    minutes: 2,
    location:
      'Tools → Focus Test (currently unavailable); machine controls → Focus / Z when supported',
    prerequisites: 'The machine manufacturer’s focusing instructions and any required gauge.',
    visual: 'machine',
    steps: [
      {
        title: 'Recognise the unavailable feature',
        instruction:
          'Focus Test is currently disabled. The app does not provide a hardware-verified automated Z-motion focus-test generator, so this command cannot create or run a focus sweep.',
        focus: 'Focus Test: unavailable',
        result: 'There is no automated test to start from this menu item.',
      },
      {
        title: 'Use the supported focusing method',
        instruction:
          'With the beam off, follow the manufacturer’s procedure and gauge to set the head-to-material distance. Manual-focus machines require hand adjustment. Supported, configured Z axes can expose Focus / Z with Step, Z+ and Z− controls.',
        focus: 'Gauge or supported Focus / Z',
        result: 'The head is focused using the method appropriate to the actual machine.',
      },
      {
        title: 'Check a separate sample job',
        instruction:
          'Use a small, suitable piece of known artwork on sample material to inspect the result. Preview it, complete Frame for that exact job, and open Start for Job Review before running the sample.',
        focus: 'Check the focused result',
        result: 'You can evaluate a real mark without assuming an automated focus sweep exists.',
        visual: 'preview',
      },
    ],
    tip: 'Focus / Z controls perform real motion. Their availability depends on the machine profile’s supported Z axis and confirmed travel.',
    keywords: ['focus', 'focus test', 'unavailable', 'z axis', 'manual focus', 'gauge'],
    related: ['jog', 'machine-setup', 'material-test', 'frame-start'],
  },
];
