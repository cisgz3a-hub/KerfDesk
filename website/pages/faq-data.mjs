// FAQ questions and answers, grouped by topic. Every answer is grounded in the
// repo (README.md, PROJECT.md, WORKFLOW.md, DECISIONS.md ADR-247/322, ADR-523,
// SECURITY.md, docs/connection-troubleshooting.md, public/download.html and
// public/support.html). Machine claims follow the 2026-09-19 compatibility
// audit: no machine is described as verified. Pricing answers follow the
// owner's settled Free and Pro offer (commerce.config.mjs, ADR-524 Amendment 1),
// with no open-source selling points. Help and problem reports go to the
// support page: the source repository is private.

import { statusPill } from '../lib/components.mjs';
import { formatPrice } from '../lib/commerce.mjs';
import { html } from '../lib/html.mjs';

function gettingStarted() {
  return [
    {
      id: 'account',
      question: 'Do I need an account?',
      answer:
        'No. There’s no sign-up or sign-in. KerfDesk Free opens straight to the workspace, so you can start working right away, and the Pro trial needs no card.',
    },
    {
      id: 'browsers',
      question: 'Which browsers can I use?',
      answer: html`<p>
          Use a Chromium-based browser: Chrome, Edge, Brave or Arc. You can also use the KerfDesk
          desktop Preview. KerfDesk relies on the browser’s file access and Web Serial features to
          open and save projects and to talk to your machine.
        </p>
        <p>
          Firefox and Safari don’t have those features, so they can’t open or save projects or
          connect to a machine. In some versions of Brave, you may need to switch on Web Serial in
          Shields or flags first.
        </p>`,
    },
    {
      id: 'mac-linux',
      question: 'Does KerfDesk run on a Mac or on Linux?',
      answer: html`<p>
          Yes. The web app runs in Chrome or Edge on Windows, Mac and Linux, and you can install it
          from the browser. There’s no Linux desktop app yet, so on Linux, use the web app.
        </p>
        <p>
          ${statusPill('in-progress')} Desktop Previews are available for Windows 10 and 11 (64-bit)
          and for macOS 13 or newer on Intel and Apple Silicon Macs. They are early, unsigned
          builds, and Mac Previews aren’t notarized by Apple, so your computer may warn you the
          first time you open one. Testing on real Windows and Mac computers isn’t finished yet. The
          <a href="/download/">download page</a> has the install steps.
        </p>`,
    },
    {
      id: 'offline',
      question: 'Does KerfDesk work offline?',
      answer: html`<p>
          Yes, after the web app has loaded online once. It’s then saved for offline use, and you
          can install it from your browser so it opens in its own window. Designing, previewing and
          running your machine happen on your computer, with no internet needed.
        </p>
        <p>
          Two limits: some optional lesson pictures load only the first time you view them online,
          and driving a machine over USB with the network off is confirmed in software but hasn’t
          been tested on hardware yet.
        </p>`,
    },
    {
      id: 'without-machine',
      question: 'Can I use KerfDesk without a machine, or just to make G-code?',
      answer: html`<p>
          Yes. You can draw, import, preview and save projects without connecting anything, and you
          can save a Machine Setup offline.
        </p>
        <p>
          To run a job with a different sender, choose File → Save G-code
          (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>, or <kbd>Cmd</kbd> on a Mac). KerfDesk
          checks the job first and writes nothing if the program can’t be built. Check the saved
          file in a separate G-code viewer before you run it.
        </p>`,
    },
  ];
}

function machinesAndConnection(site) {
  return [
    {
      id: 'my-machine',
      question: 'Will KerfDesk work with my machine?',
      answer: html`<p>
          KerfDesk is built for GRBL-family controllers (GRBL 1.1, grblHAL and FluidNC) connected
          over USB. It also has drivers for Marlin and Smoothieware lasers, and an experimental file
          export for Ruida CO₂ controllers. How far each one has been tested varies a lot:
        </p>
        <ul>
          <li>
            ${statusPill('hardware-verified')} Real jobs have been run with KerfDesk on a Creality
            Falcon A1 Pro (GRBL-family firmware) and a Neotronics 4040-class laser. Those runs
            weren’t recorded as repeatable tests, and some 4040 burns came out uneven, so no machine
            is listed as verified yet.
          </li>
          <li>
            ${statusPill('simulator-only')} GRBL 1.1, FluidNC, Marlin and Smoothieware have only
            been tested against firmware simulators. No stock GRBL 1.1 board has had a recorded
            hardware test, and none of the others has been tried on a real controller.
          </li>
          <li>
            ${statusPill('shipped-code-and-tests')} Ruida export writes vector-only .rd files, with
            no live connection. No real Ruida controller has accepted one yet.
          </li>
        </ul>
        <p>
          Trocen, TopWisdom and galvo controllers aren’t supported. Whatever you run, check your
          first jobs with Preview and an air run, and stay with the machine. The
          <a href="/machines/">machines page</a> has the details.
        </p>`,
    },
    {
      id: 'connect',
      question: 'How does KerfDesk connect to my machine?',
      answer: html`<p>
          With a USB cable. Plug it in, click Connect and pick your machine’s port. Most GRBL
          machines use 115200 baud. KerfDesk doesn’t control machines over Wi-Fi or a network, and
          that includes FluidNC boards.
        </p>
        <p>
          Can’t connect? Use a USB cable that carries data, install the CH340 driver on Windows if
          your board needs it, and close any other machine software that’s using the port. In the
          app, Help → Can’t connect? (Troubleshooting) lists these steps, including USB drivers.
        </p>`,
    },
    {
      id: 'frame-first',
      question: 'Why is Start locked until I Frame the job?',
      answer: html`<p>
          Before a normal start, KerfDesk asks you to Frame the job. With the laser or spindle off,
          the head moves around the rectangle your job will cover, so you can see where it will land
          on your material. A Frame that finishes cleanly unlocks Start for that exact job, for one
          run. A cancelled or interrupted Frame doesn’t.
        </p>
        <p>
          If Start is locked, check three things: the machine is connected and ready, the job builds
          without errors, and you’ve framed the job as it is now. Editing the artwork, output or
          placement, or jogging, homing or resetting the origin, means you Frame again.
        </p>
        <p>
          Frame is a check you watch, not a safety interlock. It shows where the job goes, not how
          the result will look. Other findings, such as a design running past the bed, appear as
          warnings in Job Review. You read them and decide.
        </p>`,
    },
    {
      id: 'abort',
      question: 'Is the Abort button an emergency stop?',
      answer: html`<p>
          No. Abort is a software stop, not a safety-rated emergency stop. It sends your controller
          a reset or stop request, but it can’t confirm that the command arrived or that power
          actually stopped. After a USB disconnect, a crash or a full controller buffer, the machine
          may keep moving after you click it.
        </p>
        <p>
          In an emergency, use your machine’s physical E-stop or power switch, and keep it within
          reach. While a job runs, the ABORT button stays on screen, and
          <kbd>Ctrl</kbd>+<kbd>.</kbd> (<kbd>Cmd</kbd>+<kbd>.</kbd> on a Mac) sends the same
          software Abort as long as the KerfDesk window is in focus.
          <a href="/safety/">Read the safety notes</a>.
        </p>`,
    },
    {
      id: 'help-verify',
      question: 'How can I help test KerfDesk on real hardware?',
      answer: html`<p>
          Reports from real machines show what still needs checking. If something goes wrong, file a
          bug report (see <a href="#report-bug">How do I report a bug?</a>) with your machine type,
          controller and firmware. For anything that isn’t a bug, including how a job went on your
          machine, use the <a href="${site.supportUrl}">KerfDesk support page</a> too.
        </p>
        <p>
          Test safely. Check the job with Preview and an air run, start on scrap material, and stay
          with the machine. If a bug caused unsafe motion, describe it. Don’t run it again to
          reproduce it.
        </p>`,
    },
  ];
}

function filesAndFeatures() {
  return [
    {
      id: 'file-types',
      question: 'What files can I import?',
      answer: html`<p>
          Artwork: SVG and DXF drawings, PNG and JPG images, and STL models for CNC reliefs. Bring
          them in with File → Import (<kbd>Ctrl</kbd>+<kbd>I</kbd>, or <kbd>Cmd</kbd>+<kbd>I</kbd>
          on a Mac), the toolbar or drag-and-drop. DXF files must be ASCII. Binary DXF isn’t
          supported.
        </p>
        <p>
          You can also bring in .ttf and .otf fonts, CSV data for variable text, and LightBurn
          projects and cut libraries. G-code files (.nc, .gcode and .tap) open in the Pro G-code
          Inspector for viewing, but they don’t become editable artwork. .ai, PDF, EPS, .cdr,
          Gerber, OBJ and 3MF files aren’t supported.
        </p>`,
    },
    {
      id: 'lightburn',
      question: 'Can I open my LightBurn files?',
      answer: html`<p>
          Yes, one way. Open .lbrn or .lbrn2 projects with File → Open, and KerfDesk brings over the
          shapes plus each layer’s speed, power, passes and Line or Fill mode. Bitmaps and some text
          don’t come across. Import has been tested with real .lbrn2 files. Older .lbrn files
          haven’t been tested.
        </p>
        <p>
          You can also import .clb cut libraries as material presets, which replaces your active
          library. Importing .lbdev device profiles is experimental, and .lbzip bundles aren’t
          supported. KerfDesk reads LightBurn files but never writes them.
        </p>`,
    },
    {
      id: 'svg-text',
      question: 'Why is the text in my SVG missing?',
      answer:
        'KerfDesk skips text and embedded images inside SVG files. Before you export from your design program, convert the text to paths (sometimes called outlines). Or type the text in KerfDesk instead: it has bundled fonts, including single-line fonts for engraving, and it can use your own .ttf or .otf fonts, saved inside the project.',
    },
    {
      id: 'photos-cnc',
      question: 'Can KerfDesk engrave photos or carve on a CNC router?',
      answer: html`<p>
          ${statusPill('shipped-code-and-tests')} It has the tools for both, but neither has run on
          a real machine yet. Image mode offers 11 dithering and grayscale options for photos, at 5
          to 25 lines per mm. CNC mode has profile, pocket, engrave, inlay and drill cuts, V-carve
          in Pro, touch-plate probing and a 3D preview.
        </p>
        <p>
          Both are covered by code and automated tests, which check structure, not whether a result
          looks right. Start with a small test piece, check the G-code in a separate viewer, and
          air-cut before you cut material. There’s more on the <a href="/laser/">laser</a> and
          <a href="/cnc/">CNC</a> pages.
        </p>`,
    },
  ];
}

function pricingAndLicense(commerce) {
  const [plan] = commerce.plans;
  return [
    {
      id: 'free',
      question: 'Is KerfDesk free?',
      answer: html`<p>
        KerfDesk Free is, with no time limit, in the browser and on the desktop. It covers drawing,
        text, file import, basic tracing, laser cutting and engraving, 2D CNC cuts and all machine
        control. See <a href="#pro">What does Pro add?</a>
      </p>`,
    },
    plan && {
      id: 'pro',
      question: 'What does Pro add, and what does it cost?',
      answer: html`<p>
          ${plan.name} adds ${plan.includes.join(', ')}. A license costs
          ${formatPrice(plan.price, commerce.currency)}, paid once, and includes one year of
          updates. Every version released during that year keeps working forever. After the year,
          ${formatPrice(plan.updateYearPrice, commerce.currency)} adds another year of updates if
          you want it; it never renews automatically.
        </p>
        <p>
          One license is active on up to ${plan.deviceLimit} devices at a time, and each device can
          try ${plan.name} free for ${plan.trialDays} days with no card. When a trial ends, only the
          ${plan.name} tools lock, and a license never stops a job from running. Purchase opens
          soon. See <a href="/pricing/">pricing</a>.
        </p>`,
    },
    {
      id: 'license-terms',
      question: 'Where can I read KerfDesk’s license terms?',
      answer: html`<p>
        On the <a href="/license/">license page</a>. It also lists the libraries and fonts bundled
        with KerfDesk, which keep their own licenses. KerfDesk is provided as is, without warranty,
        and you’re responsible for running your machine safely.
      </p>`,
    },
  ].filter(Boolean);
}

function privacyAndData(site) {
  return [
    {
      id: 'data',
      question: 'Does KerfDesk collect my data?',
      answer: html`<p>
          No. KerfDesk has no analytics, no error reporting, no cloud sync and no accounts. Your
          projects, machine details and jobs stay on your computer.
        </p>
        <p>
          It does make a few ordinary connections. The web app contacts kerfdesk.com to load and to
          check for a newer version of itself. Each time you open a desktop Preview, it asks
          ${site.downloadHost} once whether a newer Preview exists. A Pro trial or license sends
          ${site.licensingHost} only an installation digest, a device label, the license key and
          order details. None of these carries project, drawing, toolpath, machine or job data, but
          each service sees normal connection details such as your IP address and the time.
          <a href="/privacy/">Read the privacy page</a>.
        </p>`,
    },
    {
      id: 'projects',
      question: 'Where are my projects saved?',
      answer:
        'On your computer, as .lf2 project files in the folder you choose. There’s no cloud copy. When you save G-code, keep the project file too, so the design and settings stay editable.',
    },
    {
      id: 'report-bug',
      question: 'How do I report a bug?',
      answer: html`<p>
          Use the <a href="${site.reportUrl}">KerfDesk support page</a>. It lists what to include,
          and a support email address will be listed there once it’s set up. Describe what happened
          and the steps that cause it, and include the KerfDesk version from Help → About KerfDesk.
          A project file or exported G-code helps a lot.
        </p>
        <p>
          For machine problems, a copy of your controller settings helps too. With a GRBL-family
          controller connected and idle, open the Read / Backup Controller Settings section, choose
          Read ($$), then Export backup. KerfDesk saves the settings your controller reported as a
          file on your computer, and it stays there until you choose to share it.
        </p>
        <p>
          Found a security problem? Report it through the support page too, and please don’t post
          the details anywhere public.
        </p>`,
    },
  ];
}

// [{ id, title, items: [{ id, question, answer }] }]
export function faqSections(site, commerce) {
  return [
    { id: 'getting-started', title: 'Getting started', items: gettingStarted() },
    {
      id: 'machines-connection',
      title: 'Machines and connection',
      items: machinesAndConnection(site),
    },
    { id: 'files-features', title: 'Files and features', items: filesAndFeatures() },
    { id: 'pricing-license', title: 'Pricing and license', items: pricingAndLicense(commerce) },
    { id: 'privacy-data', title: 'Privacy and data', items: privacyAndData(site) },
  ];
}
