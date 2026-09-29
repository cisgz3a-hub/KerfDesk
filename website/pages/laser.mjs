// Laser page: Line / Fill / Image, tracing, cut helpers, the Frame-first run,
// materials, rotary and camera, who it suits, and an honest status block.
// Copy data and its sources live in laser-data.mjs. Status wording follows
// ADR-322: no machine is verified. The Falcon row is informal use only
// ("Used on a real machine"), and image engraving, rotary, camera alignment
// and Ruida export are code and tests only.

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
  CUT_TOOLS,
  EXTRAS,
  FILL_STYLES,
  IMAGE_FEATURES,
  MATERIAL_TOOLS,
  MODES,
  RUN_STEPS,
  STATUS_ROWS,
  TRACE_PRESETS,
} from './laser-data.mjs';

function modesSection() {
  return section({
    id: 'modes',
    eyebrow: 'Operations',
    title: 'Three ways to use the beam',
    lead: 'Each part of your design gets a named operation, not a color. Every operation has its own power, speed and passes, and you choose the order they run in.',
    content: html`${featureGrid(MODES)}
      <div class="prose">
        <p>
          Need both on one shape? Sub-layers let a single operation fill a shape and then trace its
          outline.
        </p>
        <p>
          You can also open LightBurn project files (<code>.lbrn2</code>) with File → Open. KerfDesk
          brings over the shapes plus each layer’s speed, power, passes and Line or Fill mode.
          Bitmaps and some text don’t come across, and older <code>.lbrn</code> files haven’t been
          tested. KerfDesk reads LightBurn files and never writes them.
        </p>
      </div>`,
  });
}

function fillSection() {
  return section({
    id: 'fill',
    tone: 'alt',
    eyebrow: 'Fill',
    title: 'Fills that follow your design',
    lead: 'Pick a fill style, then set the scan angle and line spacing.',
    content: html`${featureGrid(FILL_STYLES, { columns: 4 })}
      <div class="prose">
        <p>
          Overscan adds a short laser-off run past the ends of fill lines, so the head can slow down
          and turn around outside your design instead of on it.
        </p>
      </div>`,
  });
}

function imageSection() {
  return section({
    id: 'image-engraving',
    eyebrow: 'Image',
    title: 'Engrave photos and bitmaps',
    lead: 'Image mode engraves a PNG or JPG row by row. You choose how shades of gray become dots or laser power, and how close the rows are.',
    content: html`${featureGrid(IMAGE_FEATURES, { columns: 2 })}
    ${callout({
      tone: 'info',
      title: 'Not yet tested on a machine',
      body: html`<p>${statusPill('shipped-code-and-tests')}</p>
        <p>
          Image engraving is built and covered by automated tests, but it hasn’t had a recorded test
          on a real machine yet. Run a small test piece on scrap before you engrave anything you
          care about.
        </p>`,
    })}`,
  });
}

function traceSection() {
  return section({
    id: 'trace',
    tone: 'alt',
    eyebrow: 'Trace',
    title: 'Turn a picture into vectors',
    lead: 'Trace a logo, sketch or scan into paths you can cut, score or fill. Start from one of five presets.',
    content: html`${table({
        caption: 'Trace Image presets',
        head: ['Preset', 'Good for'],
        rows: TRACE_PRESETS,
      })}
      <div class="prose">
        <p>
          Multi-File Trace turns several image files into separate SVG files in one go, using the
          Line Art preset. If you keep the original image in your project, Re-trace Original reopens
          Trace Image so you can try another preset.
        </p>
      </div>`,
  });
}

function cutToolsSection() {
  return section({
    id: 'cutting',
    eyebrow: 'Cutting',
    title: 'Cut parts free and place the job',
    lead: 'Settings for cutting parts out of the sheet, and for putting the job where you want it on your workpiece.',
    content: featureGrid(CUT_TOOLS, { columns: 4 }),
  });
}

function runSection(ctx) {
  return section({
    id: 'frame-first',
    tone: 'alt',
    eyebrow: 'Run the job',
    title: 'Frame first, then Start',
    content: html`${split({
        title: 'See the whole job before it runs',
        body: 'Preview shows cuts and travel moves on the canvas, and a GRBL-style motion planner estimates how long the job will take. It is an estimate, not a promise: it hasn’t been compared with real run times.',
        points: [
          'Toolpath preview with an estimated run time',
          'Play the program back in 3D in the G-code Inspector',
          'Automated tests check that the G-code keeps the laser off on every travel move',
        ],
        media: shot(ctx, 'preview', { caption: 'The toolpath preview in KerfDesk.' }),
      })}
      <div class="prose">
        <h3>Four steps to Start</h3>
        <p>
          For a normal start, KerfDesk asks you to Frame the exact job first, so you see where it
          lands before anything burns.
        </p>
      </div>
      ${steps(RUN_STEPS)}
      ${callout({
        tone: 'info',
        title: 'Frame is a check you watch, not a safety interlock',
        body: html`<p>
          Frame shows where the job will run, not how the result will look. Job Review warnings — a
          design running past the bed or into a no-go zone, for example — are there for you to read.
          They don’t block the job. Apart from the Frame, only facts stop a start: the machine isn’t
          connected or ready, the program can’t be built, or it changed after you reviewed it.
        </p>`,
      })}`,
  });
}

function materialsSection() {
  return section({
    id: 'materials',
    eyebrow: 'Materials',
    title: 'Dial in a new material',
    lead: 'Test grids help you find settings on scrap. Libraries keep the ones that work.',
    content: html`${featureGrid(MATERIAL_TOOLS, { columns: 2 })}
      <div class="prose">
        <p>
          The grids don’t choose settings for you. What looks right depends on your machine, your
          laser and your material.
        </p>
      </div>`,
  });
}

function extrasSection() {
  return section({
    id: 'rotary-camera',
    tone: 'alt',
    eyebrow: 'Rotary and camera',
    title: 'Round objects and camera placement',
    lead: 'Both are built into the software. Rotary output has never run on a physical rotary, and camera alignment accuracy hasn’t been measured on a real machine, so go slowly the first time.',
    content: featureGrid(EXTRAS),
  });
}

function whoSection() {
  return section({
    id: 'who',
    narrow: true,
    eyebrow: 'Who it suits',
    title: 'Is KerfDesk a fit for your laser?',
    content: html`<div class="prose">
      <p>
        KerfDesk is made for people with GRBL-based diode or CO₂ lasers, for example GRBL models
        from xTool, Sculpfun, Ortur, Atomstack, NEJE or OpenBuilds, and FluidNC conversions. That
        describes who it is for, not what has been tested: no machine from those brands has been
        tested with KerfDesk, and not every model from them runs GRBL. Check your firmware first.
      </p>
      <p>
        KerfDesk connects to your machine with a USB cable. It has starter profiles for the Creality
        Falcon A1 Pro, xTool D1 Pro (5, 10, 20 and 40 W heads), Sculpfun S30, Ortur Laser Master 3
        (three heads) and Neotronics 4040, plus a generic template for each controller family.
        Atomstack, NEJE and OpenBuilds have no named profile yet, so start from the generic GRBL
        template. The profiles come from public specifications, and no profile has been qualified on
        the machine it describes. Treat them as starting points: confirm your work area, firmware,
        homing and power scale.
      </p>
      <p>
        Some setups are outside what KerfDesk does today. Ruida controllers get only an
        experimental, vector-only <code>.rd</code> file export with no live connection, and no real
        Ruida controller has accepted one yet. Trocen, TopWisdom and galvo controllers are not
        supported, and there is no Wi-Fi or network machine control.
      </p>
      <p><a href="/machines/">See which controllers have been tested, and how →</a></p>
    </div>`,
  });
}

function statusSection() {
  return section({
    id: 'status',
    tone: 'alt',
    eyebrow: 'Honest status',
    title: 'What has and hasn’t run on a machine',
    lead: 'KerfDesk labels how each part has been checked, so you know what to watch closely on your first jobs. No machine is formally qualified yet.',
    content: html`<ul class="legend">
        <li>${statusPill('hardware-verified')} Informal runs on a real machine</li>
        <li>${statusPill('simulator-only')} Tested against a firmware simulator</li>
        <li>${statusPill('shipped-code-and-tests')} Code and automated tests only</li>
      </ul>
      ${table({
        caption: 'Laser features and how they have been checked',
        head: ['Feature', 'Status', 'What that means'],
        rows: STATUS_ROWS,
      })}
      <div class="prose">
        <p>
          KerfDesk has never been proven on hardware for output quality. Automated tests check the
          structure of the G-code — for example, that the laser is off on every travel move — not
          how a fill or an engraving looks. Output can be wrong and still pass every test. Check
          each job with the preview or an air run, and check your output in a separate G-code viewer
          too.
        </p>
      </div>
      ${callout({
        tone: 'safety',
        title: 'Abort is a software stop, not an emergency stop',
        body: html`<p>
          The Abort button asks the controller to stop, but it can’t confirm the command arrived.
          After a USB disconnect, a crash or a full controller buffer, the machine may keep moving.
          Keep your machine’s physical E-stop or power switch within reach, stay with the machine,
          keep a fire extinguisher close and wear eye protection rated for your laser’s wavelength.
          <a href="/safety/">Read the safety notes</a>.
        </p>`,
      })}`,
  });
}

export const page = {
  path: '/laser/',
  nav: 'features',
  title: 'Laser',
  description:
    'Line, Fill and Image modes, tracing, kerf offset, tabs and Frame-first Start for GRBL diode and CO₂ lasers, plus what has and hasn’t been tested.',
  render: (ctx) =>
    html`${pageHero({
      eyebrow: 'Laser',
      title: 'Cut, fill and engrave with your laser',
      lead: 'Give each part of your design a laser operation: Line to cut or score, Fill to shade an area, Image to engrave a photo. Preview the toolpath, Frame it on your material, then start.',
      extra: actions(
        button(ctx.site.appUrl, 'Open KerfDesk', { iconName: 'arrow-right' }),
        button('/machines/', 'Check your machine', { variant: 'secondary' }),
      ),
    })}
    ${modesSection()} ${fillSection()} ${imageSection()} ${traceSection()} ${cutToolsSection()}
    ${runSection(ctx)} ${materialsSection()} ${extrasSection()} ${whoSection()} ${statusSection()}
    ${ctaBand({
      title: 'Try it on your next project',
      body: 'KerfDesk is free to use today, needs no account and runs in Chromium-based browsers such as Chrome and Edge.',
      buttons: [
        button(ctx.site.appUrl, 'Open KerfDesk'),
        button('/docs/', 'Get started', { variant: 'ghost-dark' }),
      ],
    })}`,
};
