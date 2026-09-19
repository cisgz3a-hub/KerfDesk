import type { Tutorial } from './tutorial-types';

export const PLACEMENT_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'camera',
    title: 'Use a camera to place artwork',
    summary: 'Connect a camera, calibrate its view and use an updated bed image for placement.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 5,
    location: 'Tools > Camera',
    prerequisites: 'A supported camera, a calibration board and a stable camera mounting position.',
    visual: 'camera',
    steps: [
      {
        title: 'Choose a camera source',
        instruction:
          'Select a USB camera and choose Start, or select a detected machine camera where available. Network camera sources require the desktop app or local bridge; check the source notice in the panel.',
        focus: 'Source → Start',
        result: 'A live camera image is available for calibration and placement.',
      },
      {
        title: 'Calibrate the lens',
        instruction:
          'Open Calibrate lens. Enter the checkerboard’s inner-corner counts and measured square size. Use a flat board in several positions and angles, then solve, review and save the calibration.',
        focus: 'Inner corners, not squares',
        result: 'Lens calibration describes how the camera distorts the image.',
      },
      {
        title: 'Align the view to the bed',
        instruction:
          'Align to bed is available with Camera alignment v2 enabled in Labs. Follow its marker workflow and enter the Marker surface height. Keep the marker sheet fixed during detection; Burn markers is a real machine job, while Markers already burned reuses a target.',
        focus: 'Lens calibration + bed alignment',
        result: 'Detected bed markers relate the camera view to the machine workspace.',
      },
      {
        title: 'Refresh before placing artwork',
        instruction:
          'Use Update still after moving material, or Live for a supported USB source. Check Material surface height where available, then place artwork over the image or trace a visible shape. Physically Frame the exact intended job before Start.',
        focus: 'Fresh image · correct surface height',
        result:
          'The overlay helps place artwork, and the physical Frame checks the intended job location.',
        visual: 'frame',
      },
    ],
    tip: 'Moving the camera changes its relationship to the bed. A convincing overlay alone does not verify real-world alignment.',
    keywords: ['camera', 'USB', 'RTSP', 'lens', 'checkerboard', 'markers', 'overlay', 'alignment'],
    related: ['labs', 'trace', 'board', 'print-cut', 'frame-start'],
  },
  {
    id: 'registration',
    title: 'Position repeat jobs with a registration jig',
    summary: 'Make an outline on a fixture, fit the artwork, then run the separate artwork job.',
    category: 'Layout & production',
    machine: 'laser',
    minutes: 5,
    location: 'Tools > Registration Jig',
    prerequisites: 'Measured blanks and suitable fixture material for the outline run.',
    visual: 'jig',
    steps: [
      {
        title: 'Create outlines that match the blanks',
        instruction:
          'Choose Rectangle or Circle and enter the blank dimensions. Set Rows, Columns and spacing if you need multiple positions, then create the jig set.',
        focus: 'Blank shape and grid',
        result: 'The canvas shows the fixture outlines that will locate the physical pieces.',
      },
      {
        title: 'Run the outline job first',
        instruction:
          'Choose Outline only and inspect Jig outline laser settings. Check the next-run message and Preview. Complete Frame for this exact outline job, then choose Start to open Job Review and Start job to produce the fixture marks.',
        focus: 'Outline only → Frame → review',
        result: 'The first run marks the blank positions using the outline operation.',
        visual: 'frame',
      },
      {
        title: 'Fit artwork to the marked positions',
        instruction:
          'Place the blanks on the fixture marks. Select the design and use Auto-fit artwork in outline, or Auto-fit + copy artwork to all for a grid. Inspect its size and position in each outline.',
        focus: 'Auto-fit and copy',
        result:
          'The artwork is arranged inside the jig positions without changing the physical fixture.',
      },
      {
        title: 'Frame and review the artwork run',
        instruction:
          'Switch to Artwork only and confirm the next-run message. Complete a new Frame for this exact artwork job. Start then opens Job Review; inspect the job and warnings before choosing Start job.',
        focus: 'Artwork only → new Frame → review',
        result: 'The second run processes the artwork instead of repeating the jig outline.',
        visual: 'frame',
      },
    ],
    tip: 'Outline only and Artwork only produce different jobs. A Frame completed for the outline does not cover the later artwork run.',
    keywords: [
      'registration',
      'jig',
      'fixture',
      'repeat',
      'blanks',
      'outline only',
      'artwork only',
    ],
    related: ['board', 'array', 'laser-cut', 'preview', 'frame-start'],
  },
  {
    id: 'board',
    title: 'Place artwork on a measured board',
    summary:
      'Capture a rectangular or circular board, place the design and physically check the outline.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 4,
    location: 'Tools > Place Board',
    prerequisites:
      'A connected machine with a current position and the actual board secured in place.',
    visual: 'board',
    steps: [
      {
        title: 'Choose the board shape',
        instruction:
          'Choose Rectangle or Circle. For a rectangle, jog to and capture the bottom-left corner first; this establishes its work origin. For a circle, choose Find center from rim or Center already marked.',
        focus: 'Rectangle or circle reference',
        result: 'The chosen capture method matches how you can locate the physical board.',
      },
      {
        title: 'Finish measuring the outline',
        instruction:
          'For a rectangle, capture the other three corners in any order or enter Width and Height after the first corner. A circle can use four well-spaced rim points, or a captured centre with an edge point or measured diameter.',
        focus: 'Measured points or known dimensions',
        result:
          'Create the board outline to obtain a locked placement reference excluded from the burn.',
      },
      {
        title: 'Place or repeat the design',
        instruction:
          'Select the artwork and choose a placement anchor. Use Fit to board for one design, or Array on board with a row-and-column count or Fit as many as fit and the desired spacing.',
        focus: 'Anchor · Fit · Array',
        result: 'The design is positioned relative to the captured outline.',
        visual: 'array',
      },
      {
        title: 'Check the captured board physically',
        instruction:
          'Use Physically check board to move the head with the beam off to reference points. Confirm a correct point or adjust it and use the current head position to update the board. Then Preview and Frame the exact intended job before Start.',
        focus: 'Check board → Frame job',
        result:
          'Board measurements and the intended job placement receive separate physical checks.',
        visual: 'frame',
      },
    ],
    tip: 'Board checks and capture controls can move the real head or change its coordinate reference. If the reference becomes stale, capture the board again.',
    keywords: ['board', 'stock', 'capture', 'corners', 'circle', 'centre', 'placement', 'array'],
    related: ['origin', 'jog', 'array', 'registration', 'frame-start'],
  },
  {
    id: 'rotary',
    title: 'Set up a rotary profile',
    summary: 'Match the profile to a roller or chuck and inspect a test before engraving a wrap.',
    category: 'Machine & setup',
    machine: 'laser',
    minutes: 4,
    location: 'Tools > Rotary Setup',
    prerequisites:
      'A compatible rotary installation and verified setup measurements for the machine.',
    visual: 'rotary',
    steps: [
      {
        title: 'Enable the intended machine profile',
        instruction:
          'Choose Enable rotary for this machine profile, then Roller or Chuck to match the installed device. Enter the measured Object diameter for the workpiece.',
        focus: 'Profile · type · diameter',
        result: 'The setup shows the surface circumference associated with that diameter.',
      },
      {
        title: 'Check rotary travel and direction',
        instruction:
          'For a chuck, set Motion per turn from the verified machine setup. Inspect Machine travel per revolution and use Reverse rotary direction only when needed for the installed orientation.',
        focus: 'Travel per revolution',
        result:
          'The conversion between the flat design and rotary movement is explicit in the profile.',
      },
      {
        title: 'Prepare a separate test project',
        instruction:
          'Apply saves the profile settings. Save current artwork before using Generate test pattern, because the generated pattern replaces the scene. Inspect the pattern and its operation settings in Preview.',
        focus: 'Save artwork → test pattern',
        result: 'You have a separate sample for checking the wrap size and orientation.',
        visual: 'preview',
      },
      {
        title: 'Verify the physical wrap',
        instruction:
          'Complete Frame for the exact rotary test with the workpiece installed. Choose Start for Job Review and review the warnings before starting the test. Compare the physical wrap size and direction before preparing production artwork.',
        focus: 'Frame, review, compare',
        result: 'A real sample can confirm the chosen profile measurements for this setup.',
      },
    ],
    tip: 'The rotary setting belongs to the machine profile. Check it again when returning to flat work or changing rotary hardware.',
    keywords: ['rotary', 'roller', 'chuck', 'diameter', 'circumference', 'wrap', 'rotation'],
    related: ['machine-setup', 'origin', 'preview', 'frame-start'],
  },
  {
    id: 'print-cut',
    title: 'Register a cut to printed artwork',
    summary:
      'Match two design targets to two physical points on a print before reviewing the output.',
    category: 'Layout & production',
    machine: 'laser',
    minutes: 4,
    location: 'Tools > Labs > Print and Cut; Tools > Print and Cut',
    prerequisites:
      'Print and Cut enabled in Labs, a homing-enabled absolute-position profile and two printed reference points.',
    visual: 'print-cut',
    steps: [
      {
        title: 'Prepare two matching reference points',
        instruction:
          'Choose two distinct, well-separated targets whose design coordinates you know and whose positions you can identify on the print. Enable Print and Cut in Labs and open its dialog with the supported machine profile.',
        focus: 'Design targets ↔ printed targets',
        result: 'Each target has a known design position and a corresponding physical location.',
      },
      {
        title: 'Capture the first target',
        instruction:
          'Enter Target 1 Design X and Design Y. With the machine connected and idle, position the head at the matching printed point and choose Capture head for Target 1.',
        focus: 'Target 1: design + head position',
        result: 'The first design target is paired with a current machine position.',
      },
      {
        title: 'Capture the second target and apply',
        instruction:
          'Enter the second target’s Design X and Design Y, position the head at that printed point, and choose its Capture head. Check both pairs and choose Apply registration.',
        focus: 'Target 2 → Apply registration',
        result: 'The two correspondences define the output registration for the print.',
      },
      {
        title: 'Inspect the registered job',
        instruction:
          'Inspect Preview and complete Frame for the exact registered job with the print in place. Start opens Job Review; examine the job and warnings before choosing Start job. Use Disable when the registration is no longer wanted.',
        focus: 'Registered output → Frame → review',
        result: 'The printed placement is checked before the separate start action.',
        visual: 'frame',
      },
    ],
    tip: 'Moving the print or losing the machine coordinate reference requires fresh captures. Saved design targets alone do not establish current physical positions.',
    keywords: ['print and cut', 'registration', 'targets', 'capture', 'alignment', 'printed'],
    related: ['labs', 'camera', 'origin', 'preview', 'frame-start'],
  },
];
