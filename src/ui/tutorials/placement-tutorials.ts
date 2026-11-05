import type { Tutorial } from './tutorial-types';

export const PLACEMENT_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'camera',
    title: 'Use a camera to place artwork',
    summary:
      'Start a camera, set it up from one photo of an engraved target, and place artwork on the corrected bed image.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 5,
    location: 'Tools → Camera',
    prerequisites:
      'A supported camera in a fixed position and a flat sheet of scrap that covers the bed.',
    visual: 'camera',
    steps: [
      {
        title: 'Start the camera',
        instruction:
          "Open Tools → Camera. Choose Use this camera on the laser's built-in camera, or Start camera for a USB camera. Choose camera… or the gear opens Camera settings for network and phone cameras. They need KerfDesk Desktop; the panel says which cameras this browser can read.",
        focus: 'Preview card → Use this camera / Start camera',
        result: 'A live camera image is available for calibration and placement.',
      },
      {
        title: 'Set up and engrave the target',
        instruction:
          'Choose Set up camera. Confirm the camera, say whether it sits above the bed or on the laser head, and check the picture. Then cover the bed with one flat sheet and enter its thickness; Engrave settings holds power, speed, margin and the camera height for a camera that looks straight down. Engrave target runs a temporary job through the usual Frame and review; Target already engraved reuses one.',
        focus: 'Camera · Mounting · Picture · Sheet thickness',
        result: 'Rings are engraved across the bed at exactly known positions.',
      },
      {
        title: 'Take one photo and check it',
        instruction:
          'Leave the sheet where it is, move the laser head clear of the three solid discs and choose Take photo. The result shows the error of every ring in millimetres over the flattened photo. Save calibration when it is good enough for your work.',
        focus: 'Average and worst error in mm',
        result: 'The camera lens, its position and the bed mapping are saved together.',
      },
      {
        title: 'Refresh before placing artwork',
        instruction:
          'Use Refresh picture (Alt+C) after moving material, or Live; a held picture also refreshes after each job. Set Material height to the top of the material so its edges line up, then place artwork over the image or trace a visible shape. Physically Frame the exact intended job before Start.',
        focus: 'Fresh image · correct surface height',
        result:
          'The overlay helps place artwork, and the physical Frame checks the intended job location.',
        visual: 'frame',
      },
    ],
    tip: 'Moving the camera changes its relationship to the bed. KerfDesk warns when the camera seems to have moved: Fix a small offset… in Camera settings lines a slid picture up with one burned ring, and a bigger move needs a new calibration. A convincing overlay alone does not verify real-world alignment.',
    keywords: ['camera', 'USB', 'RTSP', 'lens', 'calibration', 'target', 'overlay', 'alignment'],
    related: ['trace', 'board', 'print-cut', 'frame-start'],
  },
  {
    id: 'registration',
    pro: 'registration-jig',
    title: 'Engrave a leather keychain using a registration jig',
    summary:
      'Burn an outline on wood, place the leather keychain inside it, then engrave the leather.',
    category: 'Layout & production',
    machine: 'laser',
    minutes: 5,
    location: 'Tools → Registration Jig',
    prerequisites:
      'A measured leather keychain blank, a secured piece of scrap wood, and artwork for the leather.',
    visual: 'jig',
    steps: [
      {
        title: 'Create a rectangle for the keychain’s bounds',
        examplePhase: 0,
        instruction:
          'Registration Jig opens its own editor on Jig layout. For this rounded rectangular leather blank, choose Rectangle and enter its measured overall W and H. Keep one row and one column, then click Apply layout. Drag the outline over the fixed wood if needed, then click Save to canvas. Establish the job’s placement and origin before either run.',
        focus: 'Rectangle = the leather blank’s overall bounds',
        result:
          'The rectangle locates the blank’s outside edges; it does not copy its rounded corners.',
      },
      {
        title: 'Burn the outline onto the wood first',
        examplePhase: 0,
        instruction:
          'Leave the leather keychain off the wood. Choose Outline only, inspect Preview and complete Frame for this exact outline job. Choose Start; in Job Review, check the outline card’s settings and use Edit if this wood needs a lighter mark, then Start job.',
        focus: 'Run 1: burn the outline on empty wood',
        result:
          'The wood now carries a physical outline at the same known coordinates as the canvas rectangle.',
      },
      {
        title: 'Place the real keychain on the burned outline',
        examplePhase: 1,
        instruction:
          'Place the leather blank inside the burned rectangle, lining up its outside edges and intended hole orientation. Keep the wood, canvas outline and work origin fixed. Click Edit jig, import or drop the design (or add text) inside the jig editor, select it, choose Centre artwork in outline, check clearance from the rounded edges and hole, then Save to canvas.',
        focus: 'Place the leather; keep the wood and origin fixed',
        result:
          'Known coordinates locate the artwork on the placed leather. The machine does not detect the keychain.',
      },
      {
        title: 'Burn the artwork onto the keychain',
        examplePhase: 2,
        instruction:
          'Choose Artwork only and inspect Preview with the jig outline excluded. Focus for the leather surface. With the blank in place, complete a new Frame for the exact artwork job, then choose Start. In Job Review, check the artwork’s settings for the leather and use Edit if needed, review the warnings, and Start job.',
        focus: 'Run 2: burn the artwork on the leather',
        result:
          'The artwork is engraved on the leather keychain; the locating outline remains on the wood underneath.',
      },
    ],
    tip: 'For a batch, create a Rows × Columns grid, burn all outlines, place one blank in each, and use Centre + copy artwork to all. Each of the two output jobs needs its own completed Frame.',
    keywords: [
      'registration',
      'jig',
      'fixture',
      'repeat',
      'keychain',
      'leather',
      'wood',
      'place blank',
      'blanks',
      'outline only',
      'artwork only',
    ],
    related: ['board', 'array', 'laser-cut', 'preview', 'frame-start'],
  },
  {
    id: 'board',
    pro: 'place-board',
    title: 'Place artwork on a measured board',
    summary:
      'Capture a rectangular, circular or photo-traced outline board, then place and check the design.',
    category: 'Machine & setup',
    machine: 'all',
    minutes: 4,
    location: 'Tools → Place Board',
    prerequisites:
      'A connected machine with a current position and the actual board secured in place.',
    visual: 'board',
    steps: [
      {
        title: 'Choose the board shape',
        instruction:
          'Choose Rectangle, Circle or Outline. For Outline, open a photo of the board, click its corners and type its size: the board goes on the canvas at once, and two head captures register it to the machine later.',
        focus: 'Rectangle or circle reference',
        result: 'The chosen capture method matches how you can locate the physical board.',
      },
      {
        title: 'Finish measuring the outline',
        instruction:
          'Measure rectangles or circles as prompted. For an outline, jog the head onto points A and B shown on the outline, capture each, then Register board.',
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
    keywords: [
      'board',
      'stock',
      'capture',
      'corners',
      'circle',
      'outline',
      'photo',
      'centre',
      'placement',
      'array',
    ],
    related: ['origin', 'jog', 'array', 'registration', 'frame-start'],
  },
  {
    id: 'rotary',
    title: 'Set up a rotary profile',
    summary: 'Match the profile to a roller or chuck and inspect a test before engraving a wrap.',
    category: 'Machine & setup',
    machine: 'laser',
    minutes: 5,
    location: 'Tools → Rotary Setup',
    prerequisites:
      'A compatible rotary installation and verified setup measurements for the machine.',
    visual: 'rotary',
    steps: [
      {
        title: 'Enable the intended machine profile',
        instruction:
          'Choose Enable rotary for this machine profile, then Roller or Chuck to match the installed device. Enter the measured Object diameter or its Circumference; for a tapered or soft part, use Measure with a strip where the artwork goes.',
        focus: 'Profile · type · diameter',
        result: 'The diameter and circumference stay linked, so either measurement sets both.',
      },
      {
        title: 'Check rotary travel and direction',
        instruction:
          'For a chuck, set Motion per turn from the verified machine setup. For a roller, keep Scale Y from the roller diameter on and enter the driven roller diameter and Motion per turn; turn it off only when the controller’s Y steps/mm already move the part’s surface in millimetres. Inspect Y scale and Machine travel per revolution; use Reverse rotary direction only when needed.',
        focus: 'Scale · travel per revolution',
        result:
          'The conversion between the flat design and rotary movement is explicit in the profile.',
      },
      {
        title: 'Test the rotation',
        instruction:
          'With the controller connected and Idle, mark the part and choose a Test rotation button. The part turns one revolution slowly with the laser off, pauses, then turns back. If it misses, follow the note under the buttons: a chuck or roller turn corrects Motion per turn, and an unscaled roller needs Scale Y from the roller diameter or a controller set to the surface. Changing the object diameter never fixes a roller’s burn size.',
        focus: 'Test rotation',
        result: 'One revolution on the machine matches one revolution of the part.',
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
    tip: 'The rotary setting belongs to the machine profile. The Rotary switch above Frame and Start shows whether it is on; check it when returning to flat work or changing rotary hardware.',
    keywords: [
      'rotary',
      'roller',
      'chuck',
      'diameter',
      'circumference',
      'wrap',
      'rotation',
      'test rotation',
      'roller diameter',
    ],
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
    location: 'Tools → Labs → Print and Cut; Tools → Print and Cut',
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
