import type { Tutorial } from './tutorial-types';

export const CALIBRATION_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'material-test',
    title: 'Compare laser settings on material',
    summary: 'Generate a labelled engraving grid and turn the best result into a reusable recipe.',
    category: 'Laser',
    machine: 'laser',
    minutes: 4,
    location: 'Tools → Material Test',
    prerequisites:
      'Save the current project first: Generate replaces the canvas with the test grid.',
    visual: 'calibration',
    steps: [
      {
        title: 'Choose what the grid compares',
        instruction:
          'Choose Engrave to fill each cell or Cut to burn its outline, then pick what Rows vary and Columns vary: speed, power, passes or (for Engrave) hatch spacing. Set Rows and Columns and a minimum and maximum for the two settings that vary, and one value for the others. Speed by row and power by column is the default.',
        focus: 'Rows vary × Columns vary',
        result: 'Each cell compares one combination of the two settings.',
      },
      {
        title: 'Size the sample and read the feed disclosure',
        instruction:
          'Set Cell width, Cell height and Gap to fit your test stock. Compare requested and effective feed; the machine profile can cap the requested speed, and the row labels use the effective value.',
        focus: 'Effective speed labels',
        result: 'You know what the labels will mean when examining the physical sample.',
      },
      {
        title: 'Generate and review the test',
        instruction:
          'Choose Generate, inspect Preview and place the grid on the sample. To run it, complete Frame for this exact grid, choose Start to open Job Review, then use Start job after reviewing the job and warnings.',
        focus: 'Generate → Frame → review',
        result: 'The test is prepared as a normal job with labelled engraving swatches.',
        visual: 'frame',
      },
      {
        title: 'Record the useful result',
        instruction:
          'Compare the finished marks and use the row and column labels to identify the chosen settings. Save the material, machine and observed result with the recipe in your material library or project notes.',
        focus: 'Compare, label, save',
        result: 'A future project can start from a result observed on this material.',
        visual: 'library',
      },
    ],
    tip: 'This generator creates filled engraving swatches. A good-looking cell does not establish a through-cut recipe.',
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
    title: 'Compare focus with a Z sweep',
    summary:
      'Generate lines at known relative Z offsets and compare their width on sample material.',
    category: 'Laser',
    machine: 'laser',
    minutes: 4,
    location: 'Tools / Focus Test',
    prerequisites:
      'A controllable Z axis, GRBL-family controller, known starting focus and clearance in both Z directions.',
    visual: 'machine',
    steps: [
      {
        title: 'Set the sweep',
        instruction:
          'Open Focus Test. Enter minimum and maximum Z offsets, samples, spacing, line length, cut settings and Z travel feed. Offsets are relative to starting focus; positive follows the controller axis direction. Confirm physical clearance before machining.',
        focus: 'Relative Z offsets',
        result: 'The dialog lists every represented sample offset.',
      },
      {
        title: 'Generate and inspect',
        instruction:
          'Generate creates named Line operations. Keep Line mode, inspect their order, and open Preview or the G-code Inspector. Each completed sample returns to starting Z with the laser off. Saving and reopening retains the offsets.',
        focus: 'Focus samples',
        result: 'The ordinary document and exact emitted program contain the focus test.',
        visual: 'preview',
      },
      {
        title: 'Frame, review and compare',
        instruction:
          'Complete Frame for the unchanged placement, then Start opens Job Review. Frame checks XY only. After an authorised machine run, compare the narrowest line and set focus using the supported controls. An interrupted test can leave Z at an offset; establish the actual position before another run.',
        focus: 'Frame and Job Review',
        result:
          'Measured material results guide focus; software checks alone do not qualify hardware.',
      },
    ],
    tip: 'This is a relative focus comparison, not autofocus. Machines without powered Z must use the manufacturer manual focus method.',
    keywords: ['focus', 'focus test', 'z axis', 'relative', 'sweep'],
    related: ['jog', 'machine-setup', 'material-test', 'frame-start'],
  },
];
