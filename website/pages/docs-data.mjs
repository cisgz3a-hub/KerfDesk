// Copy and data for the Get started page (pages/docs.mjs). Every line is
// grounded in the verified site facts or in the repo files named here:
// WORKFLOW.md F-A4, F-A8, F-A9, F-B1, F-B6, F-C7, F-CNC14/15;
// docs/connection-troubleshooting.md; src/ui/common/shortcut-list.ts;
// src/ui/laser/use-job-shortcuts.ts; src/ui/laser/start-job-flow.ts;
// src/ui/laser/LiveMotionBar.tsx; src/ui/tutorials/cnc-utility-tutorials.ts.
// Competitor names appear only as file-format facts (ADR-120 neutrality).

import { callout, statusPill } from '../lib/components.mjs';
import { html } from '../lib/html.mjs';
import { shot } from '../lib/screens.mjs';

// Keyboard keys joined with "+", for example keys('Ctrl', 'I').
export function keys(...names) {
  return names.map((name, index) => html`${index > 0 && '+'}<kbd>${name}</kbd>`);
}

// Section and step headings, keyed by the id each one carries on the page.
export const TITLES = {
  need: 'What you need',
  design: 'Set up and design',
  open: '1. Open KerfDesk',
  setup: '2. Set up your machine profile',
  artwork: '3. Add artwork',
  operations: '4. Assign operations',
  preview: '5. Preview the toolpath',
  run: 'Run the job',
  connect: '6. Connect your machine',
  frame: '7. Frame the exact job',
  start: '8. Review warnings and start',
  running: 'While it runs',
  cnc: 'CNC extras',
  troubleshooting: 'Connection troubleshooting',
  help: 'Getting help',
};

export const DESIGN_STEPS = ['open', 'setup', 'artwork', 'operations', 'preview'];
export const RUN_STEPS = ['connect', 'frame', 'start'];

// The on-page contents list: [sectionId, stepIds?].
export const CONTENTS = [
  ['need'],
  ['design', DESIGN_STEPS],
  ['run', RUN_STEPS],
  ['running'],
  ['cnc'],
  ['troubleshooting'],
  ['help'],
];

// Body copy for each numbered step, keyed by its heading id.
export const STEP_COPY = {
  open: ({ site }) =>
    html`<p>
        Open <a href="${site.appUrl}">KerfDesk in your browser</a>. You land straight in the
        workspace. There’s no sign-up, no welcome tour and no license key.
      </p>
      <p>
        You can install the web app from your browser. After it has loaded once online, it keeps
        working offline. Updates wait until you click to apply them, so apply them while the machine
        is idle.
      </p>
      <p>
        Prefer a desktop app? <a href="/download/">Desktop Preview builds</a> are available for
        Windows 10 and 11 (64-bit) and macOS 13 or newer. They are unsigned, you install and update
        them yourself, and install testing on real computers is still pending.
      </p>
      <p>
        New here? Click <strong>Learn</strong> in the top toolbar and start with the short “Make
        your first project” lesson.
      </p>`,
  setup: () =>
    html`<p>Open <strong>Machine Setup</strong>. It has three stages:</p>
      <ol>
        <li>
          <strong>Machine:</strong> choose Laser only, CNC only or Laser + CNC. Then pick a starting
          point: a named machine profile, a CNC size preset or a generic template for your
          controller family.
        </li>
        <li>
          <strong>Essentials:</strong> check the work area, origin, homing and the laser output or
          CNC machine limits against your machine.
        </li>
        <li>
          <strong>Review &amp; save:</strong> check the summary, then click
          <strong>Save machine setup</strong>.
        </li>
      </ol>
      <p>
        You don’t need to connect first. If your controller is connected, KerfDesk lists the values
        it reports, and copies them into your setup only when you click
        <strong>Use detected values</strong>. Saving your setup doesn’t change your controller’s own
        settings.
      </p>
      <p>
        Built-in profiles are starting points. Each one shows how well it has been checked. No
        built-in profile is marked hardware-verified today, so confirm your work area, firmware,
        homing and power scale yourself.
      </p>`,
  artwork: () =>
    html`<p>
        Choose <strong>File → Import</strong> (${keys('Ctrl', 'I')}, or ${keys('Cmd', 'I')} on a
        Mac), click Import in the top toolbar, or drag a file into KerfDesk. All three take the same
        files: SVG or DXF for outlines, PNG or JPG for pictures, and STL for a CNC relief.
      </p>
      <ul>
        <li>
          <strong>SVG:</strong> convert text to paths in your design program first. KerfDesk skips
          text and embedded images inside an SVG.
        </li>
        <li><strong>DXF:</strong> use ASCII DXF. Binary DXF isn’t supported.</li>
        <li>
          <strong>LightBurn projects:</strong> open .lbrn2 files with <strong>File → Open</strong>.
          This works one way only: KerfDesk reads LightBurn files but never writes them, and bitmaps
          and some text don’t come across.
        </li>
      </ul>
      <p>
        You can also draw shapes and type text right on the canvas. Whatever you add, check its
        width and height in millimeters and place it where it belongs on your material.
      </p>`,
  operations: (ctx) =>
    html`<p>
        Each piece of artwork gets a named operation that says what happens to it. Operations attach
        to the artwork itself, not to a color. Select the artwork, open
        <strong>Settings → Operation</strong> and choose one:
      </p>
      <ul>
        <li>
          <strong>Laser:</strong> Line cuts or scores outlines, Fill hatches the inside of shapes,
          and Image engraves photos. Then set power, speed and passes.
        </li>
        <li>
          <strong>CNC:</strong> choose a cut such as profile, pocket, V-carve or drill. Then set
          depth and feeds.
        </li>
      </ul>
      <p>Each operation has its own settings, and you control the order they run in.</p>
      <p>
        ${statusPill('shipped-code-and-tests')} Image engraving and every CNC cut are built and
        covered by software tests, but haven’t run on a real machine yet. Try a small test piece for
        images, and air-cut CNC jobs before you cut material.
      </p>
      ${shot(ctx, 'workspace')}`,
  preview: (ctx) =>
    html`<p>
        Press <kbd>P</kbd> or click <strong>Preview</strong> in the toolbar. Cut paths show in their
        operation colors and travel moves show as dashed lines. Use Play, Pause and the progress
        slider to step through the route. The preview also shows an estimated job time. Treat it as
        an estimate, not a promise.
      </p>
      <p>
        Preview changes only what you see on screen. It doesn’t replace the Frame on your machine in
        step 7.
      </p>
      <p>
        Now save your project with <strong>File → Save As</strong>. It’s stored on your computer as
        an .lf2 file in the folder you choose, with no cloud copy. After that, press
        ${keys('Ctrl', 'S')} to save your changes as you work.
      </p>
      ${shot(ctx, 'preview')}`,
  connect: () =>
    html`<p>
        Switch the machine on, plug in the USB cable, click <strong>Connect</strong> and pick your
        machine’s port. Not sure which port it is? Unplug the machine and see which entry
        disappears.
      </p>
      <p>
        Most GRBL machines use 115200 baud, and each machine profile keeps its own baud rate. Only
        one program can use the port at a time, so close any other laser or CNC software first.
        KerfDesk connects over USB only, not Wi-Fi.
      </p>
      <p>
        KerfDesk recognizes GRBL, grblHAL, FluidNC, Marlin and Smoothieware from the message the
        controller sends when it connects. If your profile is for a different family, you’ll see a
        warning in Machine Setup and again in Job Review. Testing differs a lot between controller
        families, so <a href="/machines/">check what has been tested for yours</a>.
      </p>`,
  frame: () =>
    html`<p>
        Click <strong>Set up &amp; Frame</strong> (or <strong>Frame job</strong>). With the laser or
        spindle off, the head traces the area your exact job will cover, so you can see where it
        will run on your material. Watch the whole trace. If something looks wrong, click
        <strong>ABORT MOTION</strong> in the Live Motion bar. It’s a software stop, not an emergency
        stop, so in an emergency use your machine’s physical E-stop.
      </p>
      <p>
        A Frame that finishes cleanly unlocks Start for that exact job, and the button changes to
        <strong>Start framed job</strong>. A cancelled or interrupted Frame doesn’t.
      </p>
      <p>
        Change the job and you’ll need to Frame again. Editing the artwork, output or placement, or
        jogging, homing or resetting the origin, clears the finished Frame.
      </p>
      ${callout({
        title: 'Frame shows where, not how',
        body: html`<p>
          Frame checks the outline and placement of the job. It doesn’t check how the cut or engrave
          will turn out, and it isn’t a safety interlock.
        </p>`,
      })}`,
  start: () =>
    html`<p>
        Click <strong>Start framed job</strong>. Job Review opens with the estimated time, the job
        size, the settings for each piece of artwork and any warnings.
      </p>
      <p>
        Warnings cover things like a design that runs past the bed edge, a no-go zone or a
        controller setting. Read them. They don’t block the job, so the decision is yours. When
        you’re ready, click <strong>Start job</strong>.
      </p>
      <p>
        If you change a setting inside Job Review and the program changes, KerfDesk asks for a new
        Frame before it sends anything.
      </p>
      ${callout({
        title: 'Prefer another sender?',
        iconName: 'file-down',
        body: html`<p>
          Choose <strong>File → Save G-code</strong> (${keys('Ctrl', 'Shift', 'E')}) and run the
          file with the sender you like. KerfDesk checks the job first and writes nothing if the
          program can’t be built. Look the file over in a separate G-code viewer before you run it.
          Saving a file doesn’t count as a Frame for a job you later run from KerfDesk.
        </p>`,
      })}`,
};

export const NEEDS = [
  {
    icon: 'monitor',
    title: 'A computer and a Chromium browser',
    body: 'Chrome, Edge, Brave or Arc on Windows, macOS or Linux, or the desktop Preview for Windows or macOS. Firefox and Safari can’t open or save files or connect to a machine.',
    href: '/download/',
  },
  {
    icon: 'usb',
    title: 'A GRBL-family machine on USB',
    body: 'KerfDesk is built for GRBL, grblHAL and FluidNC controllers, connected with a USB cable that carries data. Testing so far is limited and varies by controller, so check yours first.',
    href: '/machines/',
  },
  {
    icon: 'pen-tool',
    title: 'Something to make',
    body: 'An SVG, DXF, PNG, JPG or STL file. Or start with nothing: you can draw shapes and type text right on the canvas.',
  },
  {
    icon: 'fire-extinguisher',
    title: 'Safety basics within reach',
    body: 'A fire extinguisher, good ventilation and, for a laser, eye protection rated for its wavelength. Know where your machine’s physical E-stop is.',
    href: '/safety/',
  },
];

export const CNC_EXTRAS = [
  {
    icon: 'crosshair',
    title: 'Set work zero',
    body: 'KerfDesk treats the top of your stock as Z zero. The Set origin here button sets X and Y only, so set Z too: jog the bit down to touch the stock top and click Zero Z, or use a touch plate.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'target',
    title: 'Probe with a touch plate',
    body: 'Choose Z only for the stock top, or XYZ corner to set a stock corner as well. Corner probing needs a cylindrical end mill. Enter your measured plate thickness, and remove the plate afterward. Job Review reminds you.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'drill',
    title: 'Change bits mid-job',
    body: 'When a job uses more than one bit, it lifts the bit, stops the spindle, parks and pauses. Swap the bit, select it as the active bit, set its Z zero, then click Continue. Continue stays off until the new bit has a Z zero.',
    status: 'shipped-code-and-tests',
  },
];

export const CONNECT_FIXES = [
  {
    title: 'Use a supported browser',
    body: 'Connecting needs Chrome, Edge, Brave or Arc, or the desktop Preview. Firefox and Safari can’t connect. In Brave, you may need to turn on Web Serial in Shields or flags.',
  },
  {
    title: 'Check the cable, power and driver',
    body: 'Switch the machine on and use a USB data cable plugged straight into the computer, not a hub. On Windows, a board with a CH340 chip usually needs that chip’s driver installed by hand. In Device Manager, a yellow warning icon under Ports (COM & LPT) means the driver is missing.',
  },
  {
    title: 'Pick the right port',
    body: 'Click Connect and choose your machine’s port. On Windows, it’s the COM port you saw in Device Manager. Still not sure? Unplug the machine and see which entry disappears.',
  },
];

export const KEYS = [
  [keys('P'), 'Turn Preview on or off'],
  [keys('F'), 'Fit the whole bed in view'],
  [keys('Ctrl', 'I'), 'Import artwork'],
  [keys('Ctrl', 'S'), 'Save your project'],
  [keys('Ctrl', 'Shift', 'E'), 'Save G-code'],
  [
    keys('Ctrl', 'Enter'),
    'Same as the main job button, on a connected machine. Without a completed Frame, it runs Set up & Frame, so the machine moves.',
  ],
  [keys('Ctrl', '.'), 'Software Abort during a running job. It is not an emergency stop.'],
];
