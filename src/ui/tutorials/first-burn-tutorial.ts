// "Burn your first coaster": the lesson that takes a beginner from a design to
// a finished burn, modelled on LightBurn's First Project page (UX audit
// U8-P3-1; maintainer rule "research what LightBurn does and copy"). LightBurn
// orders it safety, design, settings, preview with engraving before cutting,
// focus, Start From and job origin, Frame, Start; so does this, in KerfDesk's
// names. It carries the guidance the first burn lacked: safety, focus, starter
// values and cut last.

import type { Tutorial } from './tutorial-types';

export const FIRST_BURN_TUTORIAL: Tutorial = {
  id: 'first-burn',
  title: 'Burn your first coaster',
  summary:
    'Take a coaster design all the way to a finished burn: safety, settings, cut last, focus, origin, Frame and Start.',
  category: 'Getting started',
  machine: 'laser',
  minutes: 10,
  location: 'Artwork panel, then Machine controls',
  prerequisites:
    'A laser set up in Machine Setup and connected, a coaster blank such as 3 mm plywood, and a scrap piece for a test.',
  visual: 'frame',
  steps: [
    {
      title: 'Before you start',
      instruction:
        "Wear safety glasses made for your laser's wavelength. Put something non-flammable under the material, keep a fire extinguisher near, and never leave the laser while it runs.",
      focus: 'Glasses · fire safety · stay with it',
      result: 'You are ready to stop the job yourself if anything goes wrong.',
      visual: 'machine',
    },
    {
      title: 'Draw the coaster',
      instruction:
        'Draw the outline with Draw ellipse, holding Shift for a circle, and set its W and H to 90 mm. Click Text and type a name inside it, then select both and use Arrange → Align to centre them.',
      focus: 'Draw ellipse · Text · Arrange → Align',
      result: 'The coaster outline and its lettering sit together on the canvas.',
      visual: 'text',
    },
    {
      title: 'Engrave the text, cut the circle last',
      instruction:
        'Give the text a Fill operation and the circle a Line operation. Open the operation list tools (•••) and choose Sort cuts last, so the lettering burns before the outline frees the coaster.',
      focus: 'Fill · Line · Sort cuts last',
      result: 'Preview runs the engraving first and the cut last.',
      visual: 'layers',
    },
    {
      title: 'Choose power and speed',
      instruction:
        "Start from your laser's manual or the material's maker. If you have neither, run Tools → Material Test on scrap first: Engrave for the lettering, Cut for the outline.",
      focus: 'Power · Speed · Material Test',
      result: 'Each operation has settings you have checked on this material.',
      visual: 'calibration',
    },
    {
      title: 'Focus on the material',
      instruction:
        'Place the blank on the bed. Set the head height with the focus gauge or spacer that came with your laser, resting on top of the material.',
      focus: 'Focus gauge or spacer',
      result: 'The beam is sharp at the material surface.',
      visual: 'machine',
    },
    {
      title: 'Put the job where the coaster is',
      instruction:
        "Jog the head to the coaster's front-left corner, press Set origin here, and choose User Origin under Start from.",
      focus: 'Jog · Set origin here · Start from',
      result: 'The job will start from the corner you chose.',
      visual: 'origin',
    },
    {
      title: 'Frame it',
      instruction:
        'Press Frame job and watch the head trace the outline, beam off. If the box is not on your material, move the origin and Frame again.',
      focus: 'Frame job',
      result: 'You have seen where the job will burn.',
      visual: 'frame',
    },
    {
      title: 'Start and stay with it',
      instruction:
        'Press Start, read Job Review and its warnings, then press Start job. Stay with the laser until it finishes, and press ABORT JOB if anything looks wrong.',
      focus: 'Start · Job Review · Start job',
      result: 'Your first coaster is burned and cut out.',
      visual: 'preview',
    },
  ],
  tip: 'Only the laser maker knows safe settings for your machine; a material test on scrap is the next best start. Wait for the cut piece to cool before lifting it out.',
  keywords: [
    'first burn',
    'beginner',
    'coaster',
    'safety',
    'glasses',
    'focus',
    'cut last',
    'engrave first',
    'origin',
    'frame',
    'start',
  ],
  related: ['first-project', 'material-test', 'origin', 'frame-start'],
};
