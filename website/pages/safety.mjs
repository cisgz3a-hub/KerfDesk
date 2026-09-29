// Safety page. Grounded in docs/safety.md, public/eula.txt, SECURITY.md and the
// README status table; long copy lives in safety-data.mjs. Abort is always
// described as a software stop, and nothing here certifies or guarantees safety.

import {
  actions,
  button,
  callout,
  ctaBand,
  featureGrid,
  pageHero,
  section,
  split,
  statusPill,
  steps,
  table,
} from '../lib/components.mjs';
import { html } from '../lib/html.mjs';
import { shot } from '../lib/screens.mjs';
import {
  BEFORE_EVERY_JOB,
  CANNOT_KNOW,
  TEST_STATUS,
  WHAT_IT_CHECKS,
  WHILE_IT_RUNS,
} from './safety-data.mjs';

function responsibilities() {
  return section({
    narrow: true,
    title: 'Your responsibilities',
    content: html`<div class="prose">
        <p>
          KerfDesk prepares toolpaths and sends commands to your laser or router. It is provided “as
          is”, with no warranty. You use it, and run your machine, at your own risk.
        </p>
        <p>That makes you responsible for:</p>
        <ul>
          <li>never leaving a running machine unattended;</li>
          <li>checking every job before it cuts real material;</li>
          <li>
            setting up your machine correctly, holding the work securely and keeping the emergency
            stop within reach;
          </li>
          <li>
            knowing that a material is safe to cut or engrave, and handling its fumes and dust;
          </li>
          <li>
            following your machine maker’s instructions and your local fire, electrical, ventilation
            and safety rules.
          </li>
        </ul>
        <p>
          KerfDesk’s previews, simulations and pre-run checks help you spot problems. They are aids,
          not guarantees of safe output. When you’re unsure about a material, read its safety data
          sheet (SDS) and your machine maker’s guidance. The
          <a href="/license/">license page</a> sums up the warranty and liability terms.
        </p>
      </div>
      ${callout({
        tone: 'safety',
        title: 'ABORT is a software stop, not an emergency stop',
        body: html`<p>
          In an emergency, use your machine’s physical E-stop or cut the power.
          <a href="#abort">Why Abort can’t be relied on</a>.
        </p>`,
      })}`,
  });
}

// Two alt sections in a row: the section padding separates the checklist from
// the preview row without a new CSS rule.
function beforeEveryJob(ctx) {
  return html`${section({
    id: 'before',
    tone: 'alt',
    eyebrow: 'Before every job',
    title: 'Check the job before anything moves',
    lead: 'Do these every time, not just the first time.',
    content: steps(BEFORE_EVERY_JOB),
  })}
  ${section({
    tone: 'alt',
    content: split({
      title: 'Look at the path on screen first',
      body: 'Press P to preview the toolpath. Cuts show as solid lines and travel moves as dashed lines, and you can play the route through from start to finish. Preview is a check on screen. It doesn’t take the place of a Frame on the real material.',
      points: [
        'Preview and play back the route before you connect a machine',
        'Play the program back in 3D in the G-code Inspector',
        'Save the G-code and check it in a separate viewer too',
      ],
      media: shot(ctx, 'preview'),
    }),
  })}`;
}

function whileItRuns() {
  return section({
    eyebrow: 'While it runs',
    title: 'Stay close and stay protected',
    content: featureGrid(WHILE_IT_RUNS, { columns: 2 }),
  });
}

function abortSection() {
  return section({
    id: 'abort',
    tone: 'alt',
    narrow: true,
    eyebrow: 'Stopping the machine',
    title: 'ABORT is a software stop',
    lead: 'It is not a safety-rated emergency stop. Only your machine’s physical E-stop or power switch is certain to stop it.',
    content: html`<div class="prose">
      <h3>What ABORT does</h3>
      <p>
        ABORT sends your controller its abort or reset command. The button reads ABORT JOB during a
        job and ABORT MOTION during a Frame or jog. It stays on screen above any open dialog, with
        the software-stop warning right beside it. While KerfDesk is the active window and a job is
        running, Ctrl+. (Cmd+. on a Mac) does the same, even with a dialog open or while you’re
        typing.
      </p>
      <h3>Why it can fail</h3>
      <p>
        Software commands can be lost. After a USB disconnect, a crash or a full controller buffer,
        the machine may keep moving after you click ABORT. KerfDesk can’t confirm that the command
        arrived or that power actually stopped. Once the USB link is gone, it has no way to turn the
        laser off, and the controller can hold its last power setting until its queued moves finish.
      </p>
      <h3>Marlin and Smoothieware work differently</h3>
      <p>
        These controllers have no instant pause. KerfDesk pauses by holding back new moves, so moves
        already queued in the controller still finish. On Marlin, ABORT stops sending and adds
        commands to turn the laser off, so moves already in its buffer may still run.
      </p>
      <h3>After an Abort</h3>
      <p>
        A GRBL controller goes into an alarm state after a reset, and KerfDesk shows the alarm with
        a recovery step. Check that the head is somewhere safe before you unlock it. If the machine
        was moving, the controller no longer trusts its position, so home it again before you carry
        on.
      </p>
    </div>`,
  });
}

function laserModeSection() {
  return section({
    id: 'laser-mode',
    narrow: true,
    eyebrow: 'Controller settings',
    title: 'Laser mode and router mode',
    lead: 'GRBL-family controllers have a laser mode setting, number 32 in the controller’s settings list. A laser needs it on. A router needs it off.',
    content: html`<div class="prose">
      <ul>
        <li><strong>A laser with laser mode off:</strong> a feed hold can leave the beam on.</li>
        <li>
          <strong>A router with laser mode on:</strong> the controller cuts spindle power during
          rapid moves, so a plunge can start before the bit is up to speed.
        </li>
      </ul>
      <p>
        When your controller reports this setting, Job Review compares it with your project and
        tells you if it doesn’t match. On a laser job where KerfDesk can’t confirm that laser mode
        is on, Job Review asks you to confirm that you’ve checked the setting yourself before you
        start. If the controller doesn’t report the setting at all, KerfDesk can’t check it, and Job
        Review says so.
      </p>
      <p>
        For a laser project, KerfDesk won’t write “laser mode off” to the controller from Machine
        Setup or the Console. FluidNC keeps this setting in its own config file, so you change it
        there. Your machine maker’s documentation is the place to confirm the right setting for your
        machine.
      </p>
    </div>`,
  });
}

function checksSection() {
  return section({
    id: 'checks',
    tone: 'alt',
    eyebrow: 'Checks and limits',
    title: 'What KerfDesk checks, and what it can’t know',
    lead: 'These checks are built into KerfDesk and covered by automated tests. None of them is a safety interlock, and none replaces your own check at the machine.',
    content: html`${featureGrid(WHAT_IT_CHECKS)}
      <div class="prose">
        <h3>What KerfDesk can’t know</h3>
        <ul>
          ${CANNOT_KNOW.map(([lead, rest]) => html`<li><strong>${lead}</strong> ${rest}</li>`)}
        </ul>
      </div>`,
  });
}

function testedSection() {
  return section({
    id: 'tested',
    eyebrow: 'Honest status',
    title: 'How much has been tested',
    lead: 'KerfDesk labels how each part has been checked, so you know where to be most careful.',
    content: html`${table({
      caption: 'How each part of KerfDesk has been checked',
      head: ['Area', 'Status', 'What that means'],
      rows: TEST_STATUS.map((row) => [row.area, statusPill(row.status), row.note]),
    })}
    ${callout({
      title: 'Passing tests is not a machine run',
      body: html`<p>
          Automated tests check structure and repeatability. They don’t prove that a result looks
          right. In Machine Setup, each built-in machine profile carries a label that says how it
          was checked, and no profile is marked as verified on hardware today.
        </p>
        <p>
          Stay with your first jobs on any machine, and do an air run before you cut material. The
          <a href="/machines/">machines page</a> has the full list.
        </p>`,
    })}`,
  });
}

function reportSection(site) {
  return section({
    id: 'report',
    tone: 'alt',
    narrow: true,
    eyebrow: 'Found a problem?',
    title: 'Report a safety problem privately',
    content: html`<div class="prose">
        <p>
          If you find a problem that could change what the machine does, get past a safety check,
          expose files or devices on your computer, or run untrusted code, report it privately
          through GitHub. Please don’t post the details in a public issue.
        </p>
        <p>
          Include the KerfDesk version, your platform, your controller family and the steps to
          reproduce it, without moving real hardware where you can. Security fixes go into the
          latest release; older builds aren’t patched separately. If private reporting isn’t
          available, open a short public issue that asks for a private channel, without describing
          the problem.
        </p>
      </div>
      ${callout({
        tone: 'safety',
        title: 'Test carefully',
        body: html`<p>
          Never test a suspected machine-control problem with the laser or spindle powered unless
          someone is watching the machine, the work area is clear and an independent stop is within
          reach. If a test cuts the USB link or the controller’s power, physically disable the laser
          output first.
        </p>`,
      })}
      ${actions(
        button(site.securityReportUrl, 'Report a problem privately', { iconName: 'lock' }),
        button(site.issuesUrl, 'Report other bugs', { variant: 'secondary' }),
      )}`,
  });
}

export const page = {
  path: '/safety/',
  nav: null,
  title: 'Safety',
  description:
    'How to use KerfDesk responsibly: what to check before every job, why Abort is not an emergency stop, and how much has been tested.',
  render: (ctx) => {
    const { site } = ctx;
    return html`${pageHero({
      eyebrow: 'Safety',
      title: 'Safety and responsible use',
      lead: 'Lasers and CNC routers can start fires, injure your eyes and throw parts. KerfDesk helps you check a job before it runs, but it can’t see your workshop, your material or your machine. Running the machine safely is up to you.',
      extra: actions(
        button(site.safetyGuideUrl, 'Read the full safety guide', { iconName: 'book-open' }),
        button('#abort', 'About the Abort button', { variant: 'secondary' }),
      ),
    })}
    ${responsibilities()} ${beforeEveryJob(ctx)} ${whileItRuns()} ${abortSection()}
    ${laserModeSection()} ${checksSection()} ${testedSection()} ${reportSection(site)}
    ${ctaBand({
      title: 'More detail in the full guide',
      body: 'The safety guide covers lasers and CNC routers. In the app, Help → Safety & liability has a summary, and the Windows installer shows the License & Safety Notice.',
      buttons: [
        button(site.safetyGuideUrl, 'Read the safety guide', { iconName: 'book-open' }),
        button('/machines/', 'Check your machine', { variant: 'ghost-dark' }),
      ],
    })}`;
  },
};
