// Home page. Every claim here is grounded in the citation-checked site facts
// (README.md, PROJECT.md, WORKFLOW.md and source on main); evidence labels come
// from lib/components.mjs STATUS so "built" never reads as "proven".

import {
  actions,
  button,
  callout,
  ctaBand,
  featureGrid,
  proPill,
  section,
  split,
  statusPill,
  steps,
} from '../lib/components.mjs';
import { formatPrice } from '../lib/commerce.mjs';
import { html } from '../lib/html.mjs';
import { shot } from '../lib/screens.mjs';

function hero(ctx) {
  const { site } = ctx;
  return html`<section class="hero">
    <img
      class="hero__art"
      src="${ctx.asset('brand/startup-craft.webp')}"
      alt=""
      width="1672"
      height="941"
      fetchpriority="high"
    />
    <div class="wrap hero__inner">
      <div class="hero__copy">
        <p class="eyebrow">Laser &amp; CNC software</p>
        <h1>Design it. Check it.<br />Then run it.</h1>
        <p class="lead">
          KerfDesk is software for GRBL-family lasers and CNC routers, in a Free and a Pro edition.
          Import or draw your artwork, give each part an operation, preview the toolpath, then Frame
          the job and send it over USB, right from your browser.
        </p>
        ${actions(
          button(site.appUrl, 'Open KerfDesk in your browser', { iconName: 'arrow-right' }),
          button('/download/', 'Get the desktop app', { variant: 'ghost-dark' }),
        )}
        <p class="hero__note">
          Free edition · No account · Chrome, Edge, Brave or Arc ·
          <a href="/machines/">See what has been tested</a>
        </p>
      </div>
      <div class="hero__shot">${shot(ctx, 'workspace', { eager: true })}</div>
    </div>
  </section>`;
}

const PILLARS = [
  {
    icon: 'pen-tool',
    title: 'Design',
    body: 'Import SVG, DXF and images, or draw with shapes, pen and text. Trace a logo or combine shapes with Weld or Subtract. Pro adds the box generator and Design Studio.',
    href: '/features/',
  },
  {
    icon: 'zap',
    title: 'Engrave and cut',
    body: 'Line, Fill and Image modes, with cross-hatch fills, kerf compensation, holding tabs and 11 dither and grayscale options for photos. Image engraving hasn’t been run on a machine yet.',
    href: '/laser/',
  },
  {
    icon: 'drill',
    title: 'Carve',
    body: 'Profile, pocket, inlay and drill cuts for CNC routers, with touch-plate probing and a tool library. Pro adds V-carving, adaptive clearing and 3D reliefs from STL.',
    href: '/cnc/',
    status: 'shipped-code-and-tests',
  },
];

const HOW = [
  {
    title: 'Bring in your design',
    body: 'Import SVG, DXF or images, open LightBurn .lbrn2 project files, or draw and type right on the canvas.',
  },
  {
    title: 'Choose what happens',
    body: 'Give each part a named operation, like a laser line, fill or image, or a CNC profile, pocket or V-carve. Then set its power and speed, or its depth and feeds.',
  },
  {
    title: 'Preview the job',
    body: 'Press P to see the cut paths and travel moves, and play the route back before anything moves.',
  },
  {
    title: 'Frame it on your material',
    body: 'Connect over USB and run Frame. With the tool off, the head moves around the area the job will cover, so you can see where it lands.',
  },
  {
    title: 'Review and start',
    body: 'Job Review shows the time estimate and any warnings, which inform you but don’t block the job. Start unlocks once a Frame of that exact job has finished.',
  },
];

function promises(site, commerce) {
  const [plan] = commerce.plans;
  return [
    {
      icon: 'user-x',
      title: 'No account',
      body: 'Open it and start working. There’s no sign-up, sign-in or subscription.',
    },
    {
      icon: 'wifi-off',
      title: 'Works offline',
      body: 'Load it once and install it from your browser. After that, it keeps working without an internet connection.',
    },
    {
      icon: 'eye-off',
      title: 'No tracking',
      body: 'No analytics, no error reporting and no cloud sync. Your projects, machine details and jobs stay on your computer.',
    },
    {
      icon: 'tag',
      title: 'Free, with Pro when you need it',
      body: plan
        ? `KerfDesk Free has no time limit. ${plan.name} adds advanced tools${plan.where ? ` to ${plan.where}` : ''} for ${formatPrice(plan.price, commerce.currency)} plus tax, paid once, and each device can try it free for ${plan.trialDays} days.`
        : 'KerfDesk Free has no time limit.',
      href: site.pricingUrl,
    },
  ];
}

function proofSection() {
  return section({
    eyebrow: 'Honest status',
    title: 'We tell you what has — and hasn’t — been tested',
    lead: 'We label how each part of KerfDesk has been checked, so you know what to double-check yourself. No machine has been formally qualified yet.',
    content: html`<ul class="legend">
        <li>${statusPill('hardware-verified')} Informal runs on a real machine</li>
        <li>${statusPill('simulator-only')} Tested against a firmware simulator</li>
        <li>${statusPill('shipped-code-and-tests')} Code and automated tests only</li>
      </ul>
      ${featureGrid(
        [
          {
            icon: 'usb',
            title: 'Sending jobs over USB',
            body: 'KerfDesk has been used to send jobs to a Creality Falcon A1 Pro. Those were informal runs that covered sending, not the quality of the result. No stock GRBL 1.1 board has been tested yet.',
            status: 'hardware-verified',
          },
          {
            icon: 'server',
            title: 'FluidNC, Marlin and Smoothieware',
            body: 'Connecting and streaming have been tested against scripted firmware simulators only, not on a real controller.',
            status: 'simulator-only',
          },
          {
            icon: 'layers',
            title: 'Image engraving and CNC carving',
            body: 'Built and covered by automated tests, but not yet run on a machine. Box fit and rotary output are at the same stage.',
            status: 'shipped-code-and-tests',
          },
        ],
        { columns: 3 },
      )}
      <p><a href="/machines/">See the status of each machine and controller →</a></p>`,
  });
}

export const page = {
  path: '/',
  nav: null,
  title: 'Home',
  description:
    'KerfDesk is laser and CNC software for GRBL-family machines, in a Free and a Pro edition. Design, assign operations, preview the toolpath and send jobs.',
  render: (ctx) =>
    html`${hero(ctx)}
    ${section({
      eyebrow: 'Design · Engrave · Carve',
      title: 'One app for laser and CNC work',
      lead: 'Named operations for laser jobs, clear cut types and depths for router jobs, and the same design tools for both.',
      content: featureGrid(PILLARS),
    })}
    ${section({
      tone: 'alt',
      eyebrow: 'How it works',
      title: 'From design to machine in five steps',
      content: steps(HOW),
    })}
    ${section({
      eyebrow: 'Preview and CNC',
      title: 'Check it on screen first',
      content: html`${split({
        title: 'See every move before it happens',
        body: 'Preview the toolpath and get a time estimate from a GRBL-style motion model before you start. With Pro, the G-code Inspector plays the program back in 3D and opens any .nc, .gcode or .tap file to view.',
        points: [
          'Toolpath preview with travel moves and a playback scrubber',
          html`3D G-code playback that shows which line made each move ${proPill()}`,
          'A Program Health report that flags possible issues without blocking anything',
        ],
        media: shot(ctx, 'preview'),
      })}
      ${split({
        title: 'A CNC mode for routers',
        body: 'Switch to CNC mode for depth passes, ramp entry (or helical entry for pockets), holding tabs and pocket clearing, with a 3D preview that simulates material removal. Pro adds V-carving. The CNC side is tested in software only and hasn’t cut on a real machine yet, so air-cut first.',
        points: [
          'Eight cut types, from profiles to inlays',
          'Touch-plate probing and a tool library with 22 common bits plus your own',
          'A feeds and speeds calculator and a spoilboard surfacing wizard',
        ],
        media: shot(ctx, 'cnc'),
        reverse: true,
      })}`,
    })}
    ${proofSection()}
    ${section({
      tone: 'alt',
      eyebrow: 'What you get',
      title: 'Private and offline, with a Free edition',
      content: featureGrid(promises(ctx.site, ctx.commerce), { columns: 4 }),
    })}
    ${section({
      narrow: true,
      content: callout({
        tone: 'safety',
        title: 'Lasers and routers can start fires and cause injury',
        body: html`<p>
          Check every job before you run it, keep the work area clear and stay with the machine. The
          Abort button in KerfDesk is a software stop, not a safety-rated emergency stop. In an
          emergency, use your machine’s physical E-stop or power switch.
          <a href="/safety/">Read the safety notes</a>.
        </p>`,
      }),
    })}
    ${ctaBand({
      title: 'Ready to make something?',
      body: 'Open KerfDesk in Chrome, Edge, Brave or Arc. There’s nothing to install, and KerfDesk Free costs nothing.',
      buttons: [
        button(ctx.site.appUrl, 'Open KerfDesk'),
        button('/docs/', 'Get started', { variant: 'ghost-dark' }),
      ],
    })}`,
};
