// Features: what KerfDesk does, grouped by task, with a file-format table.
// Copy lives in features-data.mjs with its evidence notes. Machine-dependent
// results carry a status pill; laser and CNC detail lives on /laser/ and /cnc/.
// Tools the owner listed as Pro (commerce.config.mjs) carry a Pro pill; nothing
// else is marked, so the page never guesses which edition an unlisted tool is in.

import {
  actions,
  button,
  callout,
  ctaBand,
  featureGrid,
  pageHero,
  proPill,
  section,
  split,
  statusPill,
  table,
} from '../lib/components.mjs';
import { html } from '../lib/html.mjs';
import { shot } from '../lib/screens.mjs';
import { site } from '../site.config.mjs';
import {
  CAMERA,
  DESIGN_POINTS,
  FILE_ROWS,
  GENERATORS,
  IMAGES,
  MACHINE_TYPES,
  OVERVIEW,
  PREVIEW_POINTS,
  TEXT,
} from './features-data.mjs';

function overview() {
  return section({
    eyebrow: 'Overview',
    title: 'Find what you need',
    lead: html`Jump to a group below, or see
      <a href="#files">which files KerfDesk opens and saves</a>. Labels mark tools that are still
      being built, and results that haven’t been checked on a real machine yet.`,
    content: html`<ul class="legend">
        <li>
          ${statusPill('shipped-code-and-tests')} Built and tested in software, not yet run on a
          machine
        </li>
        <li>${statusPill('in-progress')} Part of it works today, and more is being built</li>
        <li>
          ${proPill()} Part of the Pro edition.
          <a href="${site.pricingUrl}">Compare Free and Pro</a>
        </li>
      </ul>
      ${featureGrid(OVERVIEW)}`,
  });
}

function design(ctx) {
  return section({
    id: 'design',
    tone: 'alt',
    eyebrow: 'Design and drawing',
    title: 'Draw and shape your artwork',
    content: split({
      title: 'Shapes, paths and operations',
      body: 'Draw on the canvas or bring in your own files. Then link each piece of artwork to a named operation, not to a color, and set the order the machine runs them in.',
      points: DESIGN_POINTS,
      media: shot(ctx, 'workspace'),
    }),
  });
}

function preview(ctx) {
  return section({
    id: 'preview',
    tone: 'alt',
    eyebrow: 'Preview and G-code Inspector',
    title: 'See the program before your machine moves',
    content: html`${split({
      title: 'Preview, then inspect',
      body: html`Press <kbd>P</kbd> to preview the exact toolpath your machine will run. With Pro,
        open the G-code Inspector: a 3D viewer with playback that shows which line of the program
        made each move. ${proPill()}`,
      points: PREVIEW_POINTS,
      media: shot(ctx, 'gcode3d', {
        caption: 'The canvas switched to G-code 3D, with playback controls below the view.',
      }),
      reverse: true,
    })}
    ${callout({
      title: 'A guide, not a guarantee',
      body: html`<p>
        The job time is an estimate from a GRBL-style motion model that allows for acceleration and
        cornering. It hasn’t been compared with real run times. Preview and the Inspector show the
        moves in the program. They can’t show how the result will look on your material, and they
        don’t replace framing the job on your machine.
      </p>`,
    })}`,
  });
}

function files() {
  return section({
    id: 'files',
    tone: 'alt',
    eyebrow: 'Files',
    title: 'What KerfDesk opens and saves',
    lead: 'Your project saves as a single .lf2 file on your computer. Here are the other main file types KerfDesk can read and write.',
    content: html`${table({
        caption: 'File types KerfDesk opens and saves',
        head: ['File', 'KerfDesk can', 'Notes'],
        rows: FILE_ROWS,
      })}
      ${callout({
        title: 'LightBurn files go one way',
        body: html`<p>
          KerfDesk reads LightBurn projects, cut libraries and device files. It never writes
          LightBurn files.
        </p>`,
      })}
      <div class="prose">
        <p>
          KerfDesk doesn’t open .ai, PDF, EPS, .cdr, Gerber, OBJ or 3MF files, or LightBurn .lbzip
          bundles.
        </p>
      </div>`,
  });
}

function machineTypes() {
  return section({
    eyebrow: 'Laser and CNC',
    title: 'Tools for your kind of machine',
    lead: html`Operations, cut settings and machine tools have their own pages. To see what has been
      checked on real hardware, visit <a href="/machines/">Machines</a>.`,
    content: html`${featureGrid(MACHINE_TYPES, { columns: 2 })}
    ${callout({
      tone: 'safety',
      title: 'Check every job before you run it',
      body: html`<p>
        KerfDesk’s previews and checks help, but they can’t guarantee a safe or correct result. Look
        over the output, do an air run when you can, and stay with the machine.
        <a href="/safety/">Read the safety notes</a>.
      </p>`,
    })}`,
  });
}

export const page = {
  path: '/features/',
  nav: 'features',
  title: 'Features',
  description:
    'What KerfDesk can do: drawing and booleans, text and fonts, image tracing, box and test generators, G-code preview, camera alignment and file formats.',
  render: (ctx) =>
    html`${pageHero({
      eyebrow: 'Features',
      title: 'What KerfDesk can do',
      lead: 'Draw, type, trace and generate your artwork, then check the exact program before your machine moves. It’s one app for your laser and your CNC router.',
      extra: actions(
        button('/laser/', 'Laser features', { iconName: 'zap' }),
        button('/cnc/', 'CNC features', { variant: 'secondary', iconName: 'drill' }),
      ),
    })}
    ${overview()} ${design(ctx)}
    ${section({
      id: 'text',
      eyebrow: 'Text and fonts',
      title: 'Type right on the canvas',
      lead: 'Pick a bundled font or add your own, then fill in names and numbers automatically for runs of tags and labels.',
      content: featureGrid(TEXT, { columns: 2 }),
    })}
    ${section({
      id: 'images',
      tone: 'alt',
      eyebrow: 'Images and tracing',
      title: 'Turn pictures into paths or engravings',
      lead: 'Import PNG and JPG images to trace into vectors or, on a laser, to engrave. Basic tracing is part of Free, and advanced tracing is part of Pro.',
      content: featureGrid(IMAGES),
    })}
    ${section({
      id: 'generators',
      eyebrow: 'Generators and layout',
      title: 'Let KerfDesk do the setup work',
      lead: 'Generate boxes and test patterns, arrange parts on your material, and keep the settings that worked.',
      content: featureGrid(GENERATORS),
    })}
    ${preview(ctx)}
    ${section({
      id: 'camera',
      eyebrow: 'Camera alignment',
      title: 'Place artwork over your material',
      lead: 'Use a camera to see your material on the canvas and position your design on it. Camera alignment is part of Pro.',
      content: featureGrid(CAMERA),
    })}
    ${files()} ${machineTypes()}
    ${ctaBand({
      title: 'Try it on your next project',
      body: 'KerfDesk Free needs no account and runs in Chrome, Edge and other Chromium browsers.',
      buttons: [
        button(ctx.site.appUrl, 'Open KerfDesk'),
        button('/download/', 'Desktop app', { variant: 'ghost-dark' }),
      ],
    })}`,
};
