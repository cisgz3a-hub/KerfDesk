// Get started: one page that walks a new user from opening KerfDesk to a first
// framed job. The step copy and lists live in docs-data.mjs, with their sources.
// Anything a reader could take as "works on my machine" carries a status pill
// or says plainly what has not been tested.

import {
  button,
  callout,
  ctaBand,
  featureGrid,
  pageHero,
  section,
  steps,
  table,
} from '../lib/components.mjs';
import { html } from '../lib/html.mjs';
import {
  CNC_EXTRAS,
  CONNECT_FIXES,
  CONTENTS,
  DESIGN_STEPS,
  KEYS,
  keys,
  NEEDS,
  RUN_STEPS,
  STEP_COPY,
  TITLES,
} from './docs-data.mjs';

function contentsSection() {
  const link = (id) => html`<a href="#${id}">${TITLES[id]}</a>`;
  return section({
    narrow: true,
    content: html`<nav class="prose" aria-label="On this page">
        <p class="eyebrow">On this page</p>
        <ul>
          ${CONTENTS.map(
            ([id, children]) =>
              html`<li>
                ${link(id)}
                ${children &&
                html`<ul>
                  ${children.map((child) => html`<li>${link(child)}</li>`)}
                </ul>`}
              </li>`,
          )}
        </ul>
      </nav>
      ${callout({
        tone: 'safety',
        title: 'Before your first job',
        body: html`<p>
          Check every job before you run it, stay with the machine and keep a fire extinguisher
          nearby. The Abort button in KerfDesk is a software stop, not an emergency stop.
          <a href="/safety/">Read the safety notes</a>.
        </p>`,
      })}`,
  });
}

// Numbered steps: an h3 carrying the step's id, then its copy.
function stepBlocks(ids, ctx) {
  return html`<div class="prose">
    ${ids.map(
      (id) =>
        html`<h3 id="${id}">${TITLES[id]}</h3>
          ${STEP_COPY[id](ctx)}`,
    )}
  </div>`;
}

function runningSection() {
  return section({
    id: 'running',
    narrow: true,
    title: TITLES.running,
    lead: 'Stay with the machine until the job ends. Never leave it running unattended.',
    content: html`<div class="prose">
        <p>
          While a job runs, a floating <strong>Live Motion</strong> bar holds Pause, Resume and
          <strong>ABORT JOB</strong>. ABORT JOB stays on screen, above any open dialog. During a
          Frame or a jog, the same button reads <strong>ABORT MOTION</strong>.
        </p>
        <ul>
          <li>
            <strong>Pause</strong> and <strong>Resume</strong> hold and continue the job. On Marlin
            and Smoothieware, Pause stops sending new moves, so moves already queued in the
            controller still finish.
          </li>
          <li>
            <strong>ABORT JOB</strong> is a software stop. It asks the controller to stop and reset,
            but it can’t confirm that the command arrived or that power actually stopped.
          </li>
          <li>
            ${keys('Ctrl', '.')} (${keys('Cmd', '.')} on a Mac) sends the same software Abort while
            the KerfDesk window is in focus, even with a dialog open or while you’re typing.
          </li>
        </ul>
      </div>
      ${callout({
        tone: 'safety',
        title: 'ABORT is a software stop, not an emergency stop',
        body: html`<p>
          Software commands can be lost. After a USB disconnect, a crash or a full controller
          buffer, the machine may keep moving after you click ABORT. In an emergency, use your
          machine’s physical E-stop or cut the power.
        </p>`,
      })}`,
  });
}

function cncSection() {
  return section({
    id: 'cnc',
    tone: 'alt',
    narrow: true,
    title: TITLES.cnc,
    lead: 'Using a router? Set your zero before you Frame, and expect a pause when a job changes bits.',
    content: html`<div class="prose">
        <p>
          CNC Frame lifts to safe Z, traces the job’s area in X and Y, and needs a Z zero set during
          this session. KerfDesk CNC jobs are written for GRBL-family controllers (GRBL, grblHAL or
          FluidNC). Marlin and Smoothieware can’t run them.
        </p>
      </div>
      ${featureGrid(CNC_EXTRAS, { columns: 3 })}
      ${callout({
        tone: 'safety',
        title: 'Air-cut your first CNC jobs',
        body: html`<p>
          The CNC side, touch-plate probing included, has software tests only and hasn’t cut on a
          real machine yet. Check the G-code in a separate viewer, run the job once with the bit
          clear of the material, and stay with the machine. Supervise your first probe with no
          cutting load.
        </p>`,
      })}`,
  });
}

function troubleshootingSection(site) {
  return section({
    id: 'troubleshooting',
    narrow: true,
    title: TITLES.troubleshooting,
    lead: 'If Connect doesn’t find your machine, most problems are one of these. Work through them in order.',
    content: html`${steps(CONNECT_FIXES)}
      <div class="prose">
        <h3>It connects but doesn’t respond</h3>
        <ul>
          <li>
            <strong>The machine is in an alarm state.</strong> Many controllers start locked after
            power-on. Home it if it has homing switches, or unlock it with <code>$X</code>, but only
            once you’ve checked the head is somewhere safe.
          </li>
          <li>
            <strong>Another program holds the port.</strong> Close any other laser or CNC software,
            or the Arduino IDE, then reconnect.
          </li>
          <li>
            <strong>The baud rate is wrong.</strong> Most GRBL machines use 115200. Set yours in the
            machine profile before you connect.
          </li>
        </ul>
        <p>
          The same steps are in the app under
          <strong>Help → Can’t connect? (Troubleshooting)</strong>. For driver details and more,
          read the <a href="${site.connectionGuideUrl}">full connection guide</a>.
        </p>
      </div>`,
  });
}

function helpSection(site) {
  return section({
    id: 'help',
    tone: 'alt',
    narrow: true,
    title: TITLES.help,
    content: html`<div class="prose">
      <h3>Learn inside the app</h3>
      <p>
        Click <strong>Learn</strong> in the top toolbar, or open
        <strong>Help → Visual tutorials…</strong>. Each lesson shows one step and one picture at a
        time. Reading a lesson never moves the machine or changes your project. The
        <strong>Keyboard Shortcuts</strong> button in the top toolbar lists every shortcut.
      </p>
      ${table({
        caption: 'Handy keys. On a Mac, use Cmd instead of Ctrl.',
        head: ['Keys', 'What it does'],
        rows: KEYS,
      })}

      <h3>Report a problem</h3>
      <p>
        Open an issue on <a href="${site.issuesUrl}">GitHub</a>. Say which machine, controller and
        firmware you use, and what you tried. Issues are public, so leave out anything private.
      </p>
      <p>
        For a connection problem, a diagnostic file helps. Under
        <strong>Read / Backup Controller Settings</strong>, choose
        <strong>Export machine diagnostic</strong>. It saves your machine profile, controller
        settings and recent serial log to a file on your computer. KerfDesk doesn’t upload it. It
        stays on your computer until you choose to share it.
      </p>

      <h3>Security and safety</h3>
      <p>
        Found a security problem? <a href="${site.securityReportUrl}">Report it privately</a>
        instead of opening a public issue. Before you run real jobs, read the
        <a href="/safety/">safety notes</a>. The app has a summary under
        <strong>Help → Safety &amp; liability</strong>.
      </p>
    </div>`,
  });
}

export const page = {
  path: '/docs/',
  nav: 'docs',
  title: 'Get started',
  description:
    'A step-by-step guide to your first KerfDesk job: set up your machine, add artwork, assign operations, preview, connect, Frame and start.',
  render: (ctx) =>
    html`${pageHero({
      eyebrow: 'Get started',
      title: 'Your first job, step by step',
      lead: 'This guide takes you from opening KerfDesk to watching your first job run. Take it one step at a time, and stay with your machine whenever it moves.',
    })}
    ${contentsSection()}
    ${section({
      id: 'need',
      tone: 'alt',
      narrow: true,
      title: TITLES.need,
      content: featureGrid(NEEDS, { columns: 2 }),
    })}
    ${section({
      id: 'design',
      narrow: true,
      title: TITLES.design,
      lead: 'Steps 1 to 5 need no machine. You can design, preview and save without connecting anything.',
      content: stepBlocks(DESIGN_STEPS, ctx),
    })}
    ${section({
      id: 'run',
      tone: 'alt',
      narrow: true,
      title: TITLES.run,
      lead: 'From here on, the machine moves. Stay with it, keep the work area clear, and keep its physical E-stop or power switch within reach.',
      content: stepBlocks(RUN_STEPS, ctx),
    })}
    ${runningSection()} ${cncSection()} ${troubleshootingSection(ctx.site)} ${helpSection(ctx.site)}
    ${ctaBand({
      title: 'Ready for your first project?',
      body: 'KerfDesk runs in your browser. There’s nothing to install and no account to create.',
      buttons: [
        button(ctx.site.appUrl, 'Open KerfDesk'),
        button('/machines/', 'Check your machine', { variant: 'ghost-dark' }),
      ],
    })}`,
};
