// Download page. The web app is the recommended path; desktop builds are
// unsigned Previews published only as GitHub prereleases (ADR-248), so every
// desktop button opens site.releasesUrl and names the exact asset to pick.
// No version number is hard-coded: each Preview release would make it stale.

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
  table,
} from '../lib/components.mjs';
import { html } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { shot } from '../lib/screens.mjs';
import {
  COMPANION_FILES,
  DESKTOP_FILES,
  downloadFaq,
  SAME_APP_POINTS,
  UPDATE_ITEMS,
  WEB_APP_POINTS,
} from './download-data.mjs';

const [WINDOWS, MAC_INTEL, MAC_ARM] = DESKTOP_FILES;

function asset(name) {
  return html`<code class="asset">${name}</code>`;
}

function ticks(items) {
  return html`<ul class="ticks">
    ${items.map((item) => html`<li>${icon('check')}<span>${item}</span></li>`)}
  </ul>`;
}

function platforms(site) {
  return html`<div class="platforms">
    <article class="platform platform--featured">
      <span class="eyebrow">Recommended</span>
      <h3>${icon('globe')}Web app</h3>
      <p>Runs in Chrome, Edge, Brave or Arc on Windows, macOS or Linux.</p>
      ${ticks(WEB_APP_POINTS)}
      ${button(site.appUrl, 'Open the web app', { iconName: 'arrow-right' })}
    </article>
    <article class="platform">
      <span class="eyebrow">Unsigned Preview</span>
      <h3>${icon('monitor')}Windows</h3>
      <p>
        Windows 10 or 11, 64-bit (x64). The installer sets up KerfDesk for your user account, in a
        folder you choose. Testing on real Windows PCs isn’t finished yet.
      </p>
      <p>Look for ${asset(WINDOWS.file)}</p>
      ${button(site.releasesUrl, 'Browse Windows Previews', {
        variant: 'secondary',
        iconName: 'download',
      })}
    </article>
    <article class="platform">
      <span class="eyebrow">Unsigned, unnotarized Preview</span>
      <h3>${icon('laptop')}macOS</h3>
      <p>
        macOS 12 or newer, on Intel or Apple Silicon Macs. There is a separate disk image for each
        chip type. Testing on real Macs isn’t finished yet.
      </p>
      <p>Intel (x64): ${asset(MAC_INTEL.file)}</p>
      <p>Apple Silicon (arm64): ${asset(MAC_ARM.file)}</p>
      ${button(site.releasesUrl, 'Browse Mac Previews', {
        variant: 'secondary',
        iconName: 'download',
      })}
    </article>
  </div>`;
}

function chooseSection(site) {
  return section({
    id: 'choose',
    eyebrow: 'Web or desktop',
    title: 'Choose how to run KerfDesk',
    lead: 'The web app is the quickest way to start. The desktop Previews package the same app for Windows and macOS as early, unsigned builds.',
    content: html`${platforms(site)}
    ${callout({
      iconName: 'package',
      title: 'Download Previews only from the official releases page',
      body: html`<p>
        Both desktop buttons open the public
        <a href="${site.releasesUrl}">KerfDesk releases page on GitHub</a>, the only official place
        to get a Preview. Previews are published as pre-releases, so choose the newest release
        marked <strong>Pre-release</strong>, then pick the file for your computer.
      </p>`,
    })}
    ${callout({
      iconName: 'globe',
      title: 'Using Linux?',
      body: html`<p>
        There is no Linux desktop app yet, and no date for one. Use the
        <a href="${site.appUrl}">web app</a> in Chrome or Edge. It has the same design and toolpath
        features as the desktop Previews, and you can install it from the browser.
      </p>`,
    })}`,
  });
}

function sameAppSection(ctx) {
  return section({
    tone: 'alt',
    content: split({
      title: 'One app, wherever you run it',
      body: 'The desktop Previews are built from the same code as the web app. Packaging doesn’t change any design, toolpath, G-code or machine-control behavior. A few extras exist only on the desktop, such as the network-camera helper and the update link.',
      points: SAME_APP_POINTS,
      media: shot(ctx, 'workspace'),
    }),
  });
}

function filesSection() {
  return section({
    id: 'desktop-files',
    narrow: true,
    eyebrow: 'Desktop Previews',
    title: 'Pick the right file',
    lead: 'Each Preview release lists several files. Download the one that matches your computer.',
    content: html`<div class="prose">
        <p>
          In each name below, <code>&lt;version&gt;</code> is the release tag without its leading
          <code>v</code>. For example, tag <code>v0.2.0-preview.1</code> becomes
          <code>0.2.0-preview.1</code>.
        </p>
      </div>
      ${table({
        caption: 'Desktop Preview files',
        head: ['Computer', 'Needs', 'File'],
        rows: DESKTOP_FILES.map((row) => [row.computer, row.needs, asset(row.file)]),
      })}
      <div class="prose">
        <h3>Check what you downloaded</h3>
        <p>Every Preview release also includes three companion files:</p>
        <ul>
          ${COMPANION_FILES.map((item) => html`<li>${asset(item.file)}: ${item.body}</li>`)}
        </ul>
        <p>
          GitHub provenance records also tie each download to the exact source commit that built it.
          These files show what was built. They don’t make an unsigned build signed or trusted.
        </p>
      </div>`,
  });
}

function installSection() {
  return section({
    id: 'install',
    tone: 'alt',
    narrow: true,
    eyebrow: 'Unsigned Preview',
    title: 'Install a desktop Preview',
    lead: 'Desktop Previews are unsigned, and Mac Previews aren’t notarized by Apple. Windows or macOS may warn you the first time you open one.',
    content: html`${callout({
        title: 'Opening an unsigned app is your decision',
        body: html`<p>
          Choose <strong>Run anyway</strong> or <strong>Open Anyway</strong> only for a file you
          downloaded from the official KerfDesk releases page whose name matches the pattern for
          your computer. If anything doesn’t match, don’t open it.
        </p>`,
      })}
      <div class="prose">
        <h3>Windows</h3>
        <ol>
          <li>Run the setup file you downloaded.</li>
          <li>
            Only continue if it came from the official KerfDesk releases page and its name matches
            the Windows pattern.
          </li>
          <li>
            If SmartScreen says <strong>Windows protected your PC</strong>, choose
            <strong>More info</strong>.
          </li>
          <li>
            Check that the publisher is shown as unknown, then choose <strong>Run anyway</strong>.
          </li>
        </ol>
        <h3>macOS</h3>
        <ol>
          <li>Open the disk image and drag <strong>KerfDesk.app</strong> to Applications.</li>
          <li>
            Control-click KerfDesk.app in Applications, choose <strong>Open</strong>, then choose
            <strong>Open</strong> again.
          </li>
          <li>
            If macOS still blocks it, open
            <strong>System Settings &gt; Privacy &amp; Security</strong> and choose
            <strong>Open Anyway</strong>. On macOS 12 Monterey, use
            <strong
              >System Preferences &gt; Security &amp; Privacy &gt; General &gt; Open Anyway</strong
            >.
          </li>
        </ol>
        <p>KerfDesk never turns off or quietly works around macOS Gatekeeper.</p>
        <p>
          After you install a newer Preview, your Mac may ask again for camera and local-network
          permission. Unsigned builds don’t carry a lasting signed identity for those permissions.
        </p>
      </div>`,
  });
}

function updatesSection() {
  return section({
    id: 'updates',
    narrow: true,
    eyebrow: 'Updates',
    title: 'How updates work',
    content: html`${featureGrid(UPDATE_ITEMS, { columns: 2 })}
    ${callout({
      title: 'What the desktop update check sends',
      body: html`<p>
        To find out whether a newer Preview exists, the desktop app makes one small request to
        GitHub each time it opens. It sends no project, design, machine or job details, and no
        device ID. GitHub still sees normal connection details, such as your IP address and the
        time. If you’re offline or the check fails, nothing happens. Automated tests cover this
        check, but it hasn’t yet been tried on installed copies on real computers.
      </p>`,
    })}`,
  });
}

export const page = {
  path: '/download/',
  nav: null,
  title: 'Download',
  description:
    'Use KerfDesk free in your browser today, or download an unsigned desktop Preview for Windows 10/11 or macOS 12+ on Intel and Apple Silicon.',
  render: (ctx) => {
    const { site } = ctx;
    return html`${pageHero({
      eyebrow: 'Download',
      title: 'Get KerfDesk',
      lead: 'Use KerfDesk in your browser, or install a desktop Preview on Windows or macOS. Both are free to use today, and neither needs an account.',
      extra: actions(
        button(site.appUrl, 'Open KerfDesk in your browser', { iconName: 'arrow-right' }),
        button('#desktop-files', 'Desktop Preview files', {
          variant: 'secondary',
          iconName: 'download',
        }),
      ),
    })}
    ${chooseSection(site)} ${sameAppSection(ctx)} ${filesSection()} ${installSection()}
    ${updatesSection()}
    ${section({
      id: 'questions',
      tone: 'alt',
      narrow: true,
      eyebrow: 'Questions',
      title: 'Download questions',
      content: faqList(downloadFaq(site)),
    })}
    ${section({
      narrow: true,
      content: callout({
        tone: 'safety',
        title: 'Before you run a job',
        body: html`<p>
          Check every job before you cut real material, and stay with the machine. The Abort button
          in KerfDesk is a software stop, not an emergency stop. Keep your machine’s physical E-stop
          or power switch within reach. <a href="/safety/">Read the safety notes</a>.
        </p>`,
      }),
    })}
    ${ctaBand({
      title: 'Ready to start?',
      body: 'Open KerfDesk in Chrome, Edge, Brave or Arc. It’s free to use today and needs no account.',
      buttons: [
        button(site.appUrl, 'Open KerfDesk'),
        button('/docs/', 'Get started', { variant: 'ghost-dark' }),
      ],
    })}`;
  },
};
