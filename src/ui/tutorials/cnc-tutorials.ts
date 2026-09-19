import type { Tutorial } from './tutorial-types';

export const CNC_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'cnc-profile',
    title: 'Cut around a shape with a router',
    summary: 'Understand outside, inside and on-path profiles, then review the cutter route.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 3,
    location: 'Select vector artwork > Cut type',
    prerequisites: 'CNC mode, vector artwork, and the intended stock and bit in Startup Setup.',
    visual: 'profile',
    steps: [
      {
        title: 'Choose which side to keep',
        instruction:
          'Select a closed shape. Choose Outside path to keep the shape as a part, or Inside path to machine an opening. On path centres the cutter on the drawn line.',
        focus: 'Outside · Inside · On path',
        result: 'The cutter centre moves to the selected side of the source outline.',
      },
      {
        title: 'Set the depth in passes',
        instruction:
          'Enter Cut depth and Depth per pass. Set to stock thickness copies the measured stock value; any extra depth remains your separate setup decision. Check Feed, Plunge and Artwork spindle speed.',
        focus: 'Cut depth · Depth per pass',
        result: 'The same contour can be cut in several depth passes.',
      },
      {
        title: 'Inspect the part and its support',
        instruction:
          'For a cut-out part, configure Tabs if needed. Open Preview and inspect the side of the line, pass depths and any Profile leads before moving to Frame and Start.',
        focus: 'Preview cutter clearance',
        result: 'The preview distinguishes the original shape from the offset tool route.',
        visual: 'preview',
      },
    ],
    tip: 'The selected bit diameter affects the offset. Correct the bit in Startup Setup before compensating by resizing the artwork.',
    keywords: ['cnc', 'profile', 'outside', 'inside', 'on path', 'contour', 'depth', 'leads'],
    related: ['tool-library', 'cnc-tabs', 'preview', 'cnc-probe', 'frame-start'],
  },
  {
    id: 'cnc-pocket',
    title: 'Clear a recessed pocket',
    summary: 'Remove the area inside a closed boundary and compare clearing patterns.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 3,
    location: 'Select closed artwork > Cut type: Pocket (clear inside)',
    prerequisites: 'CNC mode, a closed boundary, and a cutter and stock defined in Startup Setup.',
    visual: 'pocket',
    steps: [
      {
        title: 'Identify the area to clear',
        instruction:
          'Select a closed shape and choose Pocket (clear inside). A rectangle with a smaller enclosed shape helps you see the pocket boundary and retained island.',
        focus: 'Pocket (clear inside)',
        result: 'The planned route clears the interior instead of making only an outline cut.',
      },
      {
        title: 'Choose depth and fill method',
        instruction:
          'Set Cut depth and Depth per pass. Under Advanced, compare Offset rings, Raster sweeps and Adaptive clearing in Fill method. Use the controls shown for the selected method.',
        focus: 'Fill method',
        result: 'The clearing route changes while the intended pocket boundary remains the same.',
      },
      {
        title: 'Review spacing and remaining detail',
        instruction:
          'For rings or raster, review Stepover as a percentage of the bit diameter. Open Preview to check islands, corners, entry and the finishing wall pass. Set cutting values for the actual bit and material.',
        focus: 'Stepover and pocket preview',
        result: 'You can see where the chosen cutter fits and how successive paths clear the area.',
        visual: 'preview',
      },
    ],
    tip: 'Pocket roughing can use a separate bit assigned in Startup Setup > Tool Plan. Inspect the resulting tool changes before running.',
    keywords: [
      'pocket',
      'clear',
      'island',
      'stepover',
      'offset rings',
      'raster',
      'adaptive',
      'roughing',
    ],
    related: ['cnc-profile', 'tool-library', 'cnc-inlay', 'preview', 'frame-start'],
  },
  {
    id: 'cnc-engrave',
    title: 'Engrave along a vector line',
    summary:
      'Trace a centreline at a chosen depth, including open paths and single-line lettering.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 3,
    location: 'Select vector artwork > Cut type: Engrave (trace path)',
    prerequisites: 'CNC mode and a line or vector design with the intended engraving bit assigned.',
    visual: 'engrave',
    steps: [
      {
        title: 'Select the path to trace',
        instruction:
          'Select an open polyline or suitable single-line text, then choose Engrave (trace path). Zoom in to identify whether the artwork contains one centreline or a pair of outline edges.',
        focus: 'Engrave (trace path)',
        result: 'The cutter follows each source path rather than clearing its enclosed area.',
      },
      {
        title: 'Match the bit and depth',
        instruction:
          'Check the assigned bit in the Startup Setup references. Enter Cut depth, Depth per pass, Feed, Plunge and Artwork spindle speed for your setup.',
        focus: 'Bit and Cut depth',
        result: 'The groove depth and cutter shape together determine the resulting mark.',
      },
      {
        title: 'Check every traced stroke',
        instruction:
          'Open Preview and follow the engraving route. If lettering is being outlined twice when you wanted one stroke, change the artwork or font rather than the depth setting.',
        focus: 'Preview individual strokes',
        result: 'You can distinguish centreline engraving from outlined text before machining.',
        visual: 'preview',
      },
    ],
    tip: 'For filled lettering whose depth varies with stroke width, see V-carve. Engrave follows the paths you supply.',
    keywords: [
      'engrave',
      'trace path',
      'centreline',
      'centerline',
      'open path',
      'single line',
      'groove',
    ],
    related: ['polyline', 'text', 'tool-library', 'cnc-vcarve', 'frame-start'],
  },
  {
    id: 'cnc-vcarve',
    title: 'Carve lettering with a V-bit',
    summary:
      'See how stroke width and bit angle create changing depth, with optional flat-floor clearing.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 4,
    location: 'Select closed artwork > Cut type: V-carve (angled bit)',
    prerequisites: 'CNC mode, closed lettering or artwork, and a correctly described angled bit.',
    visual: 'vcarve',
    steps: [
      {
        title: 'Choose the real angled cutter',
        instruction:
          'In Startup Setup, select the intended bit and verify its diameter, angle and any tip diameter. Select the artwork and choose V-carve (angled bit).',
        focus: 'Bit geometry',
        result: 'The planned depth reflects the selected cutter geometry.',
      },
      {
        title: 'Compare flowing and limited depth',
        instruction:
          'Leave Flat depth off for depth that follows the artwork width and bit angle. Turn it on only when you want a maximum Floor depth and a flat core in wider areas.',
        focus: 'Flat depth · Floor depth',
        result:
          'The example shows narrow strokes cut shallowly and wider strokes requiring deeper or cleared areas.',
      },
      {
        title: 'Plan any separate clearing bit',
        instruction:
          'For flat-floor work, use Startup Setup > Tool Plan > V-carve floor clearing when you want another bit to clear the core. Review its operation values and any tool changes.',
        focus: 'V-carve floor clearing',
        result: 'The clearing work and angled finishing work have explicit cutter assignments.',
        visual: 'layers',
      },
      {
        title: 'Inspect depth and fine details',
        instruction:
          'Open Preview and the 3D inspection tools. Examine narrow strokes, wide regions and the planned depths against your stock. Read the V-carve findings in Job Review after Frame.',
        focus: 'Depth and detail preview',
        result:
          'You can assess the generated path without treating the preview as a finished material sample.',
        visual: 'preview',
      },
    ],
    tip: 'Detail changes V-carve sampling. It does not replace the actual bit angle, stock measurement or an appropriate material test.',
    keywords: [
      'v-carve',
      'vcarve',
      'v-bit',
      'angle',
      'lettering',
      'flat depth',
      'floor',
      'clearing',
    ],
    related: ['tool-library', 'text', 'cnc-engrave', 'cnc-inlay', 'preview'],
  },
  {
    id: 'cnc-drill',
    title: 'Drill at shape centres',
    summary: 'Use closed shapes to locate holes and understand the repeated peck cycle.',
    category: 'CNC',
    machine: 'cnc',
    minutes: 3,
    location: 'Select closed shapes > Cut type: Drill (peck at centers)',
    prerequisites:
      'CNC mode, closed shapes at the intended hole locations, and a suitable cutter setup.',
    visual: 'drill',
    steps: [
      {
        title: 'Place the hole markers',
        instruction:
          'Draw or import a closed shape at each hole location. Choose Drill (peck at centers). Each shape contributes one hole at the centre of its bounding box.',
        focus: 'One shape → one centre',
        result:
          'The example shows drilling positions at the markers, not a cut around their outlines.',
      },
      {
        title: 'Set the peck depth',
        instruction:
          'Set Cut depth for the total depth and Depth per pass for each peck. Check Plunge and the assigned cutter against the material and drilling method.',
        focus: 'Cut depth · Depth per pass · Plunge',
        result:
          'The cycle advances in depth steps and returns towards the stock top between pecks.',
      },
      {
        title: 'Inspect centres and depth',
        instruction:
          'Open Preview to check the number of holes, their positions and repeated depth passes. Correct a misplaced marker on the canvas before framing the job.',
        focus: 'Preview hole locations',
        result: 'Every planned hole corresponds to the intended closed-shape centre.',
        visual: 'preview',
      },
    ],
    tip: 'A larger drawn circle does not make a larger drilled hole. For an opening larger than the cutter, use an appropriate pocket or inside profile.',
    keywords: ['drill', 'holes', 'peck', 'centres', 'centers', 'plunge', 'depth per pass'],
    related: ['ellipse', 'array', 'cnc-pocket', 'cnc-profile', 'frame-start'],
  },
];
