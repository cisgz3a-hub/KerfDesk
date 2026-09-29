// Copy for the safety page. Every line traces to docs/safety.md, public/eula.txt,
// SECURITY.md, README.md (status table, proven invariants), WORKFLOW.md (Frame,
// Job Review, Abort, laser-mode flows) or the cited source: Frame traces the
// job's bounding rectangle (src/core/controllers/grbl/frame-lines.ts), the CNC
// setup confirmation lives in src/ui/state/cnc-setup-attestation.ts, and the
// "Used on a real machine" row follows ADR-322 (informal use, not verification).
// GRBL setting numbers are written in words: the no-price test rejects "$" + digit.

// Numbered checklist for "Before every job".
export const BEFORE_EVERY_JOB = [
  {
    title: 'Check the output',
    body: 'Use Preview, the simulation or an air run with the tool clear of the material. Generated G-code can be wrong and still run. For an independent check, save the G-code and open it in a separate viewer.',
  },
  {
    title: 'Frame it on the material',
    body: 'With the laser or spindle off, Frame moves the head around the rectangle your job will cover, over your stock. Watch where it goes. On a router, set Z zero on the stock top first; Frame lifts the bit to a safe height before it moves.',
  },
  {
    title: 'Secure the work',
    body: 'Clamp router stock firmly. A part that comes loose can break the bit and be thrown. Keep clamps and screws out of the cutter’s path, and remove wrenches, probe plates and leads.',
  },
  {
    title: 'Know your material',
    body: 'Never cut PVC, vinyl or other plastics that contain chlorine. Avoid fiberglass, ABS, polycarbonate and anything you can’t identify. If you’re not sure what it is, don’t cut it.',
  },
  {
    title: 'Find your stop',
    body: 'Know where your machine’s physical emergency stop is and how to cut the power. The software Abort is not a substitute.',
  },
  {
    title: 'Have an extinguisher ready',
    body: 'Keep a CO₂ or dry-chemical fire extinguisher within reach. Water is not right for electrical fires.',
  },
];

// Cards for "While it runs".
export const WHILE_IT_RUNS = [
  {
    icon: 'eye',
    title: 'Stay with the machine',
    body: 'Never leave a running machine unattended. With a laser, fire is the biggest risk, so keep the bed clear of scrap and the machine clean.',
  },
  {
    icon: 'wind',
    title: 'Clear the air',
    body: 'Laser smoke and fumes can be harmful. Use fume extraction or a well-ventilated area, and never run a laser in a closed room. For a router, use dust collection: some dust can burn.',
  },
  {
    icon: 'glasses',
    title: 'Protect your eyes and ears',
    body: 'Wear glasses rated for your laser’s wavelength, even with an enclosure, and never look at the beam or defeat an interlock. At a router, wear safety glasses, hearing protection, closed-toe shoes and a dust mask.',
  },
  {
    icon: 'hand',
    title: 'Keep hands clear',
    body: 'No loose clothing, gloves, jewelry or loose hair near a spinning tool. Keep your hands away while the spindle runs, and let it stop before you reach in.',
  },
];

// Cards for "What KerfDesk checks". All are code and automated tests only.
export const WHAT_IT_CHECKS = [
  {
    icon: 'scan',
    title: 'Frame before Start',
    body: 'For a normal start, Start unlocks only after a completed Frame of the exact job. A cancelled or interrupted Frame doesn’t count. Edit the artwork or placement, jog, home or reset the origin, and you Frame again.',
  },
  {
    icon: 'clipboard-check',
    title: 'Job Review',
    body: 'When you press Start, Job Review shows the time estimate, job size, settings and any warnings, such as artwork past the bed edge or in a no-go zone. Warnings inform you. They don’t stop the job.',
  },
  {
    icon: 'zap',
    title: 'Laser off on travel',
    body: 'Automated tests read the final G-code and check that the laser is off on every travel move, and KerfDesk repeats that check each time it builds a program. Tests also check that a design placed inside your bed stays inside it.',
  },
  {
    icon: 'drill',
    title: 'Router clearance',
    body: 'Tests check that rapid moves run with the bit at a safe height and that the spindle starts only after the bit is clear. Job Review asks you to confirm the stock is secured and clamps are out of the cutter’s path.',
  },
  {
    icon: 'cpu',
    title: 'Controller settings',
    body: 'Job Review shows the controller’s power scale and laser mode, and flags any that don’t match your machine profile or project. KerfDesk also warns you if the controller’s firmware doesn’t match the profile you picked.',
  },
  {
    icon: 'file-code',
    title: 'No half-built programs',
    body: 'If the program can’t be built, KerfDesk writes no file and sends nothing to the machine.',
  },
].map((item) => ({ ...item, status: 'shipped-code-and-tests' }));

// "What KerfDesk can't know": [lead-in, explanation].
export const CANNOT_KNOW = [
  ['What is in your workshop.', 'It can’t see your material, your machine or anything near it.'],
  [
    'How the result will look.',
    'Tests check the structure of the G-code, not whether a fill, engraving or carve looks right. Output can be wrong and still pass every test.',
  ],
  [
    'Whether ABORT arrived.',
    'It can’t confirm that the controller got the command or that power stopped.',
  ],
  [
    'Focus and physical setup.',
    'Frame traces the rectangle the job will cover. It doesn’t check focus, your material or how the cut will turn out.',
  ],
  [
    'Settings your controller doesn’t report.',
    'KerfDesk can only compare what the controller tells it. When a value is missing, Job Review shows it as unknown.',
  ],
  [
    'Whether anything else is driving the machine.',
    'It can’t tell if a pendant, another app or a controller macro is also sending commands. On a router, Job Review asks you to confirm they’re off.',
  ],
];

// Verification table rows: status is a STATUS key from lib/components.mjs.
// 'hardware-verified' renders "Used on a real machine" (informal use only).
export const TEST_STATUS = [
  {
    area: 'Sending jobs over USB to GRBL-family controllers',
    status: 'hardware-verified',
    note: 'KerfDesk has been used to run real jobs on a Creality Falcon A1 Pro and a Neotronics 4040-class laser. Those runs weren’t recorded as repeatable tests, and some 4040 burns came out uneven, so no machine is listed as verified.',
  },
  {
    area: 'Stock GRBL 1.1 boards',
    status: 'simulator-only',
    note: 'Covered by simulator tests. No stock GRBL 1.1 board has had a recorded hardware test.',
  },
  {
    area: 'FluidNC, Marlin and Smoothieware',
    status: 'simulator-only',
    note: 'Tested against scripted firmware simulators only; FluidNC runs on the GRBL driver and its simulator. Simulators can’t show real timing, electrical behavior or firmware quirks.',
  },
  {
    area: 'Image engraving (photos and other bitmaps)',
    status: 'shipped-code-and-tests',
    note: 'No recorded hardware test yet. Run a small test piece first.',
  },
  {
    area: 'CNC router tools, including touch-plate probing',
    status: 'shipped-code-and-tests',
    note: 'Never cut on a machine, and probing has never run on one. Check the output in a separate viewer, air-cut before cutting material, and stay with your first probe.',
  },
  {
    area: 'Rotary',
    status: 'shipped-code-and-tests',
    note: 'Never run on a physical rotary.',
  },
  {
    area: 'Box generator fit',
    status: 'shipped-code-and-tests',
    note: 'No generated box has been cut and assembled.',
  },
  {
    area: 'Ruida .rd file export',
    status: 'shipped-code-and-tests',
    note: 'Experimental. It passes a software encode-and-decode check, but no real Ruida controller has accepted a file.',
  },
];
