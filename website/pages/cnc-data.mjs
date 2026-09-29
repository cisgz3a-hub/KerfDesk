// Copy for the CNC page (pages/cnc.mjs). Every entry traces to origin/main:
// README.md:29 and :97-114 (CNC status and feature list), src/core/scene/
// machine.ts (cut types, pocket strategies, per-operation settings),
// src/core/scene/cnc-tool-starters.ts (22 built-in bits — README's "18" is
// stale), src/core/cnc/* headers, WORKFLOW.md:973-982 and :6388-6390 (CNC
// Frame and probing limits). The whole CNC surface is code + tests only.
// The docked live 3D pane is NOT mounted (src/ui/app/App.tsx:74); the 3D view
// is Preview's "3D" button (src/ui/workspace/preview-overlays.tsx:158-167).
// Frame traces the job's bounding rectangle (core/controllers/grbl/frame-lines).
// `pro` marks the tools the owner listed as Pro (commerce.config.mjs, ADR-524
// Amendment 1): V-carve, adaptive clearing and 3D reliefs.

export const CUT_TYPES = [
  {
    icon: 'square',
    title: 'Profile outside',
    body: 'Cuts around the outside of a closed shape, so the part keeps its drawn size.',
  },
  {
    icon: 'square-dashed',
    title: 'Profile inside',
    body: 'Cuts inside a closed shape, so a hole keeps its drawn size.',
  },
  {
    icon: 'spline',
    title: 'Profile on path',
    body: 'Cuts centered on the line itself. Open paths always use this.',
  },
  {
    icon: 'layers',
    title: 'Pocket',
    body: 'Clears the inside of a closed shape down to the depth you set.',
  },
  {
    icon: 'pen-tool',
    title: 'Engrave',
    body: 'Follows the path itself, usually at a shallow depth.',
  },
  {
    icon: 'triangle',
    title: 'V-carve',
    pro: true,
    body: 'An angled bit changes depth as the shape widens and narrows. You can cap the depth for wide areas and clear those flat floors with a second bit first.',
  },
  {
    icon: 'puzzle',
    title: 'Inlay pair',
    body: 'Cuts a pocket and a matching straight-walled insert from one shape, with a fit clearance you choose.',
  },
  {
    icon: 'drill',
    title: 'Drill',
    body: 'Drills one hole in the middle of each closed shape’s bounding box. GRBL has no canned drill cycles, so each peck is written out as plain moves that back out to clear chips.',
  },
];

export const POCKET_STRATEGIES = [
  {
    icon: 'circle-dot',
    title: 'Offset rings',
    body: 'Rings that follow the shape of the pocket wall. Your stepover sets the spacing between them.',
  },
  {
    icon: 'scan-line',
    title: 'Rows along X or Y',
    body: 'Straight rows across the pocket, running along X or along Y.',
  },
  {
    icon: 'waves',
    title: 'Adaptive clearing',
    pro: true,
    body: 'Plans a path that keeps the bit’s sideways bite within a radial engagement limit you set. The limit is geometric, not a live load reading. It works on pockets without islands.',
  },
  {
    icon: 'layers-2',
    title: 'Rest machining',
    body: 'A larger end mill clears the bulk first. Your chosen bit then cuts only the material left behind, with a manual tool change in between.',
  },
];

export const ENTRY_TABLE = {
  caption: 'Settings that shape how the bit enters, cuts and leaves',
  head: ['Setting', 'What it does', 'Used on'],
  rows: [
    [
      'Depth passes',
      'Steps down to full depth, removing no more than your depth per pass each time.',
      'Profiles, pockets, engraves and drill pecks',
    ],
    [
      'Ramp entry',
      'Slopes down into the cut along the path at the angle you set, instead of plunging straight down.',
      'Profiles, pockets and engraves',
    ],
    [
      'Helical entry',
      'Spirals down into the pocket with native G2/G3 arcs. Use it or ramp entry, not both.',
      'Pockets',
    ],
    [
      'Lead-in and lead-out',
      'Places the plunge in the waste and joins the wall along an arc or a line, so the entry point sits in the offcut rather than on your part. On by default.',
      'Profile outside and inside',
    ],
    [
      'Climb or conventional',
      'Sets which side of the bit’s path the material sits on as it travels.',
      'Profile outside and inside, and pockets',
    ],
    [
      'Finish allowance',
      'Keeps the roughing passes slightly proud of the wall, then runs one full-depth finishing pass on the true outline.',
      'Profile outside and inside',
    ],
    [
      'Holding tabs',
      'Lifts the bit over each tab within one continuous path, leaving a bridge of material meant to hold the part in place. Drag each tab where you want it.',
      'Profile cuts',
    ],
  ],
};

export const BIG_JOBS = [
  {
    icon: 'mountain',
    title: '3D relief from STL',
    pro: true,
    body: 'Import an STL model and carve it as a relief. KerfDesk roughs it out level by level, then can finish the surface with a ball-nose bit.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'mountain-snow',
    title: 'Reliefs from height maps',
    pro: true,
    body: 'Start a relief from a grayscale PNG height map. Importing one works today. Editing tools and more controls are planned.',
    status: 'in-progress',
  },
  {
    icon: 'grid-2x2',
    title: 'Tiling',
    body: 'Split a job that is bigger than your bed into tiles, with registration holes to line each tile up. Each tile saves as its own G-code file.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'layout-grid',
    title: 'Spoilboard surfacing',
    body: 'A wizard writes a facing program: back-and-forth rows over the area you set, one layer per depth step. Zero X and Y at the front-left corner and Z on the surface first.',
    status: 'shipped-code-and-tests',
  },
];

export const TOOLING = [
  {
    icon: 'wrench',
    title: 'Tool library',
    body: '22 built-in bits — end mills, downcut and compression bits, ball noses and V-bits — plus any bits you add yourself.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'calculator',
    title: 'Feeds and speeds',
    body: 'Works out a feed from spindle speed, flute count and chipload for your material. The values are conservative starting points, so confirm them with a test cut.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'circle-pause',
    title: 'Manual tool change',
    body: 'A job that uses more than one bit stops with M0 between bit sections, so you can swap the bit by hand.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'crosshair',
    title: 'Touch-plate probing',
    body: 'Set Z zero on the stock top, or X, Y and Z together from a corner. Each touch is two-stage: a fast seek, a back-off and a slow re-touch.',
    status: 'shipped-code-and-tests',
  },
];

export const FIRST_CUT_STEPS = [
  {
    title: 'Set up stock and bit',
    body: 'In Machine Setup, choose CNC and check your stock and bit. You can do this before you connect.',
  },
  {
    title: 'Set work zero',
    body: 'Probe Z on the stock top, or an X, Y and Z corner, with a touch plate. Or set Z zero by hand.',
  },
  {
    title: 'Check the program',
    body: 'Press P and step through the simulated cut. Then save the G-code (Ctrl+Shift+E) and open it in a separate G-code viewer.',
  },
  {
    title: 'Frame the job',
    body: 'CNC Frame lifts the bit to a safe height, then traces the rectangle the job covers in X and Y. It needs a Z zero set in this session. A completed Frame unlocks Start. It is a check you watch, not a safety device.',
  },
  {
    title: 'Air-cut, then stay close',
    body: 'Remove the touch plate first. KerfDesk reminds you after probing and again in Job Review. Run the job once with the bit clear of the material, and stay with the machine.',
  },
];

export const CNC_FAQ = [
  {
    id: 'cnc-tested',
    question: 'Has KerfDesk cut on a real router?',
    answer:
      'Not yet. The CNC features are covered by automated tests, but none has cut material on a real machine, and touch-plate probing hasn’t been tried on real hardware either. Check the output in a separate G-code viewer and run an air cut before you cut material.',
  },
  {
    id: 'cnc-other-sender',
    question: 'Can I run the G-code with a different sender?',
    answer:
      'Yes. Choose File → Save G-code (Ctrl+Shift+E) and run the file with the sender you prefer. KerfDesk checks the job first and writes nothing if the program can’t be built.',
  },
  {
    id: 'cnc-no-machine',
    question: 'Can I use CNC mode without a machine connected?',
    answer:
      'Yes. You can design, preview and save projects without connecting anything. Machine Setup can be saved offline too.',
  },
  {
    id: 'cnc-abort',
    question: 'Is Abort an emergency stop?',
    answer:
      'No. Abort is a software stop, not an emergency stop. It asks the controller to reset and can’t confirm that the command arrived. After a lost USB connection or with a full buffer, the machine can keep moving after you click it. For anything dangerous, use your machine’s physical E-stop or cut the power.',
  },
];
