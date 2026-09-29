// CNC router page. README.md:29 on main: "The entire CNC / router surface:
// code + tests only; never cut on a machine" — so this page leads with that
// status, repeats it beside each feature group, and never names a router as
// compatible (brands appear only as "if you own…" presets, per
// src/core/cnc/cnc-machine-catalog.ts). Copy lives in cnc-data.mjs.

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
  BIG_JOBS,
  CNC_FAQ,
  CUT_TYPES,
  ENTRY_TABLE,
  FIRST_CUT_STEPS,
  POCKET_STRATEGIES,
  TOOLING,
} from './cnc-data.mjs';

function statusNote(text) {
  return html`<ul class="legend">
    <li>${statusPill('shipped-code-and-tests')} ${text}</li>
  </ul>`;
}

function statusSection() {
  return section({
    id: 'status',
    narrow: true,
    content: callout({
      tone: 'safety',
      title: 'Tested in software. Not yet cut on a machine.',
      body: html`<p>${statusPill('shipped-code-and-tests')}</p>
        <p>
          The CNC features on this page are covered by automated tests. None of them has cut
          material on a real router yet, and that includes touch-plate probing. The tests check the
          structure of the G-code. They can’t tell you whether a carve will look right.
        </p>
        <p>
          Before you cut, open the program in a separate G-code viewer, run an air cut with the bit
          clear of the material, and stay with the machine.
        </p>`,
    }),
  });
}

function previewSection(ctx) {
  return section({
    tone: 'alt',
    content: split({
      title: 'See the cut before you make it',
      body: 'Press P to preview a CNC job. KerfDesk shades your stock by depth to show the material the program removes. Drag the scrubber to step through the cut, then open the 3D view to see the simulated result at that point.',
      points: [
        'Toolpath and travel moves drawn over your stock',
        'Step from one pass to the next with the scrubber',
        'A simulation of the program, not proof of the finished part',
      ],
      media: shot(ctx, 'cnc', {
        caption: 'KerfDesk in CNC mode. This is the app on screen, not a photo of a cut part.',
      }),
    }),
  });
}

function cutOrderSection() {
  return section({
    tone: 'alt',
    narrow: true,
    eyebrow: 'Cut order',
    title: 'The part is finished before it is cut free',
    content: html`<div class="prose">
      <p>
        KerfDesk orders a CNC job around the part. Pockets, engraves and other clearing cuts run
        first. Profiles, the cuts that can free a part, run last. On each part, the inside contours
        are cut before the outside contour that holds them. In a job with more than one bit, every
        clearing step finishes before any profile starts.
      </p>
      <p>
        The reason is simple: cutting a hole in a part that is already loose means machining
        something that can move. This is how KerfDesk writes the program. It hasn’t been proven on a
        machine, so still clamp your work and use tabs on through-cuts.
      </p>
    </div>`,
  });
}

function routerSection() {
  return section({
    tone: 'alt',
    narrow: true,
    eyebrow: 'Your machine',
    title: 'If you own a router',
    content: html`<div class="prose">
      <p>
        KerfDesk writes CNC jobs for GRBL-family controllers: GRBL, grblHAL or FluidNC. Marlin and
        Smoothieware can’t run KerfDesk CNC jobs. No router has run a KerfDesk CNC job on any of
        these controllers yet, and FluidNC support as a whole has only been tested against a
        simulator.
      </p>
      <p>
        If you own a Genmitsu 3018-PRO or 4040-PRO, a Shapeoko 3 or 3 XXL, an X-Carve 1000 mm, a
        Sienci LongMill MK2 30×30, a Neotronics 4040 Max, or a Onefinity Woodworker or Journeyman,
        there is a size preset to start from. A preset sets only the work area and a spindle-speed
        limit. It doesn’t choose your controller, and it isn’t a sign that the machine has been
        tested. Onefinity’s own controllers aren’t supported, so those presets cover size only.
      </p>
      <p><a href="/machines/">See what has and hasn’t been tested on the machines page →</a></p>
    </div>`,
  });
}

function safetySection() {
  return section({
    narrow: true,
    content: callout({
      tone: 'safety',
      title: 'A router can throw a loose part and catch clothing',
      body: html`<p>
        Clamp your workpiece securely. Wear safety glasses, hearing protection and a dust mask, and
        keep loose clothing, gloves and hair away from the spinning bit. Keep your hands clear until
        the spindle stops. The Abort button in KerfDesk is a software stop, not an emergency stop.
        Keep your machine’s physical E-stop or power switch within reach.
        <a href="/safety/">Read the safety notes</a>.
      </p>`,
    }),
  });
}

export const page = {
  path: '/cnc/',
  nav: 'features',
  title: 'CNC routers',
  description:
    'KerfDesk CNC mode: eight cut types, pocket clearing, V-carving, inlays, STL reliefs, probing and a 3D cut preview. Tested in software, not yet on a router.',
  render: (ctx) =>
    html`${pageHero({
      eyebrow: 'CNC router mode',
      title: 'Plan carves, pockets and cuts for your router',
      lead: 'KerfDesk has a CNC mode for GRBL-family routers. Give each part of your design a cut type, choose depths and bits, and preview a simulation of the material coming away. It is tested in software only. None of it has cut on a real machine yet.',
      extra: actions(
        button(ctx.site.appUrl, 'Open KerfDesk', { iconName: 'arrow-right' }),
        button('#status', 'What has been tested', { variant: 'secondary' }),
      ),
    })}
    ${statusSection()}
    ${section({
      tone: 'alt',
      eyebrow: 'Operations',
      title: 'Eight cut types',
      lead: 'Draw or import a shape, pick how it is machined, then set the depth and the bit. Each operation gets one of these cut types.',
      content: html`${statusNote('All eight cut types: code and automated tests only.')}
      ${featureGrid(CUT_TYPES, { columns: 4 })}`,
    })}
    ${section({
      eyebrow: 'Pockets',
      title: 'Clear pockets your way',
      lead: 'Choose how the bit clears each pocket, and split the work between two bits when you need to.',
      content: html`${statusNote('Pocket clearing has not been run on a machine yet.')}
      ${featureGrid(POCKET_STRATEGIES, { columns: 4 })}`,
    })}
    ${previewSection(ctx)}
    ${section({
      eyebrow: 'Entry, exit and tabs',
      title: 'Control how the bit meets the material',
      lead: 'Set these for each operation.',
      content: html`${statusNote(
        'These settings shape the G-code. They haven’t been checked on a machine.',
      )}
      ${table(ENTRY_TABLE)}`,
    })}
    ${cutOrderSection()}
    ${section({
      eyebrow: 'Beyond flat cuts',
      title: 'Reliefs, big jobs and your spoilboard',
      content: featureGrid(BIG_JOBS, { columns: 4 }),
    })}
    ${section({
      tone: 'alt',
      eyebrow: 'Setup',
      title: 'Bits, feeds and zero',
      content: featureGrid(TOOLING, { columns: 4 }),
    })}
    ${section({
      eyebrow: 'Your first cut',
      title: 'Before you cut material',
      lead: 'Take these steps in order, especially on your first jobs.',
      content: steps(FIRST_CUT_STEPS),
    })}
    ${routerSection()} ${safetySection()}
    ${section({
      tone: 'alt',
      narrow: true,
      eyebrow: 'Questions',
      title: 'About CNC mode',
      content: faqList(CNC_FAQ),
    })}
    ${ctaBand({
      title: 'Try CNC mode',
      body: 'KerfDesk is free to use today and needs no account. Design and preview a carve without connecting a machine.',
      buttons: [
        button(ctx.site.appUrl, 'Open KerfDesk'),
        button('/machines/', 'Check your machine', { variant: 'ghost-dark' }),
      ],
    })}`,
};
