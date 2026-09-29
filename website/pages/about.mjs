// About page: who makes KerfDesk, what it is for, the principles behind it and
// how it is built. Card and table copy lives in about-data.mjs. The Falcon
// "hardware-verified" claim is deliberately absent: PROJECT.md's 2026-09-19
// qualification note (ADR-322) withdrew it, so the Falcon is named only as a
// machine jobs were sent to in informal runs. No competitor is named (ADR-120).
// Licensing follows the owner's settled Free and Pro offer (commerce.config.mjs,
// ADR-524 Amendment 1). The page doesn't promote open-source terms, and nothing
// links to GitHub: the source repository is private, so bug and security reports
// go to the support page.

import {
  button,
  callout,
  ctaBand,
  featureGrid,
  pageHero,
  section,
  split,
  statusPill,
  table,
} from '../lib/components.mjs';
import { html } from '../lib/html.mjs';
import { shot } from '../lib/screens.mjs';
import { LABELS, MADE, principles, reportLinks } from './about-data.mjs';

function purpose(ctx) {
  return section({
    eyebrow: 'What it is for',
    title: 'Software for the machine in your workshop',
    content: html`${split({
        title: 'Design, preview and send, in one app',
        body: 'KerfDesk is for people who run their own GRBL-based laser or CNC router. Import or draw artwork, give each part a named cut, fill, engrave or carve operation, preview the toolpath, then send the G-code over USB.',
        points: [
          'Laser and router work in one app, with the same design tools for both',
          'Deliberately focused: it doesn’t try to do everything or drive every kind of controller',
          'Runs in Chrome, Edge and other Chromium browsers, with desktop Previews for Windows and macOS',
        ],
        media: shot(ctx, 'workspace'),
      })}
      <p><a href="/machines/">See how each machine and controller has been tested →</a></p>`,
  });
}

function frameFirst() {
  return section({
    id: 'frame-first',
    narrow: true,
    eyebrow: 'Principle',
    title: 'Why every start begins with a Frame',
    content: html`<div class="prose">
        <p>
          For a normal start, KerfDesk asks you to run a Frame first. With the laser or spindle off,
          the machine traces a rectangle around the exact job over your material, so you can see
          where it will land. On a router it lifts to a safe height first.
        </p>
        <p>
          A Frame that finishes cleanly unlocks Start for that one job. A cancelled or interrupted
          Frame doesn’t. Change the artwork, the output or the placement, or jog, home or reset the
          origin, and you Frame again.
        </p>
        <p>
          Everything else informs rather than blocks. A design running past the bed edge, a no-go
          zone or a controller setting shows up as a warning in Job Review for you to read and
          decide on. Apart from the Frame, only facts stop a start: the machine isn’t connected or
          ready, the program can’t be built, or it changed after you reviewed it.
        </p>
        <p>
          Why this way? KerfDesk treats the Frame you watch over the real material as the source of
          truth for where a job goes. It trusts you, the person at the machine, with the rest.
        </p>
      </div>
      ${callout({
        tone: 'safety',
        title: 'Frame is a check you watch, not a safety device',
        body: html`<p>
          It shows where a job will run, not how it will turn out. Stay with the machine while it
          works. The Abort button in KerfDesk is a software stop, not an emergency stop. In an
          emergency, use your machine’s physical E-stop or cut the power.
          <a href="/safety/">Read the safety notes</a>.
        </p>`,
      })}`,
  });
}

function labels() {
  return section({
    id: 'labels',
    tone: 'alt',
    narrow: true,
    eyebrow: 'Principle',
    title: 'The labels you’ll see',
    lead: 'Each label says how something has actually been checked, so you know what to double-check yourself.',
    content: html`${table({
      caption: 'What each status label means',
      head: ['Label', 'What it means'],
      rows: LABELS.map(([status, meaning]) => [statusPill(status), meaning]),
    })}
    ${callout({
      title: 'Where things stand today',
      body: html`<p>
          Jobs have been sent to a Creality Falcon A1 Pro in informal runs, not a repeatable test,
          so no machine is listed as verified. No stock GRBL 1.1 board has been tested on hardware.
          FluidNC, Marlin and Smoothieware have been tested only against simulators.
        </p>
        <p>
          Image engraving, the whole CNC side, rotary output and box-generator fit are built and
          tested in software but haven’t run on a machine. Ruida export passes a software round
          trip, but no real Ruida controller has accepted a file yet. KerfDesk has never been proven
          on hardware for the quality of finished work.
        </p>
        <p>
          The app is labeled too. Each built-in machine profile shows how well it has been checked,
          with tags such as “Public-spec starter”, “Simulator tested” or “Experimental”. No built-in
          profile carries the “Hardware verified” tag today.
          <a href="/machines/">See the machines page</a> for details.
        </p>`,
    })}`,
  });
}

function made() {
  return section({
    id: 'how-it-is-made',
    eyebrow: 'How it is made',
    title: 'Built to keep a fix in one place',
    lead: 'The current code is a clean rewrite. The first version worked, but a fix in one part could break another, so this one was designed from day one to keep changes contained.',
    content: html`${featureGrid(MADE, { columns: 2 })}
    ${callout({
      title: 'Tests prove structure, not what comes off the machine',
      body: html`<p>
        The automated tests check structure and repeatability: the same design and settings give
        byte-identical G-code, and rules such as laser-off on travel moves are checked on the final
        output. They can’t show that a fill, an engraving or a V-carve will look like your design.
        Output can be wrong and still pass every test. The project has no machine to test on right
        now, so treat anything labeled “Built, not yet machine-tested” as unproven. Check each job
        in the preview, Frame it, and stay with the machine.
      </p>`,
    })}`,
  });
}

function maker(site) {
  return section({
    tone: 'alt',
    narrow: true,
    eyebrow: 'Who makes it',
    title: `Made by ${site.studio}`,
    content: html`<div class="prose">
      <p>The app’s startup screen reads “Created by ${site.studio}”.</p>
      <p>
        KerfDesk comes in a Free edition with no time limit and a Pro edition with a one-time
        license. Purchase opens soon. <a href="${site.pricingUrl}">See pricing</a>.
      </p>
      <h3>Why the code still says LaserForge</h3>
      <p>
        The product is KerfDesk. Inside its code, the project still goes by its earlier name,
        LaserForge 2.0. You’ll see “laserforge” in the package name and in the desktop app’s ID.
      </p>
      <p>
        That is historical, and it stays on purpose. Renaming those identifiers would break the
        desktop app’s release identity and the on-disk location of your saved data.
      </p>
    </div>`,
  });
}

function reporting(site) {
  return section({
    id: 'report',
    eyebrow: 'Report a problem',
    title: 'Found a bug or a security issue?',
    lead: `Email bug reports and security reports to ${site.supportEmail}. The KerfDesk support page lists what to include.`,
    content: html`${featureGrid(reportLinks(site), { columns: 2 })}
    ${callout({
      tone: 'safety',
      title: 'Testing a suspected machine-control bug',
      body: html`<p>
        Don’t test it on a powered laser or spindle unless someone is supervising, the work area is
        clear and an independent stop is within reach. Tests that cut the USB link or controller
        power must run with the laser output physically disabled.
      </p>`,
    })}`,
  });
}

export const page = {
  path: '/about/',
  nav: null,
  title: 'About',
  description:
    'Who makes KerfDesk, what it is for, the principles behind it and how it is built, plus where to report problems.',
  render: (ctx) =>
    html`${pageHero({
      eyebrow: 'About',
      title: 'Focused software for lasers and CNC routers',
      lead: 'KerfDesk is software for GRBL lasers and CNC routers, in a Free and a Pro edition, with no account or subscription. Here is what it’s for, the principles behind it, how it’s built and who makes it.',
    })}
    ${purpose(ctx)}
    ${section({
      tone: 'alt',
      eyebrow: 'Principles',
      title: 'What KerfDesk holds to',
      lead: 'Four ideas shape how KerfDesk works and how this site talks about it.',
      content: featureGrid(principles(ctx.site), { columns: 4 }),
    })}
    ${frameFirst()} ${labels()} ${made()} ${maker(ctx.site)} ${reporting(ctx.site)}
    ${ctaBand({
      title: 'Try KerfDesk',
      body: 'It runs in Chrome, Edge and other Chromium browsers. KerfDesk Free needs no account.',
      buttons: [
        button(ctx.site.appUrl, 'Open KerfDesk'),
        button('/machines/', 'Check your machine', { variant: 'ghost-dark' }),
      ],
    })}`,
};
