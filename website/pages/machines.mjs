// Machines and compatibility. Evidence labels follow the newest record on main:
// PROJECT.md (Phase I "Qualification") and ADR-322 say no machine has
// repeatable physical qualification, so the strongest label here is informal
// use on a real machine. Copy and data live in machines-data.mjs.

import {
  actions,
  button,
  callout,
  ctaBand,
  faqList,
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
  CAMERAS,
  CHECKLIST,
  CONNECT_NEEDS,
  CONTROLLERS,
  FAQ,
  LASER_POINTS,
  NOT_YET_ON_A_MACHINE,
  REPORT_ITEMS,
  ROUTER_POINTS,
} from './machines-data.mjs';

function legend() {
  return html`<ul class="legend">
    <li>
      ${statusPill('hardware-verified')} Informal runs on a real machine, not a repeatable test.
    </li>
    <li>${statusPill('simulator-only')} Tested against a scripted firmware simulator.</li>
    <li>
      ${statusPill('shipped-code-and-tests')} Built and covered by automated tests, not yet run on a
      machine.
    </li>
  </ul>`;
}

function controllersSection() {
  return section({
    id: 'controllers',
    eyebrow: 'Controllers',
    title: 'Six controller families',
    lead: 'KerfDesk has drivers for six controller families and adjusts its controls to what each firmware can do. How far each one has been tested varies a lot.',
    content: html`${legend()}
      ${table({
        caption: 'Controller families KerfDesk has drivers for',
        head: ['Controller', 'How it connects', 'What has been tested', 'Status'],
        rows: CONTROLLERS.map((row) => [
          row.family,
          row.connection,
          row.tested,
          statusPill(row.status),
        ]),
      })}
      <div class="prose">
        <p>
          The simulators run the real app against scripted firmware over a fake serial port. They
          can’t show real timing, electrical behavior or firmware quirks.
        </p>
        <p>
          When you connect, KerfDesk recognizes GRBL, grblHAL, FluidNC, Marlin and Smoothieware from
          the controller’s startup message. If your profile is for a different family, you get a
          warning in Machine Setup and again in Job Review. It’s a warning, not a block: you decide.
        </p>
        <p>
          On Marlin and Smoothieware, Pause holds back new moves, so moves already queued in the
          controller still finish. Trocen, TopWisdom and galvo controllers aren’t supported.
        </p>
      </div>
      ${callout({
        title: 'Real machines so far',
        body: html`<p>
          KerfDesk has been used to run jobs on two machines so far: a Creality Falcon A1 Pro diode
          laser and a Neotronics 4040-class laser. These were informal runs, not recorded,
          repeatable tests, so no machine is formally qualified yet. On the 4040, some text and fill
          burns came out uneven. The changes made since still need a check on that machine.
        </p>`,
      })}`,
  });
}

function connectSection(site) {
  return section({
    id: 'connect',
    tone: 'alt',
    eyebrow: 'Connecting',
    title: 'What you need to connect',
    content: html`${featureGrid(CONNECT_NEEDS, { columns: 2 })}
    ${callout({
      title: 'Firefox and Safari can’t connect',
      body: html`<p>
          They don’t have Web Serial, so they can’t reach a machine, and KerfDesk’s Open and Save
          don’t work in them either. If your browser can’t connect, KerfDesk turns off the Connect
          button and names browsers that can.
        </p>
        <p>
          Stuck on a connection? The <a href="${site.connectionGuideUrl}">connection guide</a>
          walks through cables, drivers, ports and alarm states.
        </p>`,
    })}`,
  });
}

function ownersSection(ctx) {
  return section({
    id: 'owners',
    eyebrow: 'Profiles and presets',
    title: 'Laser and router owners',
    lead: 'KerfDesk ships 18 built-in device profiles, including generic templates for each controller family, and nine CNC size presets. They are starting points, not proof that a machine works with KerfDesk.',
    content: html`${split({
      title: 'If you own a laser',
      body: 'KerfDesk is built for GRBL-based diode and CO₂ lasers, for example GRBL models from xTool, Sculpfun, Ortur, Atomstack, NEJE or OpenBuilds, and FluidNC conversions. Not every model from these brands runs GRBL, so check yours first. Named profiles come from public specifications and manufacturer data checked on September 19, 2026.',
      points: LASER_POINTS,
      media: shot(ctx, 'workspace'),
    })}
    ${split({
      title: 'If you own a CNC router',
      body: 'KerfDesk’s CNC jobs are written for GRBL-family controllers: GRBL, grblHAL or FluidNC. Marlin and Smoothieware can’t run them. No router has cut a job with KerfDesk yet.',
      points: ROUTER_POINTS,
      media: shot(ctx, 'cnc'),
      reverse: true,
    })}`,
  });
}

function notYetSection() {
  return section({
    tone: 'alt',
    eyebrow: 'Honest status',
    title: 'Built, but not yet run on a machine',
    lead: 'These features are covered by code and automated tests only. Tests check structure and repeatability, not whether a result looks right on material.',
    content: featureGrid(NOT_YET_ON_A_MACHINE, { columns: 4 }),
  });
}

function camerasSection() {
  return section({
    id: 'cameras',
    eyebrow: 'Cameras',
    title: 'Which cameras work where',
    lead: 'A camera over the bed helps you place artwork on your material. Which cameras you can use depends on where you run KerfDesk.',
    content: html`${table({
        caption: 'Camera types and where they work',
        head: ['Camera', 'Where it works', 'Notes', 'Status'],
        rows: CAMERAS.map((row) => [row.kind, row.where, row.notes, statusPill(row.status)]),
      })}
      <div class="prose">
        <p>
          Camera tools include lens calibration and bed alignment. Their accuracy hasn’t been
          measured on a real machine. Automatic camera-to-bed alignment is an experiment: KerfDesk
          burns a marker target and finds it with the camera. It stays off until you turn it on in
          Tools &gt; Labs. In the desktop app, the network camera view also offers a manual
          four-corner bed alignment.
        </p>
        <p>
          The Mac Preview is built for USB cameras and network JPEG cameras, but that hasn’t been
          tested on real Macs yet. RTSP streams on a Mac rely on ffmpeg, which the app may not find
          even when it’s installed. On a Mac, you may be asked for camera and local-network
          permission again after you install a newer Preview.
        </p>
      </div>`,
  });
}

function checklistSection() {
  return section({
    id: 'checklist',
    tone: 'alt',
    eyebrow: 'Before you start',
    title: 'Will it work with my machine?',
    lead: 'Work through these six checks. You can also design, preview and save G-code without connecting anything, so you can look at the output first.',
    content: steps(CHECKLIST),
  });
}

function verifySection(site) {
  return section({
    id: 'help-verify',
    narrow: true,
    eyebrow: 'Share your results',
    title: 'Tell us how it runs on your machine',
    lead: 'Reports from real machines help show where KerfDesk works and where it doesn’t. If you try it on yours, open an issue on GitHub.',
    content: html`<div class="prose">
        <p>Helpful things to include:</p>
        <ul>
          ${REPORT_ITEMS.map((item) => html`<li>${item}</li>`)}
        </ul>
        <p>
          KerfDesk can also save a diagnostic file with your machine profile, controller settings
          and recent serial log (Read / Backup Controller Settings, then Export machine diagnostic).
          It stays on your computer until you choose to share it.
        </p>
        <p>
          GitHub issues are public. Leave out personal details, and look through any file or photo
          before you attach it. Found a security problem? Please
          <a href="${site.securityReportUrl}">report it privately</a> instead.
        </p>
      </div>
      ${actions(
        button(site.issuesUrl, 'Open a GitHub issue', { iconName: 'message-square' }),
        button('/safety/', 'Read the safety notes', { variant: 'secondary' }),
      )}
      ${callout({
        tone: 'safety',
        title: 'Testing on a real machine',
        body: html`<p>
          Stay with the machine, keep the work area clear and keep a fire extinguisher close.
          KerfDesk’s Abort is a software stop, not an emergency stop. Commands can be lost, so keep
          your machine’s physical E-stop or power switch within reach.
        </p>`,
      })}`,
  });
}

export const page = {
  path: '/machines/',
  nav: 'machines',
  title: 'Machines',
  description:
    'Which controllers KerfDesk can drive, how each one connects and how far each has been tested, plus what you need to connect and how to report results.',
  render: (ctx) =>
    html`${pageHero({
      eyebrow: 'Machines',
      title: 'Machines and compatibility',
      lead: 'KerfDesk connects to GRBL-family controllers over USB and has drivers for a few others. This page shows how far each one has been tested, so you know what to check yourself.',
    })}
    ${controllersSection()} ${connectSection(ctx.site)} ${ownersSection(ctx)} ${notYetSection()}
    ${camerasSection()} ${checklistSection()} ${verifySection(ctx.site)}
    ${section({
      tone: 'alt',
      narrow: true,
      eyebrow: 'Questions',
      title: 'About machines',
      content: faqList(FAQ),
    })}
    ${ctaBand({
      title: 'Try it with your machine',
      body: 'Open KerfDesk in Chrome or Edge, set up your machine and preview a job before anything moves.',
      buttons: [
        button(ctx.site.appUrl, 'Open KerfDesk'),
        button('/docs/', 'Get started', { variant: 'ghost-dark' }),
      ],
    })}`,
};
