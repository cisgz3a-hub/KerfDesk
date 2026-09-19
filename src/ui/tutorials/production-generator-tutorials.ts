import type { Tutorial } from './tutorial-types';

export const PRODUCTION_GENERATOR_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'box',
    title: 'Generate a finger-jointed box',
    summary:
      'Choose the finished dimensions, inspect how the panels fit, and add them to the canvas.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 4,
    location: 'Tools > Box Generator',
    prerequisites: 'Measured material thickness and an idea of the box dimensions and lid style.',
    visual: 'box',
    steps: [
      {
        title: 'Define the finished size',
        instruction:
          'Enter the measured Material thickness, Width, Depth and Height. Choose Inner (contents) when the space inside matters, or Outer when the finished box must fit a particular space.',
        focus: 'Inner or outer dimensions',
        result:
          'The dimension choice determines which side of the material the entered size describes.',
      },
      {
        title: 'Choose joints and panels',
        instruction:
          'Choose Closed, Open top or Slide lid. Set Finger width, Clearance and any dividers. For a routed box, inspect Corner relief and use the actual Relief tool diameter.',
        focus: 'Style · fingers · clearance',
        result: 'The preview shows the panels, mating fingers and dividers for this construction.',
      },
      {
        title: 'Check both views',
        instruction:
          'Switch between Flat and Assembled. Check the inner and outer size readout, joints and lid. Wait for the preview to reflect the current valid settings before choosing Generate.',
        focus: 'Flat / Assembled',
        result:
          'You inspect both the cut layout and the intended assembly before inserting the panels.',
      },
      {
        title: 'Prepare the generated panels',
        instruction:
          'Generate adds the panels to the canvas. Arrange them on your stock, assign the intended operations and inspect Preview. Test the joint clearance on matching material before committing a full box.',
        focus: 'Generate, arrange, preview',
        result: 'The box becomes editable artwork that uses the normal Frame and Start workflow.',
        visual: 'nest',
      },
    ],
    tip: 'Use Box Fit Test to choose Clearance from an actual joint. Material thickness and joint fit are separate measurements.',
    keywords: ['box', 'finger joints', 'lid', 'dividers', 'panels', 'clearance', 'assembly'],
    related: ['box-fit', 'nest', 'operations', 'dogbone', 'frame-start'],
  },
  {
    id: 'box-fit',
    title: 'Find a box joint fit',
    summary: 'Compare a ladder of finger joints before generating all the panels of a box.',
    category: 'Layout & production',
    machine: 'all',
    minutes: 3,
    location: 'Tools > Box Fit Test',
    prerequisites: 'A sample of the actual sheet material and a suitable cutting operation for it.',
    visual: 'box',
    steps: [
      {
        title: 'Build a clearance ladder',
        instruction:
          'Enter the measured Material thickness and intended Finger width. Set Ladder start, Ladder step and Rungs to compare a useful range of clearances. In CNC mode, check Relief tool diameter.',
        focus: 'Start + step × rung',
        result:
          'Each rung tests a different clearance while keeping the material and finger size consistent.',
      },
      {
        title: 'Generate and inspect the coupons',
        instruction:
          'Choose Generate to add the tab comb and slot strip. Give both pieces the intended cut operation and inspect Preview. For a real test, complete Frame for that exact job, open Start and review it before starting.',
        focus: 'Two mating strips',
        result: 'The two coupon pieces let you compare the resulting physical fit.',
        visual: 'preview',
      },
      {
        title: 'Transfer the winning clearance',
        instruction:
          'After cutting, press matching rungs together and choose the fit you need. Count from the narrow-margin end, starting at rung zero. Enter Ladder start plus rung number times Ladder step as Clearance in Box Generator.',
        focus: 'Use the winning value directly',
        result: 'The full box uses the clearance that matched the test joint.',
      },
    ],
    tip: 'Do not halve or double the winning clearance. The generator already shares it between the tab and its mating notch.',
    keywords: ['box', 'fit', 'coupon', 'clearance', 'ladder', 'finger joint', 'kerf'],
    related: ['box', 'materials', 'cnc-profile', 'frame-start'],
  },
];
